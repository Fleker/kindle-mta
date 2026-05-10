import { inject, Injectable } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { transit_realtime } from 'gtfs-realtime-bindings';
import { Arrival, ServiceAlert, StopConfig } from '../models/transit.model';
import { ConfigService } from './config.service';

const MTA_FEED_BASE = 'https://api-endpoint.mta.info/Dataservice/mtagtfsfeeds';
const BUS_SIRI_URL = 'https://bustime.mta.info/api/siri/stop-monitoring.json';
const ALL_ALERTS_FEED = 'camsys%2Fall-alerts';
const SUBWAY_ALERTS_FEED = 'camsys%2Fsubway-alerts';

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
  data: Uint8Array;
  fetchedAt: number;
}

@Injectable({ providedIn: 'root' })
export class MtaService {
  private http = inject(HttpClient);
  private cfg = inject(ConfigService);

  // Cache binary feed data keyed by feed path
  private cache = new Map<string, CacheEntry>();
  private CACHE_TTL = 30_000; // 30 s – feeds update every 15-30 s

  // ─── Public API ───────────────────────────────────────────────────────────

  /** Fetch arrivals for a subway stop. May throw on network/parse error. */
  async getSubwayArrivals(stop: StopConfig): Promise<Arrival[]> {
    const feedPath = feedForStopId(stop.id);
    const data = await this.fetchBinary(`${MTA_FEED_BASE}/${feedPath}`);
    return this.parseSubwayFeed(data, stop);
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
    const proxied = this.proxy(url);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const resp = await firstValueFrom(this.http.get<any>(proxied));
    return this.parseBusFeed(resp, stop);
  }

  /**
   * Fetch service alerts and filter to only those relevant to the provided
   * stop IDs (from the query params) or route IDs (from fetched arrivals).
   * Returns an empty array on error.
   */
  async getAlerts(stopIds: Set<string>, routeIds: Set<string>): Promise<ServiceAlert[]> {
    try {
      const data = await this.fetchBinary(`${MTA_FEED_BASE}/${ALL_ALERTS_FEED}`);
      return this.parseAlertsFeed(data, stopIds, routeIds);
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
    const proxied = this.proxy(url);
    const buffer = await firstValueFrom(
      this.http.get(proxied, { responseType: 'arraybuffer' })
    );
    const data = new Uint8Array(buffer);
    this.cache.set(url, { data, fetchedAt: Date.now() });
    return data;
  }

  // ─── Parsers ───────────────────────────────────────────────────────────────

  private parseSubwayFeed(data: Uint8Array, stop: StopConfig): Arrival[] {
    const feed = transit_realtime.FeedMessage.decode(data);
    const nowSec = Date.now() / 1000;
    const results: Arrival[] = [];
    const dir = stop.id.slice(-1).toUpperCase();
    const destination = dir === 'N' ? 'Uptown' : dir === 'S' ? 'Downtown' : '';

    for (const entity of feed.entity) {
      const tu = entity.tripUpdate;
      if (!tu) continue;
      const routeId = tu.trip?.routeId ?? '?';

      for (const stu of tu.stopTimeUpdate ?? []) {
        if (stu.stopId !== stop.id) continue;
        const arrSec = toLong(stu.arrival?.time) ?? toLong(stu.departure?.time);
        if (arrSec == null || arrSec < nowSec) continue;

        results.push({
          routeName: routeId,
          destination,
          arrivalTime: new Date(arrSec * 1000),
          minutesAway: Math.round((arrSec - nowSec) / 60),
        });
      }
    }

    // Sort by time, dedupe by route+time, limit to maxArrivals per route
    results.sort((a, b) => a.arrivalTime.getTime() - b.arrivalTime.getTime());
    return this.limitPerRoute(results, this.cfg.config.maxArrivals);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private parseBusFeed(resp: any, stop: StopConfig): Arrival[] {
    const nowSec = Date.now() / 1000;
    const deliveries =
      resp?.Siri?.ServiceDelivery?.StopMonitoringDelivery ?? [];
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

  private parseAlertsFeed(data: Uint8Array): ServiceAlert[] {
    const feed = transit_realtime.FeedMessage.decode(data);
    const now = Date.now() / 1000;
    const alerts: ServiceAlert[] = [];

    for (const entity of feed.entity) {
      const alert = entity.alert;
      if (!alert) continue;

      // Check if alert is currently active
      const periods = alert.activePeriod ?? [];
      if (periods.length > 0) {
        const isActive = periods.some(p => {
          const start = toLong(p.start) ?? 0;
          const end = toLong(p.end);
          return now >= start && (end == null || now <= end);
        });
        if (!isActive) continue;
      }

      const routes: string[] = [];
      for (const ie of alert.informedEntity ?? []) {
        if (ie.routeId) routes.push(ie.routeId);
      }

      alerts.push({
        id: entity.id,
        header: pickEnglishText(alert.headerText),
        description: pickEnglishText(alert.descriptionText),
        affectedRoutes: [...new Set(routes)],
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
