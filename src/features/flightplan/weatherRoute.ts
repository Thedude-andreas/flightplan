import type { FlightPlanInput } from './types'
import type { LfvLhpArea, LfvWindLevel } from './weather'

export type RelevantLhpArea = {
  area: LfvLhpArea
  matchedLevels: Array<{
    level: LfvWindLevel
    legLabels: string[]
    altitudeLabels: string[]
  }>
}

function normalizeWhitespace(value: string) {
  return value
    .replace(/\r/g, '')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

function midpoint(
  from: FlightPlanInput['routeLegs'][number]['from'],
  to: FlightPlanInput['routeLegs'][number]['to'],
) {
  return {
    lat: (from.lat + to.lat) / 2,
    lon: (from.lon + to.lon) / 2,
  }
}

function getBroadLhpAreaId(point: { lat: number; lon: number }): LfvLhpArea['id'] {
  if (point.lat >= 63.2) {
    return 'se4'
  }

  if (point.lat >= 60.4) {
    return 'se3'
  }

  if (point.lat < 58.9 && point.lon <= 14.2) {
    return 'se1'
  }

  return 'se2'
}

export function parseAltitudeFeet(value: string) {
  const normalized = value.trim().toUpperCase()
  if (!normalized) {
    return null
  }

  const flightLevelMatch = normalized.match(/^F?L?\s*(\d{2,3})$/)
  if (flightLevelMatch && normalized.includes('FL')) {
    return Number.parseInt(flightLevelMatch[1], 10) * 100
  }

  if (/^F\d{2,3}$/.test(normalized)) {
    return Number.parseInt(normalized.slice(1), 10) * 100
  }

  const feetMatch = normalized.match(/(\d{3,5})/)
  return feetMatch ? Number.parseInt(feetMatch[1], 10) : null
}

function getNearestWindLevel(altitudeFt: number, levels: LfvWindLevel[]) {
  return levels.reduce<LfvWindLevel | null>((best, level) => {
    if (!best) {
      return level
    }

    return Math.abs(level.altitudeFt - altitudeFt) < Math.abs(best.altitudeFt - altitudeFt)
      ? level
      : best
  }, null)
}

export function formatWeatherBriefingText(value: string | null) {
  if (!value) {
    return null
  }

  return normalizeWhitespace(
    value
      .replace(/\b(Måttlig eller svår turbulens)\b/g, '\n$1')
      .replace(/\b(Måttlig eller svår isbildning)\b/g, '\n$1')
      .replace(/\b(Sikt\/Väder\/Moln)\b/g, '\n$1')
      .replace(/\b(Molnöversida)\b/g, '\n$1')
      .replace(/\b(CB\/TCU Moln)\b/g, '\n$1')
      .replace(/\b(Nollgradersisoterm)\b/g, '\n$1')
      .replace(/\b(Vind vid marken)\b/g, '\n$1')
      .replace(/\b(Genomsnittlig vind och temperatur för området)\b/g, '\n$1')
      .replace(/\b(Lägsta QNH)\b/g, '\n$1')
      .replace(/(\d{2}-\d{2}UTC:)/g, '\n$1')
      .replace(/\n{3,}/g, '\n\n'),
  )
}

export function getRelevantLhpAreas(
  routeLegs: FlightPlanInput['routeLegs'],
  areas: LfvLhpArea[],
): RelevantLhpArea[] {
  const areaMap = new Map(areas.map((area) => [area.id, area]))
  const grouped = new Map<LfvLhpArea['id'], Map<string, { level: LfvWindLevel; legLabels: string[]; altitudeLabels: string[] }>>()

  for (const leg of routeLegs) {
    const areaId = getBroadLhpAreaId(midpoint(leg.from, leg.to))
    const area = areaMap.get(areaId)
    if (!area || area.windLevels.length === 0) {
      continue
    }

    const altitudeLabel = leg.altitude.trim() || "3000'"
    const altitudeFt = parseAltitudeFeet(altitudeLabel) ?? 3000
    const level = getNearestWindLevel(altitudeFt, area.windLevels)
    if (!level) {
      continue
    }

    if (!grouped.has(areaId)) {
      grouped.set(areaId, new Map())
    }

    const levelMap = grouped.get(areaId) as Map<string, { level: LfvWindLevel; legLabels: string[]; altitudeLabels: string[] }>
    const existing = levelMap.get(level.label)
    const legLabel = `${leg.from.name} - ${leg.to.name}`

    if (existing) {
      if (!existing.legLabels.includes(legLabel)) {
        existing.legLabels.push(legLabel)
      }
      if (!existing.altitudeLabels.includes(altitudeLabel)) {
        existing.altitudeLabels.push(altitudeLabel)
      }
      continue
    }

    levelMap.set(level.label, {
      level,
      legLabels: [legLabel],
      altitudeLabels: [altitudeLabel],
    })
  }

  return Array.from(grouped.entries())
    .map(([areaId, levelMap]) => {
      const area = areaMap.get(areaId)
      if (!area) {
        return null
      }

      return {
        area,
        matchedLevels: Array.from(levelMap.values()).sort((left, right) => left.level.altitudeFt - right.level.altitudeFt),
      }
    })
    .filter((value): value is RelevantLhpArea => Boolean(value))
}
