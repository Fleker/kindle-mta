import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Arrival, StopArrivals } from '../../models/transit.model';

function groupByRoute(arrivals: Arrival[]): Map<string, Arrival[]> {
  const map = new Map<string, Arrival[]>();
  for (const a of arrivals) {
    const list = map.get(a.routeName) ?? [];
    list.push(a);
    map.set(a.routeName, list);
  }
  return map;
}

@Component({
  selector: 'app-transit-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transit-card.component.html',
  styleUrl: './transit-card.component.css',
})
export class TransitCardComponent {
  readonly stopArrivals = input.required<StopArrivals>();

  // ── Bidirectional subway ───────────────────────────────────────────────────
  readonly uptownGroups  = computed(() => groupByRoute(this.stopArrivals().uptown));
  readonly downtownGroups = computed(() => groupByRoute(this.stopArrivals().downtown));

  /** Unified sorted route list spanning both directions. */
  readonly allRoutes = computed(() => {
    const routes = new Set([
      ...this.uptownGroups().keys(),
      ...this.downtownGroups().keys(),
    ]);
    return [...routes].sort();
  });

  // ── Single-direction / bus ─────────────────────────────────────────────────
  readonly routeGroups = computed(() => groupByRoute(this.stopArrivals().arrivals));
  readonly routes = computed(() => [...this.routeGroups().keys()].sort());

  // ── Helpers ────────────────────────────────────────────────────────────────
  formatArrival(arrival: Arrival): string {
    if (arrival.minutesAway <= 0) return 'Due';
    if (arrival.minutesAway === 1) return '1 min';
    return `${arrival.minutesAway} min`;
  }

  shouldLeaveNow(arrival: Arrival): boolean {
    return arrival.minutesAway <= this.stopArrivals().stop.walkMinutes;
  }

  formatTime(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
}
