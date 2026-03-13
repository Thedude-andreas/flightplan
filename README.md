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

The repository contains scripts for fetching and processing Swedish LFV AIP reference data.

```bash
npm run aviation:se:fetch
npm run aviation:se:extract
npm run aviation:se:manifest
npm run aviation:se:airports
npm run aviation:se:build
```

Official source:

- [LFV ARO / eAIP](https://www.aro.lfv.se/)
