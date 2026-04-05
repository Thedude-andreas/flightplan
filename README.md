# Flightplan

Printable flight planning tool for general aviation in Sweden.

The app is built as a standalone React/Vite project and contains:

- printable driftfardplan layout for landscape A4
- route editor with magenta flight line and waypoint editing
- local Swedish gazetteer for naming non-airport waypoints with nearby settlements, lakes, islands and mountains
- route-based RADIO/NAV autofill from Swedish airport, airspace, ACC sector and navaid data
- fuel, STOL and weight-and-balance calculations
- Swedish LFV/AIP ingestion scripts for airport reference data

## Map editing

The map editor currently supports:

- click in the map to place the first waypoint and continue the route in click order
- drag any existing waypoint to move it
- drag directly on a route leg to insert a new waypoint
- snap to airport positions only when the click or drag lands on the airport marker itself
- ICAO labels only for waypoints that are actually snapped to airports, otherwise coordinates are shown
- direction arrows centered on the rendered route line, with arrows hidden automatically when they become too close to waypoints at the current zoom level

## Development

```bash
npm install
npm run dev
```

Create a local environment file before enabling auth:

```bash
cp .env.example .env
```

## Verification

```bash
npm run build
npm run lint
```

## Deploy

Production is served from `webroots/www/flightplan` on the remote host.

The deploy script now treats:

- `DEPLOY_PATH=webroots/www` as the explicit production webroot
- `DEPLOY_PATH=.` as a legacy value and remaps it to `webroots/www`

Publish with:

```bash
npm run deploy
```

Required deploy variables are loaded from `../AMC/.env`:

```bash
DEPLOY_HOST=...
DEPLOY_PORT=22
DEPLOY_USER=...
DEPLOY_PASS=...
DEPLOY_PATH=webroots/www
```

Do not point `DEPLOY_PATH` at the SSH home directory when publishing this app. That uploads files outside the live webroot and the public site will remain unchanged.

## Auth and Supabase

The app now contains:

- public auth routes for login, signup, email verification and password reset
- a protected `/app` workspace
- a first Supabase schema migration for users, flight plans and aircraft profiles

Configure Supabase in `.env`:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

`VITE_SUPABASE_ANON_KEY` can contain either the legacy anon key or Supabase's newer publishable key.

Apply the SQL in [`supabase/migrations/20260403_001_auth_and_private_workspace.sql`](/Users/andreasmartensson/Library/CloudStorage/SynologyDrive-Synk/Projekt/Vibe/Flightplan/supabase/migrations/20260403_001_auth_and_private_workspace.sql) and enable:

- email/password auth
- email confirmation
- password reset emails

Redirect URLs to configure in Supabase:

- local dev: `http://localhost:5173/verify-email`
- local reset: `http://localhost:5173/reset-password`

For local Supabase development:

```bash
npm run supabase:start
npm run supabase:status
```

The local CLI config lives in [`supabase/config.toml`](/Users/andreasmartensson/Library/CloudStorage/SynologyDrive-Synk/Projekt/Vibe/Flightplan/supabase/config.toml) and is already set up for:

- Vite on port `5173`
- email confirmation enabled
- local reset and verification redirects

### NOTAM proxy

Swedish NOTAM now uses a Supabase Edge Function that:

- fetches LFV `ESAA FIR VFR 24hr` briefing on demand
- parses the LFV PDF server-side
- fetches LFV eAIP `datasource.js` for AIP SUP metadata and individual eSUP pages
- caches the parsed result in `public.notam_briefing_cache`
- reuses the cached bulletin until it is older than 30 minutes

The NOTAM panel currently shows:

- aerodrome NOTAM for Swedish airports within `50 NM` of the route
- en-route NOTAM and NAV warnings matched by `PSN` coordinates, area coordinates and nearby navaids
- AIP SUP entries that are valid on the flight date in the form header and whose geometry or referenced aerodromes fall within `50 NM` of the route

AIP SUP validity is derived from LFV eSUP content. When available, the UI prefers the `Tider/Hours` section from the supplement itself so the briefing shows time-of-day windows, not only coarse `from/to` dates.

Apply the migration and deploy the function:

```bash
npm run supabase:db:push
supabase functions deploy notam-briefing
```

## Swedish aviation data

The repository contains scripts for fetching and processing Swedish LFV AIP reference data for airports and map airspaces.

```bash
npm run aviation:se:fetch
npm run aviation:se:extract
npm run aviation:se:manifest
npm run aviation:se:airports
npm run aviation:se:airspaces
npm run aviation:se:radio-nav
npm run aviation:se:places
npm run aviation:se:build
npm run aviation:se:validate
```

