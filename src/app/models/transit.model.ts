export interface StopConfig {
  id: string;           // GTFS stop ID, e.g. 'R16N' (subway) or '308984' (bus)
  type: 'subway' | 'bus';
  label: string;        // Display name
  walkMinutes: number;  // Minutes to walk to this stop
}

export interface AppConfig {
  subwayStops: StopConfig[];
  busStops: StopConfig[];
  maxArrivals: number;   // Number of upcoming arrivals to show per route
  busApiKey: string;     // MTA Bus Time API key
  proxyUrl: string;      // CORS proxy prefix, e.g. 'https://corsproxy.io/?url='
  refreshInterval: number; // Refresh interval in seconds
}

export interface Arrival {
  routeName: string;    // e.g. 'N', 'Q', 'B46'
  destination: string;  // e.g. 'Uptown', 'Downtown', 'Jamaica'
  arrivalTime: Date;
  minutesAway: number;  // Minutes until train/bus arrives at stop
}

export interface StopArrivals {
  stop: StopConfig;
  arrivals: Arrival[];
  loading: boolean;
  error: string | null;
  lastUpdated: Date | null;
}

export interface ServiceAlert {
  id: string;
  header: string;
  description: string;
  affectedRoutes: string[];
}
