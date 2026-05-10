export interface StopConfig {
  /**
   * For subway: base station ID without direction suffix when bothDirections=true
   * (e.g. 'R16'), or a full stop ID like 'R16N' when bothDirections=false.
   * For bus: the numeric stop ID.
   */
  id: string;
  type: 'subway' | 'bus';
  label: string;
  walkMinutes: number;
  /** Subway only: show both northbound and southbound in one card. */
  bothDirections: boolean;
}

export interface AppConfig {
  subwayStops: StopConfig[];
  busStops: StopConfig[];
  maxArrivals: number;
  busApiKey: string;
  proxyUrl: string;
  refreshInterval: number;
}

export interface Arrival {
  routeName: string;
  destination: string;
  arrivalTime: Date;
  minutesAway: number;
}

export interface StopArrivals {
  stop: StopConfig;
  /** All arrivals combined — used for bus stops and alert-route filtering. */
  arrivals: Arrival[];
  /** Northbound arrivals (subway bidirectional stops only). */
  uptown: Arrival[];
  /** Southbound arrivals (subway bidirectional stops only). */
  downtown: Arrival[];
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
