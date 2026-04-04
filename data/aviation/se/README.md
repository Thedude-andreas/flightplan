# Swedish Aviation Data

This directory is the Swedish-first aviation data workspace for `AMC` and `Flightplan`.

## Source Priority
1. **LFV eAIP / AIP Sweden** via `https://aro.lfv.se/`
2. **AIP SUP / NOTAM-derived temporary restrictions** from LFV
3. Optional supplementary datasets only when LFV/AIP is missing a field

## Directory Layout
- `raw/lfv/`
  - `ES-AD-1.1-en-GB.html` - local AD 1.1 source used by the airport parser
  - `AIP_OFFLINE.zip` - official LFV offline package
  - `AIP_OFFLINE/` - extracted source tree
  - `searchIndex.current.js` - cached current LFV eAIP search index used as online fallback for AD 2 airport coordinates
- `normalized/`
  - `lfv-manifest.json` - discovered file inventory
  - `airports.se.json` - normalized airports/aerodromes
  - `airspaces.se.json` - normalized airspaces
  - `places.se.json` - normalized Swedish place gazetteer for waypoint labels
  - `navaids.se.json` - normalized navaids/frequencies
  - `airspace-frequencies.se.json` - normalized ENR 2.1 airspace frequencies
  - `airport-frequencies.se.json` - normalized AD 2.18 airport ATS frequencies
  - `acc-sectors.se.json` - normalized ENR 2.2 ACC sector polygons and frequencies
  - `radio-nav.se.json` - combined radio/NAV dataset used by the app
  - `aviation.se.index.json` - summary entry point

## Workflow
```bash
npm run aviation:se:airports
npm run aviation:se:airspaces
npm run aviation:se:radio-nav
npm run aviation:se:places
npm run aviation:se:build
npm run aviation:se:validate
```

Use the commands above for a normal refresh of map data.

If you want to refresh from a fresh LFV offline package as well:

```bash
npm run aviation:se:fetch
npm run aviation:se:extract
npm run aviation:se:manifest
npm run aviation:se:airports
npm run aviation:se:airspaces
npm run aviation:se:radio-nav
npm run aviation:se:places
npm run aviation:se:build
```

## What Each Script Does

- `aviation:se:fetch`
  Downloads LFV `AIP_OFFLINE.zip` into `raw/lfv/`.

- `aviation:se:extract`
  Extracts the offline package into `raw/lfv/AIP_OFFLINE/`.

- `aviation:se:manifest`
  Creates `normalized/lfv-manifest.json` from the extracted offline package.

- `aviation:se:airports`
  Parses airports from `AD 1.1` and fills missing ARP coordinates from `AD 2`.
  Source priority:
  1. local `AIP_OFFLINE` `searchIndex.js`
  2. current LFV eAIP online `searchIndex.js`
  3. cached `raw/lfv/searchIndex.current.js` if the online fetch is temporarily unavailable

- `aviation:se:airspaces`
  Fetches polygon data for `CTR`, `TMA`, `ATZ` and `TRA` from LFV Digital AIM WFS.

- `aviation:se:places`
  Downloads the Sweden dump from GeoNames and filters it into a local gazetteer of settlements, lakes, islands, water features and mountains used for non-airport waypoint labels.

- `aviation:se:radio-nav`
  Parses:
  - `AD 2.18` ATS communication facilities for airport `TWR`, `GND`, `APP`, `ATIS`, `AFIS`, `PAR`
  - `ENR 2.1` frequencies for `FIR`, `TMA`, `TIA`, `TIZ`
  - `ENR 2.2` ACC sector polygons and frequencies for route-based `Sweden Control`
  - LFV WFS navaid layers for `VOR`, `DME`, `DMEV`, `NDB`

- `aviation:se:build`
  Rebuilds the normalized index file and derived outputs for `navaids`, `airport-frequencies`, `airspace-frequencies` and `acc-sectors`.

- `aviation:se:refresh`
  Runs the full Swedish aviation data pipeline in one command.

- `aviation:se:validate`
  Checks counts, required airports, required airspace kinds and key radio records before the data is accepted.

- `aviation:se:diff-report`
  Compares normalized datasets against `HEAD` and emits a short markdown report for PR review.

## Outputs Used By The App

