import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { transit_realtime } from 'gtfs-realtime-bindings';
import { Arrival, ServiceAlert, StopConfig } from '../models/transit.model';
import { ConfigService } from './config.service';

const MTA_FEED_BASE = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds';
const BUS_SIRI_URL = 'https://bustime.mta.info/api/siri/stop-monitoring.json';
const ALL_ALERTS_FEED = 'camsys%2Fall-alerts';

/** Map first character of a GTFS stop ID to the corresponding GTFS-RT feed path. */
function feedForStopId(stopId: string): string {
  const ch = stopId.charAt(0).toUpperCase();
  if (/\d/.test(ch)) return 'nyct%2Fgtfs';            // 1/2/3/4/5/6/7/GS
  if (ch === 'A' || ch === 'C' || ch === 'E') return 'nyct%2Fgtfs-ace';
  if (ch === 'B' || ch === 'D' || ch === 'F' || ch === 'M') return 'nyct%2Fgtfs-bdfm';
  if (ch === 'G') return 'nyct%2Fgtfs-g';
  if (ch === 'H') return 'nyct%2Fgtfs-si';
  if (ch === 'J' || ch === 'Z') return 'nyct%2Fgtfs-jz';
  if (ch === 'L') return 'nyct%2Fgtfs-l';
  if (ch === 'N' || ch === 'Q' || ch === 'R' || ch === 'W') return 'nyct%2Fgtfs-nqrw';
  return 'nyct%2Fgtfs';
}

function toLong(val: number | { toNumber(): number } | null | undefined): number | null {
  if (val == null) return null;
  if (typeof val === 'number') return val;
  return val.toNumber();
}

function pickEnglishText(translated: transit_realtime.ITranslatedString | null | undefined): string {
  if (!translated?.translation?.length) return '';
  const en = translated.translation.find(t => t.language === 'en' || t.language === 'en-US');
  return (en ?? translated.translation[0]).text ?? '';
}

interface CacheEntry {
  /** Raw bytes as received from the proxy (may be compressed). */
  data: Uint8Array;
  fetchedAt: number;
}

@Injectable({ providedIn: 'root' })
export class MtaService {
  private http = inject(HttpClient);
  private cfg = inject(ConfigService);

  // Cache raw feed bytes keyed by URL; decompression happens at decode time
  private cache = new Map<string, CacheEntry>();
  private CACHE_TTL = 30_000; // 30 s

  // ─── Public API ───────────────────────────────────────────────────────────

  /**
   * Fetch subway arrivals for a stop/station.
   * Returns `{ uptown, downtown, arrivals }` where:
   *   - bothDirections=true  → uptown and downtown are both populated
   *   - bothDirections=false → only the matching direction is populated;
   *                            the other is an empty array
   *   - arrivals             → uptown + downtown combined (for alert filtering)
   */
  async getSubwayArrivals(
    stop: StopConfig,
  ): Promise<{ uptown: Arrival[]; downtown: Arrival[]; arrivals: Arrival[] }> {
    const feedPath = feedForStopId(stop.id);
    const raw = await this.fetchBinary(`${MTA_FEED_BASE}/${feedPath}`);
    return this.parseSubwayFeed(raw, stop);
  }

  /** Fetch arrivals for a bus stop via MTA Bus Time SIRI API. */
  async getBusArrivals(stop: StopConfig): Promise<Arrival[]> {
    const { busApiKey, maxArrivals } = this.cfg.config;
    const params = new URLSearchParams({
      key: busApiKey,
      MonitoringRef: stop.id,
      MaximumStopVisits: String(maxArrivals),
      version: '2',
    });
    const url = `${BUS_SIRI_URL}?${params.toString()}`;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await firstValueFrom(this.http.get<any>(this.proxy(url)));
    return this.parseBusFeed(resp, stop);
  }

  /**
   * Fetch service alerts filtered to the provided stop IDs and route IDs.
   * Returns an empty array on error.
   */
  async getAlerts(stopIds: Set<string>, routeIds: Set<string>): Promise<ServiceAlert[]> {
    try {
      const raw = await this.fetchBinary(`${MTA_FEED_BASE}/${ALL_ALERTS_FEED}`);
      return this.parseAlertsFeed(raw, stopIds, routeIds);
    } catch {
      return [];
    }
  }

