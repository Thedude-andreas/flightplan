import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

function load(relativePath, globals) {
  const source = readFileSync(new URL(relativePath, import.meta.url), 'utf8')
  const js = ts.transpileModule(source.replace(/^import .*\n/gm, ''), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText
  const context = vm.createContext({ URL, URLSearchParams, Response, Request, console, exports: {}, ...globals })
  vm.runInContext(js, context)
  return context
}

function backend(fetch, cachedAirports = {}) {
  let handler
  let saved
  const api = load('../../supabase/functions/map-weather-briefing/index.ts', {
    fetch,
    Deno: { serve(fn) { handler = fn }, env: { get: () => 'configured' } },
    createClient: () => ({
      from: () => ({
        select: () => ({ eq: () => ({ maybeSingle: async () => ({
          data: { sections: { airports: cachedAirports } }, error: null,
        }) }) }),
        upsert: async (row) => { saved = row; return { error: null } },
      }),
    }),
  })
  return {
    api,
    saved: () => saved,
    request: (body) => handler(new Request('https://example.test', { method: 'POST', body: JSON.stringify(body) })),
  }
}
const airport = { icao: 'ESMB' }
const signal = new AbortController().signal

test('backend returns and caches missing reports for HTTP 204 instead of failing', async () => {
  const service = backend(async () => new Response(null, { status: 204 }))
  const response = await service.request({ icaos: ['ESMB'], includeTaf: true })
  assert.equal(response.status, 200)
  const { airports } = await response.json()
  assert.equal(airports[0].metarRawText, null)
  assert.equal(airports[0].tafRawText, null)
  assert.ok(service.saved().sections.airports.ESMB.tafFetchedAt)
})

test('missing TAF does not discard an available METAR', async () => {
  const service = backend(async (url) => url.includes('/metar?')
    ? Response.json([{ icaoId: 'ESMB', rawOb: 'METAR ESMB', obsTime: 1780000000 }])
    : new Response(null, { status: 204 }))
  const response = await service.request({ icaos: ['ESMB'], includeTaf: true })
  const { airports } = await response.json()
  assert.equal(airports[0].metarRawText, 'METAR ESMB')
  assert.equal(airports[0].tafRawText, null)
})

test('upstream errors and malformed JSON remain failures', async () => {
  for (const response of [new Response('unavailable', { status: 503 }), new Response('invalid json')]) {
    const service = backend(async () => response)
    await assert.rejects(() => service.api.fetchAviationWeatherJson('metar', ['ESMB']))
  }
})

test('normal requests use fresh cache; forced refresh fetches both METAR and TAF', async () => {
  const now = new Date().toISOString()
  let calls = 0
  const service = backend(async () => { calls++; return new Response(null, { status: 204 }) }, {
    ESMB: { fetchedAt: now, tafFetchedAt: now, metarRawText: 'OLD METAR', tafRawText: 'OLD TAF' },
  })
  const cached = await service.request({ icaos: ['ESMB'], includeTaf: true })
  assert.equal((await cached.json()).airports[0].metarRawText, 'OLD METAR')
  assert.equal(calls, 0)
  const refreshed = await service.request({ icaos: ['ESMB'], includeTaf: true, forceRefresh: true })
  assert.equal(refreshed.status, 200)
  assert.equal(calls, 2)
  assert.equal((await refreshed.json()).airports[0].metarRawText, null)
})

test('client forwards explicit refresh and uses cache by default', async () => {
  const bodies = []
  const api = load('../../src/features/flightplan/weather.ts', {
    getSupabaseClient: () => ({ functions: { invoke: async (name, { body }) => {
      assert.equal(name, 'map-weather-briefing')
      bodies.push(body)
      return { data: { airports: [] }, error: null }
    } } }),
  }).exports
  await api.fetchWeatherForAirports([airport], signal)
  await api.fetchWeatherForAirports([airport], signal, true)
  assert.equal(bodies[0].forceRefresh, false)
  assert.equal(bodies[1].forceRefresh, true)
  assert.equal(bodies[1].includeTaf, true)
})

test('direct client fallback also treats HTTP 204 as missing reports', async () => {
  const api = load('../../src/features/flightplan/weather.ts', {
    getSupabaseClient: () => null,
    fetch: async () => new Response(null, { status: 204 }),
  }).exports
  const results = await api.fetchWeatherForAirports([airport], signal)
  assert.equal(results[0].metarRawText, null)
  assert.equal(results[0].tafRawText, null)
})