Airport parser output:

- `normalized/airports.se.json`
- `src/features/flightplan/generated/airports.se.ts`

Airspace parser output:

- `normalized/airspaces.se.json`
- `src/features/flightplan/generated/airspaces.se.ts`

Place gazetteer output:

- `normalized/places.se.json`
- `public/flightplan-data/places.se.json`
- `src/features/flightplan/generated/places.se.ts`

Index builder output:

- `normalized/aviation.se.index.json`
- `normalized/navaids.se.json`
- `normalized/airspace-frequencies.se.json`
- `normalized/airport-frequencies.se.json`
- `normalized/acc-sectors.se.json`
- `normalized/radio-nav.se.json`
- `src/features/flightplan/generated/radio-nav.se.ts`

## Updating Airports

The airport parser is implemented in `scripts/aviation-se/parse-ad-1.1-airports.mjs`.

Important behavior:

- The base list comes from `LFV AD 1.1`.
- Airports that say `Details, see AD 2` get their missing coordinates from `AD 2`.
- The parser prefers offline LFV files when available, but can update from the current online eAIP without the full offline package.
- Generated airport files should never be edited manually.

Typical command:

```bash
npm run aviation:se:airports
```

## Updating Airspaces

The airspace parser is implemented in `scripts/aviation-se/parse-lfv-wfs-airspaces.mjs`.

Important behavior:

- Data comes from `https://daim.lfv.se/geoserver/ows`
- Only these airspace classes are imported: `CTR`, `TMA`, `ATZ`, `TRA`
- Geometry is normalized to `Polygon` or `MultiPolygon`
- Generated airspace files should never be edited manually

Typical command:

```bash
npm run aviation:se:airspaces
```

## Updating Place Names

The place parser is implemented in `scripts/aviation-se/parse-geonames-places.mjs`.

Important behavior:

- Data comes from `https://download.geonames.org/export/dump/SE.zip`
- The parser keeps a reduced Swedish gazetteer for `settlement`, `lake`, `water`, `island` and `mountain`
- The generated TypeScript file only contains the reduced fields needed by the client
- Generated place files should never be edited manually

Typical command:

```bash
npm run aviation:se:places
```

## Updating Radio/NAV Data

The radio/NAV parser is implemented in `scripts/aviation-se/parse-lfv-radio-nav.mjs`.

Important behavior:

- airport frequencies come from `AD 2.18`
- crossed `Sweden CTL` sectors come from `ENR 2.2 ACC-sectors`
- crossed `TMA`, `TIA`, `TIZ` frequencies come from `ENR 2.1`
- navaid frequencies come from LFV WFS
- `121.500` and `By directive from TWR` airport rows are excluded from standard autofill
- COM frequencies are formatted as `MHz`
- DME channels are formatted as `CH XX`

Typical command:

```bash
npm run aviation:se:radio-nav
```

## Verification Checklist

After updating airport or airspace data, always run:

```bash
npm run aviation:se:validate
npm run build
npm run lint
```

Then verify at least:

- airport markers render on the map
- airspace overlays render and toggle correctly
- non-airport waypoints pick up nearby Swedish place names when relevant
- `normalized/*.json` and `src/features/flightplan/generated/*.ts` were regenerated as expected

## Automation

The repo now contains a scheduled workflow in `.github/workflows/aviation-data-refresh.yml`.

Its intended flow is:

1. refresh the Swedish aviation datasets
2. validate the normalized outputs
3. generate a markdown diff report
4. open or update a PR with only the generated app-facing datasets

This keeps automated source refresh separate from production deployment.

## Parsing Roadmap
- `AD 2` -> airports, runways, frequencies, elevation
- `ENR 2` -> permanent airspaces
- `ENR 4` -> navaids, fixes and radio nav references
- `AIP SUP` -> temporary restrictions and supplementary polygons

## Notes
- The LFV offline archive is large, around 927 MB as of March 12, 2026.
- Airport updates do not require the full offline package if the online LFV eAIP is reachable.
- Airspace updates currently depend on LFV Digital AIM WFS being reachable.
- Place-name updates currently depend on the GeoNames Sweden dump being reachable.
- Normalized files should be treated as generated artifacts from official AIP source, not hand-edited application data.
