# Flightplan

Printable flight planning tool for general aviation in Sweden.

The app is built as a standalone React/Vite project and contains:

- printable driftfardplan layout for landscape A4
- route editor with magenta flight line and waypoint editing
- fuel, STOL and weight-and-balance calculations
- Swedish LFV/AIP ingestion scripts for airport reference data

## Development

```bash
npm install
npm run dev
```

## Verification

```bash
npm run build
npm run lint
```

## Swedish aviation data

The repository contains scripts for fetching and processing Swedish LFV AIP reference data for airports and map airspaces.

```bash
npm run aviation:se:fetch
npm run aviation:se:extract
npm run aviation:se:manifest
npm run aviation:se:airports
npm run aviation:se:airspaces
npm run aviation:se:build
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

3. Rebuild the normalized index:

```bash
npm run aviation:se:build
```

4. Verify the app still builds cleanly:

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

Do not hand-edit generated files. Re-run the scripts instead.

Official source:

- [LFV ARO / eAIP](https://www.aro.lfv.se/)
