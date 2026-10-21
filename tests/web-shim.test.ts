import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../desktop-web/hermes-web-shim.js', import.meta.url), 'utf8')

type Shim = Record<string, any>

function load(seed: Record<string, string> = {}): { desktop: Shim; doc: any; storage: Map<string, string> } {
  const storage = new Map<string, string>(Object.entries(seed))
  const style: Record<string, string> = {}
  const doc = { documentElement: { style } }
  const win: any = {
    __hermesWebShimMissing: undefined,
  }
  win.parent = win
  const sandbox: Record<string, any> = {
    window: win,
    document: doc,
    location: { search: '', origin: 'http://workbench.test', host: 'workbench.test' },
    localStorage: {
      getItem: (k: string) => (storage.has(k) ? storage.get(k)! : null),
      setItem: (k: string, v: string) => { storage.set(k, String(v)) },
      removeItem: (k: string) => { storage.delete(k) },
    },
    console: { error: () => {}, warn: () => {}, log: () => {} },
    URLSearchParams,
    setTimeout,
    clearTimeout,
  }
  vm.runInNewContext(source, sandbox, { filename: 'hermes-web-shim.js' })
  return { desktop: win.hermesDesktop, doc, storage }
}

test('shim: Electron-only members stay null so the renderer can test for absence', () => {
  const { desktop } = load()
  // themes/backend-sync.ts: (window.hermesDesktop?.localSkin ?? null)?.skin ?? null
  // A callable-Proxy fallback here yields a function instead of null, and the
  // following `.trim()` throws "Cannot read properties of undefined (reading 'trim')".
  assert.equal(desktop.localSkin, null)
  assert.equal(desktop.windowControls, null)
})

test('shim: unknown members still resolve to callable stubs', () => {
  const { desktop } = load()
  assert.equal(typeof desktop.somethingNotDeclared, 'function')
})

test('shim: zoom.get returns the desktop shape', async () => {
  const { desktop } = load()
  const state = await desktop.zoom.get()
  assert.equal(state.percent, 100)
  assert.equal(state.level, 0)
})

test('shim: setPercent scales the document, persists and notifies', async () => {
  const { desktop, doc, storage } = load()
  const seen: number[] = []
  const unsubscribe = desktop.zoom.onChanged((state: { percent: number }) => { seen.push(state.percent) })

  const state = await desktop.zoom.setPercent(150)
  assert.equal(state.percent, 150)
  assert.equal(doc.documentElement.style.zoom, '1.5')
  assert.equal(Number(storage.get('hermes-web:zoomPercent')), 150)
  assert.deepEqual(seen, [150])

  unsubscribe()
  await desktop.zoom.setPercent(120)
  assert.deepEqual(seen, [150], 'listener must not fire after unsubscribe')
})

test('shim: setPercent clamps to the desktop range', async () => {
  const { desktop } = load()
  const high = await desktop.zoom.setPercent(10000)
  assert.equal(high.percent, Math.round(Math.pow(1.2, 9) * 100))
  const low = await desktop.zoom.setPercent(1)
  assert.equal(low.percent, Math.round(Math.pow(1.2, -9) * 100))
})

test('shim: zoom survives a reload', async () => {
  const first = load()
  await first.desktop.zoom.setPercent(125)
  const persisted = Object.fromEntries(first.storage)

  const second = load(persisted)
  assert.equal(second.doc.documentElement.style.zoom, '1.25')
  assert.equal((await second.desktop.zoom.get()).percent, 125)
})

test('shim: legacy names stay usable', async () => {
  const { desktop } = load()
  assert.equal(typeof desktop.zoom.set, 'function')
  const off = desktop.zoom.onChange(() => {})
  assert.equal(typeof off, 'function')
})
