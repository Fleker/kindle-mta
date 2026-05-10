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

    // Initialize stop arrival placeholders
    this.stopArrivals.set(
      this.allStops().map(stop => ({
        stop,
        arrivals: [],
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
    if (this.refreshTimer != null) {
      clearInterval(this.refreshTimer);
    }
  }

  async refresh(): Promise<void> {
    const stops = this.allStops();

    // Mark all stops as loading (keep existing arrivals)
    this.stopArrivals.update(list =>
      list.map(sa => ({ ...sa, loading: true, error: null }))
    );

    // Fetch arrivals for each stop concurrently
    const fetchPromises = stops.map((stop, idx) =>
      this.fetchStop(stop, idx)
    );

    // Fetch alerts concurrently
    this.alertsLoading.set(true);
    const alertsPromise = this.mta
      .getAlerts(
        this.config.config.subwayStops.length > 0,
        this.config.config.busStops.length > 0
      )
      .then(a => {
        this.alerts.set(a);
        this.alertsLoading.set(false);
      })
      .catch(() => {
        this.alertsLoading.set(false);
      });

    await Promise.allSettled([...fetchPromises, alertsPromise]);
    this.lastRefresh.set(new Date());
  }

  private async fetchStop(stop: StopConfig, idx: number): Promise<void> {
    try {
      const arrivals =
        stop.type === 'subway'
          ? await this.mta.getSubwayArrivals(stop)
          : await this.mta.getBusArrivals(stop);

      this.stopArrivals.update(list =>
        list.map((sa, i) =>
          i === idx
            ? { ...sa, arrivals, loading: false, error: null, lastUpdated: new Date() }
            : sa
        )
      );
    } catch (err: unknown) {
      const msg = this.friendlyError(err);
      this.stopArrivals.update(list =>
        list.map((sa, i) =>
          i === idx ? { ...sa, loading: false, error: msg } : sa
        )
      );
    }
  }

  private friendlyError(err: unknown): string {
    if (err instanceof Error) {
      if (err.message.includes('CORS') || err.message.includes('0 Unknown')) {
        return 'Network error — check proxy setting';
      }
      return err.message.slice(0, 80);
    }
    // Angular HttpErrorResponse
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
