import { captureBullseyeClick } from './bullseyeMapClick'
import { useEffect } from 'react'
import { CircleMarker, Polyline, Tooltip, useMap } from 'react-leaflet'
import type { BullseyePoint } from './bullseye'

export function BullseyeMapLayer({ origin, target, targetLabel, onPick }: { origin: BullseyePoint | null; target: BullseyePoint | null; targetLabel: string; onPick: (point: BullseyePoint) => void }) {
  const map = useMap()
  useEffect(() => {
    const element = map.getContainer()
    const click = (event: MouseEvent) => {
      const point = map.mouseEventToLatLng(event)
      onPick({ lat: point.lat, lon: point.lng })
    }
    return captureBullseyeClick(element, click)
  }, [map, onPick])
  useEffect(() => { const point = target ?? origin; if (point) map.panTo([point.lat, point.lon]) }, [map, origin, target])
  return <>
    {origin && <CircleMarker center={[origin.lat, origin.lon]} radius={12} pathOptions={{ color: '#0079a8', fillColor: 'white', fillOpacity: 1 }} interactive={false}><Tooltip permanent direction="top">⊙ Bullseye</Tooltip></CircleMarker>}
    {target && <CircleMarker center={[target.lat, target.lon]} radius={7} pathOptions={{ color: '#0079a8', fillOpacity: 0.8 }} interactive={false}><Tooltip permanent direction="top">{targetLabel}</Tooltip></CircleMarker>}
    {origin && target && <Polyline positions={[[origin.lat, origin.lon], [target.lat, target.lon]]} pathOptions={{ color: '#0079a8', dashArray: '6 6' }} interactive={false} />}
  </>
}
