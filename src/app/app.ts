import { Component, OnInit, signal, computed, inject, OnDestroy } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ConfigService } from './services/config.service';
import { MtaService } from './services/mta.service';
import { TransitCardComponent } from './components/transit-card/transit-card.component';
import { AlertsPanelComponent } from './components/alerts-panel/alerts-panel.component';
import { SetupComponent } from './components/setup/setup.component';
import { StopArrivals, ServiceAlert, StopConfig } from './models/transit.model';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [CommonModule, TransitCardComponent, AlertsPanelComponent, SetupComponent],
  templateUrl: './app.html',
  styleUrl: './app.css',
})
export class App implements OnInit, OnDestroy {
  private config = inject(ConfigService);
  private mta = inject(MtaService);

  readonly hasStops = computed(() => this.config.hasStops);
  readonly allStops = computed(() => [
    ...this.config.config.subwayStops,
    ...this.config.config.busStops,
  ]);

  readonly stopArrivals = signal<StopArrivals[]>([]);
  readonly alerts = signal<ServiceAlert[]>([]);
  readonly alertsLoading = signal<boolean>(false);
  readonly lastRefresh = signal<Date | null>(null);

  private refreshTimer: ReturnType<typeof setInterval> | null = null;

  ngOnInit(): void {
    if (!this.config.hasStops) return;

    this.stopArrivals.set(
      this.allStops().map(stop => ({
        stop,
        arrivals: [],
        uptown: [],
        downtown: [],
        loading: true,
        error: null,
        lastUpdated: null,
      }))
    );

    this.refresh();

    const intervalMs = this.config.config.refreshInterval * 1000;
    this.refreshTimer = setInterval(() => this.refresh(), intervalMs);
  }

  ngOnDestroy(): void {
    if (this.refreshTimer != null) clearInterval(this.refreshTimer);
  }

  async refresh(): Promise<void> {
    const stops = this.allStops();

    this.stopArrivals.update(list =>
      list.map(sa => ({ ...sa, loading: true, error: null }))
    );

    await Promise.allSettled(
      stops.map((stop, idx) => this.fetchStop(stop, idx))
    );

    // Build filter sets for alert relevance check
    const routeIds = new Set(
      this.stopArrivals().flatMap(sa => sa.arrivals.map(a => a.routeName))
    );
    // For bidirectional subway stops, expand the base ID to both N and S
    const stopIds = new Set<string>();
    for (const stop of stops) {
      if (stop.bothDirections) {
        stopIds.add(stop.id + 'N');
        stopIds.add(stop.id + 'S');
      } else {
        stopIds.add(stop.id);
      }
    }

    this.alertsLoading.set(true);
    try {
      this.alerts.set(await this.mta.getAlerts(stopIds, routeIds));
    } catch {
      // leave previous alerts visible on error
    } finally {
      this.alertsLoading.set(false);
    }

    this.lastRefresh.set(new Date());
  }

  private async fetchStop(stop: StopConfig, idx: number): Promise<void> {
    try {
      if (stop.type === 'subway') {
        const { uptown, downtown, arrivals } = await this.mta.getSubwayArrivals(stop);
        this.stopArrivals.update(list =>
          list.map((sa, i) =>
            i === idx
              ? { ...sa, uptown, downtown, arrivals, loading: false, error: null, lastUpdated: new Date() }
              : sa
          )
        );
      } else {
        const arrivals = await this.mta.getBusArrivals(stop);
        this.stopArrivals.update(list =>
          list.map((sa, i) =>
            i === idx
              ? { ...sa, arrivals, uptown: [], downtown: [], loading: false, error: null, lastUpdated: new Date() }
              : sa
          )
        );
      }
    } catch (err: unknown) {
      const msg = this.friendlyError(err);
      this.stopArrivals.update(list =>
        list.map((sa, i) => i === idx ? { ...sa, loading: false, error: msg } : sa)
      );
    }
  }

  private friendlyError(err: unknown): string {
    if (err instanceof Error) {
      if (err.message.includes('CORS') || err.message.includes('0 Unknown')) {
        return 'Network error — check proxy setting';
      }
      if (err.message.includes('Protobuf decode failed')) {
        return err.message.slice(0, 120);
      }
      return err.message.slice(0, 80);
    }
    const e = err as { status?: number; message?: string };
    if (e.status === 0) return 'Network error — check proxy setting';
    if (e.status === 403) return '403 Forbidden — check API key';
    if (e.status === 404) return '404 — stop ID not found';
    return e.message?.slice(0, 80) ?? 'Unknown error';
  }

  formatRefreshTime(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', second: '2-digit' });
  }
}
