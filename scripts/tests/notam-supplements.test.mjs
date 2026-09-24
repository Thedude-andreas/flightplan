import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import test from 'node:test'
import ts from 'typescript'

const source = readFileSync(new URL('../../supabase/functions/notam-briefing/index.ts', import.meta.url), 'utf8')
const js = ts.transpileModule(source.replace(/^import .*\n/gm, ''), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText
function backend(fetch = () => { throw new Error('Unexpected fetch') }) {
  const context = vm.createContext({
    URL, Response, console, fetch,
    Deno: { serve() {} },
    getDocumentProxy: async () => ({}),
    extractText: async () => ({ text: 'AERODROMES EN-ROUTE NAV WARNINGS MISCELLANEOUS' }),
  })
  vm.runInContext(js, context)
  return context
}

// LFV's September 2026 index: the currently effective issue is non-AIRAC.
const index = String.raw`
<h2>Currently Effective Issue</h2>
<a href="AIP AMDT 1-2026_2026_08_07\index-v2.html">07 Aug 2026</a>
<h2>Next Issues</h2>
<a href="AIRAC AIP AMDT 6-2026_2026_10_29\index-v2.html">29 Oct 2026</td>
<h2>Previous Issues</h2>
<a href="AIRAC AIP AMDT 5-2026_2026_08_06\index-v2.html">06 Aug 2026</a>`
const currentRoot = 'https://aro.lfv.se/content/eaip/AIP%20AMDT%201-2026_2026_08_07/'

test('current issue accepts non-AIRAC amendments instead of selecting a future AIRAC', () => {
  assert.equal(backend().extractCurrentEaipRootUrl(index), currentRoot)
})
test('September flight selects the August 7 amendment, not the archived August 6 issue', () => {
  assert.equal(backend().selectEaipIssueForDate(index, '2026-09-24').rootUrl, currentRoot)
})
test('AIRAC dates still work for historical and future flights', () => {
  const api = backend()
  assert.equal(api.selectEaipIssueForDate(index, '2026-08-06').effectiveDate, '2026-08-06')
  assert.equal(api.selectEaipIssueForDate(index, '2026-10-29').effectiveDate, '2026-10-29')
  assert.equal(api.extractCurrentEaipRootUrl('<a href="AIRAC AIP AMDT 5-2026_2026_08_06/index-v2.html">'),
    'https://aro.lfv.se/content/eaip/AIRAC%20AIP%20AMDT%205-2026_2026_08_06/')
})
test('missing SUP table is an error, not a successful empty catalogue', async () => {
  await assert.rejects(backend(async () => new Response('var data = {"tabs":[]};')).extractDatasourceSupplements(currentRoot), /supplementlista/)
})
test('a SUP catalogue 404 propagates instead of silently caching trigger references only', async () => {
  const api = backend(async (url) => {
    if (url.includes('ShowFileList')) return new Response('<a href="https://aro.lfv.se/FileList/pibsweden//ESAA%20FIR%2099days_test.pdf">')
    if (url.endsWith('.pdf')) return new Response('mock PDF')
    if (url.endsWith('default_offline.html')) return new Response(index)
    return new Response('Not found', { status: 404 })
  })
  await assert.rejects(api.buildFreshCacheEntry('test', '2026-09-24'), /404/)
})
test('failed index fetch propagates and cannot produce a complete-looking briefing', async () => {
  const api = backend(async (url) => {
    if (url.includes('ShowFileList')) return new Response('<a href="https://aro.lfv.se/FileList/pibsweden//ESAA%20FIR%2099days_test.pdf">')
    if (url.endsWith('.pdf')) return new Response('mock PDF')
    return new Response('Unavailable', { status: 503 })
  })
  await assert.rejects(api.buildFreshCacheEntry('test', '2026-09-24'), /AIP SUP.*503/)
})
