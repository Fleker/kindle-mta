# MTA Kindle Board

A web app that displays real-time MTA subway and bus departures, optimized for Kindle e-readers. Hosted on GitHub Pages.

## Features

- Real-time subway arrivals via MTA GTFS-RT feeds (no API key required)
- Real-time bus arrivals via MTA Bus Time SIRI API (free key required for buses)
- Configurable stops, walk times, and labels via URL query parameters
- Auto-refresh every 60 seconds (configurable)
- Walk-time offset: highlights trains you need to leave for _now_
- Service alerts displayed at the bottom
- Grayscale, high-contrast UI designed for Kindle e-ink displays
- Automatic GitHub Pages deployment via GitHub Actions

## Usage

Open the app and configure your stops via URL query parameters.

### Query Parameters

| Param | Description | Example |
|-------|-------------|---------|
| `subway` | Comma-separated GTFS subway station IDs. Omit the N/S suffix to show both directions in one card (recommended). Append `N` or `S` for a single direction. | `R16,101` |
| `bus` | Comma-separated MTA bus stop IDs | `308984,301446` |
| `walk` | Walk time in minutes per stop (`id:minutes`) | `R16:5,308984:8` |
| `labels` | Custom display label per stop (`id:label`). Works for both subway and bus stops. | `R16:Times Sq,308984:34th St` |
| `n` | Max arrivals per route (default: `4`) | `4` |
| `busKey` | MTA Bus Time API key | `abc123...` |
| `proxy` | CORS proxy URL prefix (required — see below) | `https://corsproxy.io/?url=` |
| `refresh` | Auto-refresh interval in seconds (default: `60`) | `60` |

### Example URL

```
https://your-username.github.io/kindle-mta/?subway=R16,101&bus=308984&walk=R16:5,308984:8&labels=R16:Times+Sq,308984:34th+St&n=4&busKey=YOUR_BUS_KEY&proxy=https://corsproxy.io/?url=
```

## Finding Stop IDs

**Subway stop IDs:**
Download the MTA GTFS static package from https://new.mta.info/developers. Open `stops.txt` inside the zip. Use the parent station ID (e.g. `R16`) to show both uptown and downtown in one two-column card. Append `N` or `S` (e.g. `R16N`) to show only one direction.

**Bus stop IDs:**
Visit https://bustime.mta.info and click on your stop on the map. The numeric stop code appears in the popup or URL.

## CORS Proxy Setup

MTA APIs do not allow direct cross-origin browser requests. You need a CORS proxy.

**Quick option — corsproxy.io (free, no setup):**
```
&proxy=https://corsproxy.io/?url=
```
This is the default and works for personal use.

**Reliable option — Cloudflare Workers (free, recommended):**

1. Create a free Cloudflare account at https://workers.cloudflare.com
2. Create a new Worker and paste this script:

```javascript
export default {
  async fetch(request) {
    const url = new URL(request.url);
    const target = url.searchParams.get('url');
    if (!target) return new Response('Missing url param', { status: 400 });
    const resp = await fetch(target);
    const headers = new Headers(resp.headers);
    headers.set('Access-Control-Allow-Origin', '*');
    return new Response(resp.body, { status: resp.status, headers });
  }
};
```

3. Deploy it and use `https://your-worker.workers.dev/?url=` as the `proxy` parameter.

## Bus API Key

Bus arrivals require a free MTA Bus Time API key. Register at:
https://bustime.mta.info/wiki/Developers/Index

Subway arrivals and service alerts work without any API key.

## Development

```bash
npm install
npm start          # Dev server at http://localhost:4200
npm run build      # Production build → dist/kindle-mta/browser/
```

## Deployment to GitHub Pages

The included GitHub Actions workflow (`.github/workflows/deploy.yml`) automatically builds and deploys to GitHub Pages on every push to `main`.

**Setup:**
1. Push this repo to GitHub
2. Go to **Settings → Pages** and set Source to **GitHub Actions**
3. Push to `main` — the workflow handles the rest

## License

Apache-2.0
