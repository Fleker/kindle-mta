import { Component, input, computed } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ServiceAlert } from '../../models/transit.model';

@Component({
  selector: 'app-alerts-panel',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './alerts-panel.component.html',
  styleUrl: './alerts-panel.component.css',
})
export class AlertsPanelComponent {
  readonly alerts = input.required<ServiceAlert[]>();
  readonly loading = input<boolean>(false);

  /** Alerts that have a non-empty header. */
  readonly visibleAlerts = computed(() =>
    this.alerts().filter(a => a.header.trim().length > 0)
  );
}