### Update map data

Use this when airport markers or airspaces need to be refreshed.

1. Update airport data:

```bash
npm run aviation:se:airports
```

This reads `LFV AD 1.1` from `data/aviation/se/raw/lfv/ES-AD-1.1-en-GB.html` and fills missing airport coordinates from `LFV AD 2`.

- Preferred source for `AD 2`: local `AIP_OFFLINE` extract
- Fallback source for `AD 2`: LFV current eAIP `searchIndex.js`
- Local cache for online fallback: `data/aviation/se/raw/lfv/searchIndex.current.js`

If you want a fully local/offline update flow:

```bash
npm run aviation:se:fetch
npm run aviation:se:extract
npm run aviation:se:manifest
npm run aviation:se:airports
```

2. Update airspace data:

```bash
npm run aviation:se:airspaces
```

This fetches CTR, TMA, ATZ and TRA polygons from LFV Digital AIM WFS.

3. Update place data:

```bash
npm run aviation:se:places
```

This downloads and filters the Sweden dump from GeoNames into a reduced local gazetteer used to name non-airport waypoints.

4. Update radio/NAV data:

```bash
npm run aviation:se:radio-nav
```

This parses:

- `AD 2.18` ATS communication facilities for airport `TWR`, `GND`, `APP`, `ATIS`, `AFIS`, `PAR`
- `ENR 2.1` frequencies for `FIR`, `TMA`, `TIA`, `TIZ`
- `ENR 2.2` ACC sector polygons and frequencies for `Sweden Control`
- LFV WFS navaid layers for `VOR`, `DME`, `DMEV`, `NDB`

5. Rebuild the normalized index:

```bash
npm run aviation:se:build
```

6. Validate the refreshed data:

```bash
npm run aviation:se:validate
```

7. Verify the app still builds cleanly:

```bash
npm run build
npm run lint
```

### Generated files

Airport updates regenerate:

- `data/aviation/se/normalized/airports.se.json`
- `src/features/flightplan/generated/airports.se.ts`

Airspace updates regenerate:

- `data/aviation/se/normalized/airspaces.se.json`
- `src/features/flightplan/generated/airspaces.se.ts`

Index rebuild regenerates:

- `data/aviation/se/normalized/aviation.se.index.json`
- `data/aviation/se/normalized/navaids.se.json`
- `data/aviation/se/normalized/airspace-frequencies.se.json`
- `data/aviation/se/normalized/airport-frequencies.se.json`
- `data/aviation/se/normalized/acc-sectors.se.json`
- `data/aviation/se/normalized/radio-nav.se.json`
- `src/features/flightplan/generated/radio-nav.se.ts`

Place updates regenerate:

- `data/aviation/se/normalized/places.se.json`
- `public/flightplan-data/places.se.json`
- `src/features/flightplan/generated/places.se.ts`

Do not hand-edit generated files. Re-run the scripts instead.

### RADIO/NAV behavior

The RADIO/NAV block is currently populated in this order:

- departure aerodrome `GND` and `TWR` or `AFIS`
- destination aerodrome `GND` and `TWR` or `AFIS`
- all crossed `Sweden CTL` ACC sectors in route order
- relevant crossed `TMA`, `TIA`, `TIZ` and `CTR` frequencies
- nearby `VOR`, `DME`, `NDB` within route range

Filtering and formatting rules:

- `121.500` is excluded from the standard autofill list
- airport frequencies marked `By directive from TWR` are excluded from the standard autofill list
- COM frequencies are shown as `MHz`
- DME channels are shown as `CH XX`

### Automated refresh

The repo now includes:

- `npm run aviation:se:refresh` to run the full Swedish data pipeline end to end
- `npm run aviation:se:validate` to fail fast on suspicious counts or missing key records
- `npm run aviation:se:diff-report` to summarize normalized data changes against `HEAD`
- a scheduled GitHub Actions workflow in [`/Users/andreasmartensson/Library/CloudStorage/SynologyDrive-Synk/Projekt/Vibe/Flightplan/.github/workflows/aviation-data-refresh.yml`](/Users/andreasmartensson/Library/CloudStorage/SynologyDrive-Synk/Projekt/Vibe/Flightplan/.github/workflows/aviation-data-refresh.yml)

The workflow is designed to:

- refresh LFV-derived aviation data
- validate the output
- build a markdown diff report
- open or update a PR instead of pushing data directly to live

Place-name updates are intentionally excluded from the nightly workflow. Run `npm run aviation:se:places` manually when you want to refresh the Swedish gazetteer.

Official source:

- [LFV ARO / eAIP](https://www.aro.lfv.se/)
