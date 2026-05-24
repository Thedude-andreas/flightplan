import type { SwedishAirspace } from './aviationData'
import type { ExpressionSpecification } from 'mapbox-gl'

type AirspaceKind = SwedishAirspace['kind']

type AeronauticalAirspaceStyle = {
  strokeColor: string
  fillColor: string
  leafletDashArray?: string
  mapboxDashArray: number[]
  lineCap: 'butt' | 'round' | 'square'
}

const controlledAirspaceBlue = '#0057a8'
const restrictedAirspaceMagenta = '#d4146f'

const airspaceStyles: Record<AirspaceKind, AeronauticalAirspaceStyle> = {
  TMA: {
    strokeColor: controlledAirspaceBlue,
    fillColor: '#7fb3e6',
    mapboxDashArray: [1, 0],
    lineCap: 'butt',
  },
  CTR: {
    strokeColor: controlledAirspaceBlue,
    fillColor: '#8bbce9',
    leafletDashArray: '10 6',
    mapboxDashArray: [5, 3],
    lineCap: 'butt',
  },
  TIA: {
    strokeColor: controlledAirspaceBlue,
    fillColor: '#9fc8ee',
    leafletDashArray: '12 4 3 4',
    mapboxDashArray: [6, 2, 1.5, 2],
    lineCap: 'butt',
  },
  TIZ: {
    strokeColor: controlledAirspaceBlue,
    fillColor: '#9fc8ee',
    leafletDashArray: '12 5',
    mapboxDashArray: [6, 2.5],
    lineCap: 'butt',
  },
  ATZ: {
    strokeColor: controlledAirspaceBlue,
    fillColor: '#b8d5f0',
    leafletDashArray: '1 7',
    mapboxDashArray: [0.6, 3.5],
    lineCap: 'round',
  },
  R: {
    strokeColor: restrictedAirspaceMagenta,
    fillColor: '#f6a4c7',
    mapboxDashArray: [1, 0],
    lineCap: 'butt',
  },
  D: {
    strokeColor: restrictedAirspaceMagenta,
    fillColor: '#f6a4c7',
    leafletDashArray: '10 5',
    mapboxDashArray: [5, 2.5],
    lineCap: 'butt',
  },
  TRA: {
    strokeColor: restrictedAirspaceMagenta,
    fillColor: '#f3b5d0',
    leafletDashArray: '14 4 3 4',
    mapboxDashArray: [7, 2, 1.5, 2],
    lineCap: 'butt',
  },
}

const defaultAirspaceStyle = airspaceStyles.TMA

export function getAeronauticalAirspaceStyle(kind: string | null | undefined) {
  return airspaceStyles[kind as AirspaceKind] ?? defaultAirspaceStyle
}

export function getLeafletAirspacePathOptions(
  kind: string | null | undefined,
  options: { highlighted?: boolean } = {},
) {
  const style = getAeronauticalAirspaceStyle(kind)
  const highlighted = options.highlighted ?? false

  return {
    color: style.strokeColor,
    weight: highlighted ? 3.2 : 1.7,
    opacity: highlighted ? 1 : 0.96,
    fillColor: style.fillColor,
    fillOpacity: highlighted ? 0 : 0.06,
    dashArray: style.leafletDashArray,
    lineCap: style.lineCap,
    lineJoin: 'round' as const,
  }
}

export function getMapboxAirspaceColorExpression(): ExpressionSpecification {
  return [
    'match',
    ['get', 'kind'],
    'R',
    airspaceStyles.R.strokeColor,
    'D',
    airspaceStyles.D.strokeColor,
    'TRA',
    airspaceStyles.TRA.strokeColor,
    controlledAirspaceBlue,
  ]
}

export function getMapboxAirspaceFillColorExpression(): ExpressionSpecification {
  return [
    'match',
    ['get', 'kind'],
    'R',
    airspaceStyles.R.fillColor,
    'D',
    airspaceStyles.D.fillColor,
    'TRA',
    airspaceStyles.TRA.fillColor,
    'ATZ',
    airspaceStyles.ATZ.fillColor,
    'TIA',
    airspaceStyles.TIA.fillColor,
    'TIZ',
    airspaceStyles.TIZ.fillColor,
    'CTR',
    airspaceStyles.CTR.fillColor,
    airspaceStyles.TMA.fillColor,
  ]
}

export function getMapboxAirspaceDashArrayExpression(): ExpressionSpecification {
  return [
    'match',
    ['get', 'kind'],
    'CTR',
    ['literal', [...airspaceStyles.CTR.mapboxDashArray]],
    'TIA',
    ['literal', [...airspaceStyles.TIA.mapboxDashArray]],
    'TIZ',
    ['literal', [...airspaceStyles.TIZ.mapboxDashArray]],
    'ATZ',
    ['literal', [...airspaceStyles.ATZ.mapboxDashArray]],
    'D',
    ['literal', [...airspaceStyles.D.mapboxDashArray]],
    'TRA',
    ['literal', [...airspaceStyles.TRA.mapboxDashArray]],
    ['literal', [1, 0]],
  ]
}
