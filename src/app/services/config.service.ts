import { Injectable } from '@angular/core';
import { AppConfig, StopConfig } from '../models/transit.model';

/**
 * URL query parameter schema:
 *   subway   = comma-separated subway stop IDs, e.g. R16N,R16S,101N
 *   bus      = comma-separated bus stop IDs, e.g. 308984,301446
 *   walk     = stop-specific walk times in minutes, e.g. R16N:5,308984:8
 *   labels   = custom display names, e.g. R16N:Times Sq NB,R16S:Times Sq SB
 *   n        = max arrivals to show per route (default: 4)
 *   busKey   = MTA Bus Time API key
 *   proxy    = CORS proxy URL prefix (default: https://corsproxy.io/?url=)
 *              The stop URL will be appended URL-encoded after this prefix.
 *   refresh  = auto-refresh interval in seconds (default: 60)
 */
@Injectable({ providedIn: 'root' })
export class ConfigService {
  readonly config: AppConfig;

  constructor() {
    this.config = this.parseConfig();
  }

  get hasStops(): boolean {
    return this.config.subwayStops.length > 0 || this.config.busStops.length > 0;
  }

  private parseConfig(): AppConfig {
    const params = new URLSearchParams(window.location.search);

    const walkMap = this.parseKeyValueList(params.get('walk') ?? '');
    const labelMap = this.parseKeyValueList(params.get('labels') ?? '');

    const subwayStops: StopConfig[] = (params.get('subway') ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(id => ({
        id,
        type: 'subway' as const,
        label: labelMap[id] ?? this.defaultSubwayLabel(id),
        walkMinutes: parseInt(walkMap[id] ?? '0', 10) || 0,
      }));

    const busStops: StopConfig[] = (params.get('bus') ?? '')
      .split(',')
      .map(s => s.trim())
      .filter(Boolean)
      .map(id => ({
        id,
        type: 'bus' as const,
        label: labelMap[id] ?? `Stop ${id}`,
        walkMinutes: parseInt(walkMap[id] ?? '0', 10) || 0,
      }));

    return {
      subwayStops,
      busStops,
      maxArrivals: parseInt(params.get('n') ?? '4', 10) || 4,
      busApiKey: params.get('busKey') ?? '',
      proxyUrl: params.get('proxy') ?? 'https://corsproxy.io/?url=',
      refreshInterval: parseInt(params.get('refresh') ?? '60', 10) || 60,
    };
  }

  private parseKeyValueList(raw: string): Record<string, string> {
    const map: Record<string, string> = {};
    if (!raw) return map;
    for (const entry of raw.split(',')) {
      const colon = entry.indexOf(':');
      if (colon < 0) continue;
      const key = entry.slice(0, colon).trim();
      const value = entry.slice(colon + 1).trim();
      if (key) map[key] = value;
    }
    return map;
  }

  private defaultSubwayLabel(stopId: string): string {
    const dir = stopId.slice(-1).toUpperCase();
    const dirLabel = dir === 'N' ? '↑ Uptown' : dir === 'S' ? '↓ Downtown' : '';
    return `${stopId.slice(0, -1)} ${dirLabel}`.trim();
  }
}
