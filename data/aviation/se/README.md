# Swedish Aviation Data

This directory is the Swedish-first aviation data workspace for `AMC` and `Flightplan`.

## Source Priority
1. **LFV eAIP / AIP Sweden** via `https://aro.lfv.se/`
2. **AIP SUP / NOTAM-derived temporary restrictions** from LFV
3. Optional supplementary datasets only when LFV/AIP is missing a field

## Directory Layout
- `raw/lfv/`
  - `AIP_OFFLINE.zip` - official LFV offline package
  - `AIP_OFFLINE/` - extracted source tree
- `normalized/`
  - `lfv-manifest.json` - discovered file inventory
  - `airports.se.json` - normalized airports/aerodromes
  - `airspaces.se.json` - normalized airspaces
  - `navaids.se.json` - normalized navaids/frequencies
  - `aviation.se.index.json` - summary entry point

## Workflow
```bash
npm run aviation:se:fetch
npm run aviation:se:extract
npm run aviation:se:manifest
npm run aviation:se:build
```

## Parsing Roadmap
- `AD 2` -> airports, runways, frequencies, elevation
- `ENR 2` -> permanent airspaces
- `ENR 4` -> navaids, fixes and radio nav references
- `AIP SUP` -> temporary restrictions and supplementary polygons

## Notes
- The LFV offline archive is large, around 927 MB as of March 12, 2026.
- Normalized files should be treated as generated artifacts from official AIP source, not hand-edited application data.