  // ─── Fetch helpers ─────────────────────────────────────────────────────────

  private proxy(url: string): string {
    const p = this.cfg.config.proxyUrl;
    return p ? p + encodeURIComponent(url) : url;
  }

  private async fetchBinary(url: string): Promise<Uint8Array> {
    const cached = this.cache.get(url);
    if (cached && Date.now() - cached.fetchedAt < this.CACHE_TTL) {
      return cached.data;
    }
    const buffer = await firstValueFrom(
      this.http.get(this.proxy(url), { responseType: 'arraybuffer' })
    );
    const data = new Uint8Array(buffer);
    this.cache.set(url, { data, fetchedAt: Date.now() });
    return data;
  }

  // ─── Protobuf decode with multi-strategy decompression ────────────────────

  /**
   * Decode a GTFS-RT FeedMessage from raw bytes returned by the proxy.
   *
   * CORS proxies can deliver bytes in several states:
   *   1. Raw protobuf  — browser decompressed the gzip (normal case)
   *   2. Gzip bytes    — proxy forwarded compressed body without Content-Encoding
   *   3. Deflate bytes — less common but possible
   *
   * We try each strategy in order and throw a diagnostic error if all fail.
   */
  private async decodeFeedMessage(bytes: Uint8Array): Promise<transit_realtime.FeedMessage> {
    // Strategy 1: raw protobuf (the common case)
    try {
      return transit_realtime.FeedMessage.decode(bytes);
    } catch { /* try decompression */ }

    // Strategy 2: gzip — magic bytes 1f 8b
    if (bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b) {
      try {
        const decompressed = await this.decompress(bytes, 'gzip');
        return transit_realtime.FeedMessage.decode(decompressed);
      } catch { /* fall through */ }
    }

    // Strategy 3: zlib/deflate — magic byte 78 (78 01, 78 9c, 78 da, 78 5e)
    if (bytes.length >= 2 && bytes[0] === 0x78) {
      try {
        const decompressed = await this.decompress(bytes, 'deflate');
        return transit_realtime.FeedMessage.decode(decompressed);
      } catch { /* fall through */ }
    }

    // Strategy 4: raw deflate (no zlib header)
    try {
      const decompressed = await this.decompress(bytes, 'deflate-raw');
      return transit_realtime.FeedMessage.decode(decompressed);
    } catch { /* fall through */ }

    // All strategies failed — include diagnostic bytes for debugging
    const preview = Array.from(bytes.slice(0, 8))
      .map(b => b.toString(16).padStart(2, '0'))
      .join(' ');
    throw new Error(
      `Protobuf decode failed (${bytes.length} bytes, first 8: ${preview}). ` +
      `Your proxy may be corrupting binary responses — see README for proxy setup.`
    );
  }

  /** Decompress bytes using the browser-native DecompressionStream API. */
  private async decompress(
    bytes: Uint8Array,
    format: 'gzip' | 'deflate' | 'deflate-raw',
  ): Promise<Uint8Array> {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error(`DecompressionStream not available (needed for ${format})`);
    }
    const ds = new DecompressionStream(format);
    const writer = ds.writable.getWriter();
    // .slice() ensures a plain ArrayBuffer backing (not SharedArrayBuffer)
    writer.write(bytes.slice());
    writer.close();

