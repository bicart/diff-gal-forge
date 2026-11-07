import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { apply } from '../index.js'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXAMPLES = path.join(HERE, '..', 'examples')

function mount (root, packsDir) {
  let handler = null
  const ctx = {
    logger: { info () {} },
    effect (fn) { fn() },
    inject (services, cb) {
      if (services.includes('webServer')) {
        cb({
          get: () => ({ register: (definition) => { handler = definition.handler } }),
          effect: (fn) => fn(),
        })
      } else if (services.includes('tools')) {
        cb({ get: () => undefined, effect: (fn) => fn() })
      }
    },
  }
  apply(ctx, { root, packsDir, workDir: path.join(root, 'work') })
  return handler
}

function request (method, url, body) {
  const req = body === undefined ? Readable.from([]) : Readable.from([Buffer.from(JSON.stringify(body))])
  req.method = method
  req.url = url
  req.headers = { host: '127.0.0.1:3080' }
  return req
}

function response () {
  const chunks = []
  return {
    status: 0,
    headers: {},
    writeHead (status, headers) { this.status = status; this.headers = headers ?? {} },
    end (chunk) { if (chunk !== undefined) chunks.push(Buffer.from(chunk)) },
    get body () { return Buffer.concat(chunks) },
  }
}

async function call (handler, method, url, body) {
  const res = response()
  await handler(request(method, url, body), res)
  return res
}

test('full route flow: state, pick, recipe, render, thumb, export, prompt', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-route-'))
  try {
    const handler = mount(root, EXAMPLES)

    let res = await call(handler, 'GET', '/diff-forge/state')
    assert.equal(res.status, 200)
    const preview = JSON.parse(res.body.toString())
    assert.ok(preview.packs.some((entry) => entry.slug === 'demo'))

    // The built-in examples may grow; pin these assertions to the code-drawn pack.
    await call(handler, 'POST', '/diff-forge/set', { op: 'pack', pack: 'demo' })
    res = await call(handler, 'GET', '/diff-forge/state')
    const initial = JSON.parse(res.body.toString())
    assert.equal(initial.pack.slug, 'demo')
    assert.equal(initial.pack.slots.length, 9)
    assert.equal(initial.pack.recipes.length, 3)
    assert.ok(initial.suggestions.length >= 4)
    assert.equal(initial.state.picks.eyes, 'eyes-open')
    const version = initial.state.version

    res = await call(handler, 'GET', `/diff-forge/state?since=${version}`)
    assert.deepEqual(JSON.parse(res.body.toString()), { unchanged: true, version })

    res = await call(handler, 'POST', '/diff-forge/set', { op: 'pick', slot: 'eyes', layer: 'eyes-closed' })
    assert.equal(res.status, 200)
    const picked = JSON.parse(res.body.toString())
    assert.equal(picked.state.picks.eyes, 'eyes-closed')
    assert.equal(picked.state.version, version + 1)

    res = await call(handler, 'POST', '/diff-forge/set', { op: 'recipe', recipe: 'sunset' })
    assert.equal(JSON.parse(res.body.toString()).state.recipe, 'sunset')

    res = await call(handler, 'POST', '/diff-forge/set', { op: 'pick', slot: 'eyes', layer: 'nope' })
    assert.equal(res.status, 400)

    res = await call(handler, 'GET', '/diff-forge/render.png?w=600')
    assert.equal(res.status, 200)
    assert.equal(res.headers['content-type'], 'image/png')
    assert.deepEqual([...res.body.subarray(1, 4)], [0x50, 0x4e, 0x47])
    assert.ok(Number(res.headers['x-diff-forge-version']) >= version)

    res = await call(handler, 'GET', '/diff-forge/thumb/demo/eyes-open.png?w=96')
    assert.equal(res.status, 200)
    assert.deepEqual([...res.body.subarray(1, 4)], [0x50, 0x4e, 0x47])

    res = await call(handler, 'GET', '/diff-forge/export.png?w=1200')
    assert.equal(res.status, 200)
    assert.match(res.headers['content-disposition'], /^attachment; filename=/)

    res = await call(handler, 'GET', '/diff-forge/prompt?mode=recipe')
    assert.equal(res.status, 200)
    const brief = res.body.toString()
    assert.match(brief, /recipe/)
    assert.match(brief, /tint/)

    res = await call(handler, 'POST', '/diff-forge/set', { op: 'reset' })
    const reset = JSON.parse(res.body.toString())
    assert.equal(reset.state.recipe, null)
    assert.equal(reset.state.picks.eyes, 'eyes-open')

    // A second mount with the same work dir reads the persisted selection.
    await call(handler, 'POST', '/diff-forge/set', { op: 'pick', slot: 'mouth', layer: 'mouth-o' })
    const second = mount(root, EXAMPLES)
    res = await call(second, 'GET', '/diff-forge/state')
    assert.equal(JSON.parse(res.body.toString()).state.picks.mouth, 'mouth-o')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('user recipe directory is discovered and selectable', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-route-'))
  try {
    const handler = mount(root, EXAMPLES)
    const recipeDir = path.join(root, 'work', 'recipes')
    fs.mkdirSync(recipeDir, { recursive: true })
    fs.writeFileSync(path.join(recipeDir, 'cool.json'), JSON.stringify({
      schema: 'diff-forge/recipe@1',
      id: 'cool',
      label: '冷色',
      ops: [{ op: 'tint', color: '#3355ff', amount: 0.3 }],
    }), 'utf8')

    let res = await call(handler, 'GET', '/diff-forge/state')
    const state = JSON.parse(res.body.toString())
    assert.ok(state.pack.recipes.some((recipe) => recipe.id === 'cool' && recipe.source === 'user'))

    res = await call(handler, 'POST', '/diff-forge/set', { op: 'recipe', recipe: 'cool' })
    assert.equal(JSON.parse(res.body.toString()).state.recipe, 'cool')
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})

test('switches between a user pack and the built-in example', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'df-route-'))
  try {
    const packsDir = path.join(root, 'packs')
    fs.mkdirSync(packsDir, { recursive: true })
    fs.cpSync(path.join(EXAMPLES, 'demo'), path.join(packsDir, 'alt'), { recursive: true })
    const altFile = path.join(packsDir, 'alt', 'pack.json')
    const alt = JSON.parse(fs.readFileSync(altFile, 'utf8'))
    alt.id = 'alt'
    alt.title = 'Alt Pack'
    fs.writeFileSync(altFile, JSON.stringify(alt, null, 2), 'utf8')

    const handler = mount(root, packsDir)
    let res = await call(handler, 'GET', '/diff-forge/state')
    let state = JSON.parse(res.body.toString())
    const slugs = state.packs.map((entry) => entry.slug).sort()
    assert.ok(slugs.includes('alt') && slugs.includes('demo'), `unexpected packs: ${slugs.join(', ')}`)
    assert.ok(state.packs.some((entry) => entry.slug === 'demo' && entry.example === true))
    assert.equal(state.pack.slug, 'alt')

    res = await call(handler, 'POST', '/diff-forge/set', { op: 'pack', pack: 'demo' })
    state = JSON.parse(res.body.toString())
    assert.equal(state.pack.slug, 'demo')
    assert.equal(state.state.recipe, null)

    res = await call(handler, 'POST', '/diff-forge/set', { op: 'pack', pack: 'missing' })
    assert.equal(res.status, 400)
  } finally {
    fs.rmSync(root, { recursive: true, force: true })
  }
})
