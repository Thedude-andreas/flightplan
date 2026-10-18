import { useState } from 'react'
import { bullseyeDestination, bullseyeRelative, parseBullseyeCoordinates, type BullseyePoint, type CoordinateSystem } from './bullseye'
import { calculateMagneticVariation } from './magneticVariation'
import { formatCoordinateDms } from './coordinates'
import './bullseye.css'

export function BullseyePanel({ origin, target, date, onOrigin, onTarget, onClear, onClose }: {
  origin: BullseyePoint | null; target: BullseyePoint | null; date: string
  onOrigin: (point: BullseyePoint) => void; onTarget: (point: BullseyePoint) => void; onClear: () => void; onClose: () => void
}) {
  const [system, setSystem] = useState<CoordinateSystem>('dd')
  const [first, setFirst] = useState(origin ? String(origin.lat) : '')
  const [second, setSecond] = useState(origin ? String(origin.lon) : '')
  const [zone, setZone] = useState('34')
  const [south, setSouth] = useState(false)
  const [definition, setDefinition] = useState('')
  const [reference, setReference] = useState<'M' | 'T'>('M')
  const [bearing, setBearing] = useState('')
  const [distance, setDistance] = useState('')
  const [unit, setUnit] = useState<'NM' | 'km'>('NM')
  const [error, setError] = useState('')
  const plannedDate = new Date(`${date}T12:00:00`)
  const validDate = !Number.isNaN(plannedDate.getTime()) && plannedDate.getFullYear() >= 2025 && plannedDate.getFullYear() < 2030
  const variation = origin && validDate ? calculateMagneticVariation(origin.lat, origin.lon, 0, plannedDate).declination : null
  const declination = reference === 'M' ? variation : 0
  const relative = origin && target && declination !== null ? bullseyeRelative(origin, target, declination) : null
  const geographic = ['dd', 'ddm', 'dms'].includes(system)
  const coordinates = (p: BullseyePoint) => `${formatCoordinateDms(p.lat, 'lat')} ${formatCoordinateDms(p.lon, 'lon')}`
  const attempt = (action: () => void) => { try { action(); setError('') } catch (e) { setError(e instanceof Error ? e.message : 'Kontrollera inmatningen.') } }
  return <aside className="fp-bullseye-panel" aria-label="Bullseye planeringsverktyg" onClick={event => event.stopPropagation()}>
    <div className="fp-map-panel-header"><strong>Bullseye · planering</strong><button type="button" className="fp-map-panel-close" aria-label="Stäng bullseye" onClick={onClose}>×</button></div>
    <form onSubmit={event => { event.preventDefault(); attempt(() => onOrigin(parseBullseyeCoordinates(system, first, second, zone, south, definition))) }}>
      <label>Koordinatsystem<select value={system} onChange={e => { setSystem(e.target.value as CoordinateSystem); setFirst(''); setSecond(''); setError('') }}>
        <option value="dd">WGS84 · decimalgrader</option><option value="ddm">WGS84 · grader/minuter</option><option value="dms">WGS84 · grader/minuter/sekunder</option><option value="sweref">SWEREF 99 TM</option><option value="rt90">RT90 2,5 gon V</option><option value="utm">WGS84 / UTM</option><option value="mgrs">MGRS (WGS84)</option><option value="custom">Annat · egen PROJ-definition</option>
      </select></label>
      {system === 'utm' && <div className="fp-bullseye-fields"><label>Zon<input value={zone} onChange={e => setZone(e.target.value)} inputMode="numeric" /></label><label>Halvklot<select value={south ? 'S' : 'N'} onChange={e => setSouth(e.target.value === 'S')}><option value="N">Norra</option><option value="S">Södra</option></select></label></div>}
      {system === 'custom' && <label>PROJ-definition<textarea value={definition} onChange={e => setDefinition(e.target.value)} placeholder="+proj=utm +zone=33 +datum=WGS84 +units=m" /></label>}
      <div className="fp-bullseye-fields"><label>{system === 'mgrs' ? 'MGRS-ruta' : geographic ? 'Latitud' : 'Nord / Y'}<input required value={first} onChange={e => setFirst(e.target.value)} placeholder={system === 'dd' ? '65.55' : system === 'ddm' ? '65 33.0 N' : system === 'dms' ? '65 33 00 N' : ''} /></label>
      {system !== 'mgrs' && <label>{geographic ? 'Longitud' : 'Öst / X'}<input required value={second} onChange={e => setSecond(e.target.value)} placeholder={system === 'dd' ? '22.13' : system === 'ddm' ? '22 7.8 E' : system === 'dms' ? '22 7 48 E' : ''} /></label>}</div>
      <button type="submit">Ange bullseye</button>
    </form>
    {origin && <><p><b>Referens:</b> {coordinates(origin)}</p><small>Referenspunkten sparas på denna enhet, separat från färdplanen.</small>
      <form onSubmit={event => { event.preventDefault(); attempt(() => { if (!bearing.trim() || !distance.trim() || declination === null) throw new Error('Fyll i bäring och avstånd. Magnetisk bäring kräver flygdatum 2025–2029.'); onTarget(bullseyeDestination(origin, Number(bearing.replace(',', '.')), Number(distance.replace(',', '.')) / (unit === 'km' ? 1.852 : 1), declination)) }) }}>
      <div className="fp-bullseye-fields"><label>Nordreferens<select value={reference} onChange={e => setReference(e.target.value as 'M' | 'T')}><option value="M">Magnetisk (°M)</option><option value="T">Sann (°T)</option></select></label><label>Avståndsenhet<select value={unit} onChange={e => setUnit(e.target.value as 'NM' | 'km')}><option>NM</option><option>km</option></select></label></div>
      {reference === 'M' && <small>{variation === null ? 'WMM2025 kräver flygdatum 2025–2029. Välj annars sann nord.' : `Missvisning vid bullseye: ${Math.abs(variation)}° ${variation >= 0 ? 'E' : 'W'} · ${date} · WMM2025`}</small>}
      <div className="fp-bullseye-fields"><label>Bäring från bullseye<input value={bearing} onChange={e => setBearing(e.target.value)} placeholder="090" inputMode="decimal" required /></label><label>Avstånd ({unit})<input value={distance} onChange={e => setDistance(e.target.value)} placeholder="40" inputMode="decimal" required /></label></div>
      <button type="submit" disabled={declination === null}>Markera på kartan</button></form>
      <p>Klicka i kartan för att mäta från bullseye.</p>
      {relative && target && <output aria-live="polite"><b>{relative.bearing === null ? 'Vid bullseye' : `${String(Math.round(relative.bearing) % 360).padStart(3, '0')}°${reference}`} / {(relative.distanceNm * (unit === 'km' ? 1.852 : 1)).toFixed(2)} {unit}</b><br />{coordinates(target)}</output>}
      <button type="button" onClick={onClear}>Ta bort bullseye</button>
    </>}
    {error && <p role="alert">{error}</p>}
  </aside>
}
