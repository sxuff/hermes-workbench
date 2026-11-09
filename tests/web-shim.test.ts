import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

const source = readFileSync(new URL('../desktop-web/hermes-web-shim.js', import.meta.url), 'utf8')

type Shim = Record<string, any>

function load(): { desktop: Shim } {
  const win: any = {
    __hermesWebShimMissing: undefined,
  }
  win.parent = win
  const sandbox: Record<string, any> = {
    window: win,
    document: { documentElement: { style: {} } },
    location: { search: '', origin: 'http://workbench.test', host: 'workbench.test' },
    localStorage: {
      getItem: () => null,
      setItem: () => {},
      removeItem: () => {},
    },
    console: { error: () => {}, warn: () => {}, log: () => {} },
    URLSearchParams,
    setTimeout,
    clearTimeout,
  }
  vm.runInNewContext(source, sandbox, { filename: 'hermes-web-shim.js' })
  return { desktop: win.hermesDesktop }
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
