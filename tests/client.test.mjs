import test from 'node:test'
import assert from 'node:assert/strict'

test('client module registers the overlay panel', async () => {
  let entry = null
  globalThis.window = { __ModuleLoader__: { load: (value) => { entry = value } } }
  globalThis.document = {
    documentElement: {},
    body: { appendChild () {}, removeChild () {} },
    createElement: () => ({ style: {}, remove () {}, select () {}, setAttribute () {} }),
  }
  await import('../client.js')

  assert.equal(entry.id, 'dsh-diff-forge')
  const React = {
    createElement: () => ({}),
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
    useEffect: () => {},
    useRef: (initial) => ({ current: initial }),
    useCallback: (fn) => fn,
    useMemo: (fn) => fn(),
  }
  const mod = entry.factory((name) => {
    assert.equal(name, 'react')
    return React
  })
  assert.deepEqual(mod.inject, ['slots'])

  let registered = null
  const ctx = {
    locale: { register () {}, bind: () => (key) => key },
    slots: {
      inject (name, fn) { assert.equal(name, 'shell.overlay'); fn() },
      register (options) { registered = options },
    },
  }
  mod.apply(ctx)
  assert.equal(registered.id, 'diff-forge')
  assert.equal(registered.order, 44)
  assert.equal(registered.name, 'shell.overlay')
  assert.equal(registered.label(), '差分工坊')
})
