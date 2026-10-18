import test from 'node:test'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
const bundled = await build({ entryPoints: ['src/features/flightplan/bullseye.ts'], bundle: true, platform: 'browser', format: 'esm', write: false })
const { bullseyeRelative, bullseyeDestination, parseBullseyeCoordinates } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'))
const close = (a, b, tolerance = 1e-8) => assert.ok(Math.abs(a - b) < tolerance, `${a} ≠ ${b}`)
test('WGS84 equatorial geodesic has known length and initial bearing', () => {
  const result = bullseyeRelative({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })
  close(result.distanceNm * 1852, 111319.49079327357, 0.001)
  close(result.bearing, 90)
})
test('inverse/direct round trip, including high latitude and antimeridian', () => {
  for (const origin of [{ lat: 65.55, lon: 22.13 }, { lat: 80, lon: 179.8 }, { lat: -40, lon: -179 }]) {
    for (const bearing of [0, 90, 179, 270, 359]) {
      const target = bullseyeDestination(origin, bearing, 40, 12)
      const result = bullseyeRelative(origin, target, 12)
      close(result.distanceNm, 40)
      close(((result.bearing - bearing + 540) % 360) - 180, 0)
    }
  }
})
test('zero range has no bearing; invalid inputs fail', () => {
  const p = { lat: 65, lon: 22 }
  assert.equal(bullseyeRelative(p, p).bearing, null)
  for (const [bearing, distance] of [[NaN, 2], [90, -1], [90, Infinity], [361, 40]]) assert.throws(() => bullseyeDestination(p, bearing, distance))
})
test('geographic coordinate formats and hemispheres', () => {
  close(parseBullseyeCoordinates('dd', '65,55', '22.13').lat, 65.55)
  close(parseBullseyeCoordinates('ddm', '65 33 N', '22 7.8 E').lon, 22.13)
  close(parseBullseyeCoordinates('dms', '65°33\'00"S', '22 7 48 W').lat, -65.55)
  close(parseBullseyeCoordinates('ddm', '-0 30', '22 0').lat, -0.5)
  for (const args of [['dd', '', '22'], ['dd', '91', '22'], ['dms', '65 60 0', '22 0 0'], ['dd', '-65N', '22'], ['dd', '65E', '22'], ['utm', '0', '500000', '61']]) assert.throws(() => parseBullseyeCoordinates(...args))
})
test('UTM/SWEREF central meridian, MGRS and RT90 reference', () => {
  const sweref = parseBullseyeCoordinates('sweref', '0', '500000')
  close(sweref.lat, 0); close(sweref.lon, 15)
  const utm = parseBullseyeCoordinates('utm', '0', '500000', '34')
  close(utm.lat, 0); close(utm.lon, 21)
  const southern = parseBullseyeCoordinates('utm', '10000000', '500000', '34', true)
  close(southern.lat, 0)
  const grid = parseBullseyeCoordinates('mgrs', '31NAA6602100000', '')
  close(grid.lat, 0, 0.0001); close(grid.lon, 0, 0.0001)
  const rt90 = parseBullseyeCoordinates('rt90', '-667.711', '1500064.274')
  close(rt90.lat, 0); close(rt90.lon, 15.8062845294444)
  const custom = parseBullseyeCoordinates('custom', '0', '500000', '34', false, '+proj=utm +zone=33 +datum=WGS84 +units=m')
  close(custom.lon, 15)
})
