import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPack, loadPack, listPacks, defaultPicks, paintOrder, PackError } from '../lib/pack.mjs'
import { encodePng } from '../lib/png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const EXAMPLES = path.join(HERE, '..', 'examples')

test('demo pack validates and exposes slots', () => {
  const pack = loadPack(EXAMPLES, 'demo')
  assert.equal(pack.slug, 'demo')
  assert.equal(pack.canvas.width, 720)
  assert.equal(pack.layers.length, 16)
  assert.equal(pack.slots.length, 9)
  const picks = defaultPicks(pack)
  assert.equal(picks.base, 'head')
  assert.equal(picks.costume, 'dress')
  assert.equal(picks.eyes, 'eyes-open')
  const order = paintOrder(pack, picks).map((layer) => layer.id)
  assert.deepEqual(order, ['hair-long', 'dress', 'head', 'eyes-open', 'mouth-smile', 'bangs-a'])
})

test('listPacks reports the built-in demo and no problems', () => {
  const { packs, problems } = listPacks(EXAMPLES)
  assert.equal(problems.length, 0)
  assert.deepEqual(packs.map((entry) => entry.slug), packs.map((entry) => entry.slug).slice().sort((a, b) => a.localeCompare(b, 'en')))
  const demo = packs.find((entry) => entry.slug === 'demo')
  assert.ok(demo, 'built-in demo pack is missing')
  assert.equal(demo.problem, undefined)
})

test('rejects traversal outside the pack directory', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-pack-'))
  try {
    fs.writeFileSync(path.join(dir, 'layer.png'), encodePng(new Uint8Array([255, 0, 0, 255]), 1, 1))
    const doc = {
      schema: 'diff-forge/pack@1',
      canvas: { width: 1, height: 1 },
      slots: [{ key: 'a', label: 'A', mode: 'single' }],
      layers: [{ id: 'a1', name: 'A1', src: '../layer.png', slot: 'a' }],
    }
    assert.throws(() => buildPack(doc, { dir }), (error) => error instanceof PackError && /inside the pack/.test(error.message))
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('rejects unknown slots and duplicate ids', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-pack-'))
  try {
    fs.writeFileSync(path.join(dir, 'a.png'), encodePng(new Uint8Array([255, 255, 255, 255]), 1, 1))
    const base = {
      schema: 'diff-forge/pack@1',
      canvas: { width: 1, height: 1 },
      slots: [{ key: 'a', label: 'A', mode: 'single' }],
      layers: [{ id: 'a1', name: 'A1', src: 'a.png', slot: 'b' }],
    }
    assert.throws(() => buildPack(base, { dir }), /unknown slot/)
    const dup = structuredClone(base)
    dup.layers[0].slot = 'a'
    dup.layers.push({ ...dup.layers[0] })
    assert.throws(() => buildPack(dup, { dir }), /duplicate layer id/)
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})

test('a pack directory may use a Unicode slug', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'df-pack-'))
  const dir = path.join(parent, '角色包')
  try {
    fs.mkdirSync(dir)
    fs.writeFileSync(path.join(dir, 'a.png'), encodePng(new Uint8Array([255, 0, 0, 255]), 1, 1))
    fs.writeFileSync(path.join(dir, 'pack.json'), JSON.stringify({
      schema: 'diff-forge/pack@1',
      id: 'zh',
      canvas: { width: 1, height: 1 },
      slots: [{ key: 'a', label: 'A', mode: 'single' }],
      layers: [{ id: 'a1', name: 'A1', src: 'a.png', slot: 'a' }],
    }), 'utf8')
    const pack = loadPack(parent, '角色包')
    assert.equal(pack.slug, '角色包')
    assert.equal(pack.id, 'zh')
    assert.equal(pack.layers.length, 1)
  } finally {
    fs.rmSync(parent, { recursive: true, force: true })
  }
})

test('a single slot falls back to its first visible layer', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'df-pack-'))
  try {
    fs.writeFileSync(path.join(dir, 'a.png'), encodePng(new Uint8Array(2 * 2 * 4).fill(255), 2, 2))
    fs.writeFileSync(path.join(dir, 'b.png'), encodePng(new Uint8Array(2 * 2 * 4).fill(128), 2, 2))
    const pack = buildPack({
      schema: 'diff-forge/pack@1',
      canvas: { width: 2, height: 2 },
      slots: [{ key: 'face', label: 'Face', mode: 'single' }],
      layers: [
        { id: 'a', name: 'A', src: 'a.png', slot: 'face', visible: false },
        { id: 'b', name: 'B', src: 'b.png', slot: 'face' },
      ],
    }, { dir })
    assert.equal(defaultPicks(pack).face, 'b')
  } finally {
    fs.rmSync(dir, { recursive: true, force: true })
  }
})
