import { Component } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'app-setup',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './setup.component.html',
  styleUrl: './setup.component.css',
})
export class SetupComponent {
  readonly exampleUrl = this.buildExampleUrl();

  private buildExampleUrl(): string {
    const base = window.location.origin + window.location.pathname;
    return (
      base +
      '?subway=R16N,R16S' +
      '&bus=308984' +
      '&walk=R16N:5,R16S:5,308984:8' +
      '&labels=R16N:Times Sq NB,R16S:Times Sq SB,308984:Gates Ave' +
      '&n=4' +
      '&busKey=YOUR_BUS_API_KEY' +
      '&proxy=https://corsproxy.io/?url='
    );
  }
}
