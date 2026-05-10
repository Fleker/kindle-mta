import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { Arrival, StopArrivals } from '../../models/transit.model';

@Component({
  selector: 'app-transit-card',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './transit-card.component.html',
  styleUrl: './transit-card.component.css',
})
export class TransitCardComponent {
  readonly stopArrivals = input.required<StopArrivals>();
  readonly walkMinutes = input<number>(0);

  /** Group arrivals by route name. */
  readonly routeGroups = computed(() => {
    const map = new Map<string, Arrival[]>();
    for (const a of this.stopArrivals().arrivals) {
      const list = map.get(a.routeName) ?? [];
      list.push(a);
      map.set(a.routeName, list);
    }
    return map;
  });

  /** Sorted list of route names for display. */
  readonly routes = computed(() =>
    [...this.routeGroups().keys()].sort()
  );

  /** First arrival for a given route (for destination display). */
  firstArrival(route: string): Arrival | undefined {
    return this.routeGroups().get(route)?.[0];
  }

  /** Format an individual arrival time label. */
  formatArrival(arrival: Arrival): string {
    if (arrival.minutesAway <= 0) return 'Due';
    if (arrival.minutesAway === 1) return '1 min';
    return `${arrival.minutesAway} min`;
  }

  /** Whether the user needs to leave now to catch this train. */
  shouldLeaveNow(arrival: Arrival): boolean {
    return arrival.minutesAway <= this.walkMinutes();
  }

  /** Formatted time string for the last update. */
  formatTime(date: Date | null): string {
    if (!date) return '';
    return date.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
  }
}