    const chunks: Uint8Array[] = [];
    const reader = ds.readable.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }

    const totalLen = chunks.reduce((n, c) => n + c.length, 0);
    const out = new Uint8Array(totalLen);
    let off = 0;
    for (const chunk of chunks) { out.set(chunk, off); off += chunk.length; }
    return out;
  }

  // ─── Parsers ───────────────────────────────────────────────────────────────

  private async parseSubwayFeed(
    data: Uint8Array,
    stop: StopConfig,
  ): Promise<{ uptown: Arrival[]; downtown: Arrival[]; arrivals: Arrival[] }> {
    const feed = await this.decodeFeedMessage(data);
    const nowSec = Date.now() / 1000;
    const max = this.cfg.config.maxArrivals;

    // Determine which stop IDs to collect
    const uptownId  = stop.bothDirections ? stop.id + 'N'
                    : stop.id.endsWith('N') ? stop.id : null;
    const downtownId = stop.bothDirections ? stop.id + 'S'
                     : stop.id.endsWith('S') ? stop.id : null;

    const uptownRaw: Arrival[] = [];
    const downtownRaw: Arrival[] = [];

    for (const entity of feed.entity) {
      const tu = entity.tripUpdate;
      if (!tu) continue;
      const routeId = tu.trip?.routeId ?? '?';

      for (const stu of tu.stopTimeUpdate ?? []) {
        const sid = stu.stopId;
        if (sid !== uptownId && sid !== downtownId) continue;
        const arrSec = toLong(stu.arrival?.time) ?? toLong(stu.departure?.time);
        if (arrSec == null || arrSec < nowSec) continue;

        const arrival: Arrival = {
          routeName: routeId,
          destination: sid === uptownId ? 'Uptown' : 'Downtown',
          arrivalTime: new Date(arrSec * 1000),
          minutesAway: Math.round((arrSec - nowSec) / 60),
        };
        if (sid === uptownId) uptownRaw.push(arrival);
        else downtownRaw.push(arrival);
      }
    }

    uptownRaw.sort((a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime());
    downtownRaw.sort((a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime());

    const uptown   = this.limitPerRoute(uptownRaw, max);
    const downtown = this.limitPerRoute(downtownRaw, max);
    return { uptown, downtown, arrivals: [...uptown, ...downtown] };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseBusFeed(resp: any, stop: StopConfig): Arrival[] {
    const nowSec = Date.now() / 1000;
    const deliveries = resp?.Siri?.ServiceDelivery?.StopMonitoringDelivery ?? [];
    const results: Arrival[] = [];

    for (const delivery of deliveries) {
      for (const visit of delivery.MonitoredStopVisit ?? []) {
        const journey = visit.MonitoredVehicleJourney;
        if (!journey) continue;
        const line: string = journey.PublishedLineName?.[0] ?? journey.LineRef ?? '?';
        const dest: string = journey.DestinationName?.[0] ?? '';
        const call = journey.MonitoredCall;
        if (!call) continue;
        const timeStr: string = call.ExpectedArrivalTime ?? call.AimedArrivalTime ?? '';
        if (!timeStr) continue;
        const arrTime = new Date(timeStr);
        const arrSec = arrTime.getTime() / 1000;
        if (arrSec < nowSec) continue;

        results.push({
          routeName: line,
          destination: dest,
          arrivalTime: arrTime,
          minutesAway: Math.round((arrSec - nowSec) / 60),
        });
      }
    }

    results.sort((a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime());
    return results.slice(0, this.cfg.config.maxArrivals);
  }

  private async parseAlertsFeed(
    data: Uint8Array,
    stopIds: Set<string>,
    routeIds: Set<string>,
  ): Promise<ServiceAlert[]> {
    const feed = await this.decodeFeedMessage(data);
    const now = Date.now() / 1000;
    const alerts: ServiceAlert[] = [];

    for (const entity of feed.entity) {
      const alert = entity.alert;
      if (!alert) continue;

      const periods = alert.activePeriod ?? [];
      if (periods.length > 0) {
        const isActive = periods.some(p => {
          const start = toLong(p.start) ?? 0;
          const end = toLong(p.end);
          return now >= start && (end == null || now <= end);
        });
        if (!isActive) continue;
      }

      const affectedRoutes: string[] = [];
      let relevant = false;
      for (const ie of alert.informedEntity ?? []) {
        if (ie.routeId) affectedRoutes.push(ie.routeId);
        if (!relevant) {
          if (ie.stopId && stopIds.has(ie.stopId)) relevant = true;
          if (ie.routeId && routeIds.has(ie.routeId)) relevant = true;
        }
      }
      if (!relevant) continue;

      alerts.push({
        id: entity.id,
        header: pickEnglishText(alert.headerText),
        description: pickEnglishText(alert.descriptionText),
        affectedRoutes: [...new Set(affectedRoutes)],
      });
    }

    return alerts;
  }

  private limitPerRoute(arrivals: Arrival[], max: number): Arrival[] {
    const countByRoute = new Map<string, number>();
    const result: Arrival[] = [];
    for (const a of arrivals) {
      const cnt = countByRoute.get(a.routeName) ?? 0;
      if (cnt < max) {
        result.push(a);
        countByRoute.set(a.routeName, cnt + 1);
      }
    }
    return result;
  }
}
