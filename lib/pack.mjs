/**
 * Asset packs: discovery, validation, and a normalized in-memory model.
 *
 * A pack is a directory with `pack.json`, PNG layers, and optional recipes.
 * Nothing here knows about any particular game: the schema only describes a
 * canvas, layers, and exclusive slots. That is what keeps the plugin generic.
 *
 * Validation is deliberately strict and dependency-free: a pack is data from
 * the user (or an AI), so every path is confined to the pack directory and
 * every numeric field is bounded before it can reach the renderer.
 */

import fs from 'node:fs'
import path from 'node:path'
import { readPngHeader } from './png.mjs'

export const PACK_SCHEMA = 'diff-forge/pack@1'
const MAX_CANVAS = 8192
const MAX_LAYERS = 512
const MAX_SLOTS = 64

export class PackError extends Error {
  constructor (message) {
    super(message)
    this.name = 'PackError'
  }
}

const ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/
const SLOT_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,47}$/
const PNG_RE = /\.png$/i

/** Directory slugs may be Unicode (e.g. Chinese folder names), but no paths. */
function safeSlug (value) {
  const slug = String(value)
  if (slug === '' || slug.length > 64) fail('pack directory name must be 1-64 characters')
  if (slug === '.' || slug === '..') fail('invalid pack directory name')
  if (/[\\/:*?"<>|\u0000-\u001f]/.test(slug)) fail('pack directory name contains unsupported characters')
  return slug
}

function fail (message) {
  throw new PackError(message)
}

function asString (value, field, max = 200) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${field} must be a non-empty string`)
  const text = value.trim()
  if (text.length > max) fail(`${field} is longer than ${max} characters`)
  return text
}

function asInt (value, field, min, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback
  if (!Number.isInteger(value) || value < min || value > max) fail(`${field} must be an integer in [${min}, ${max}]`)
  return value
}

function asNumber (value, field, min, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${field} must be a number in [${min}, ${max}]`)
  }
  return value
}

/** Resolve a pack-relative path and refuse anything that escapes the pack. */
export function resolveInside (baseDir, rel, field) {
  if (typeof rel !== 'string' || rel.trim() === '') fail(`${field} must be a relative path`)
  if (path.isAbsolute(rel)) fail(`${field} must be relative to the pack directory`)
  const abs = path.resolve(baseDir, rel)
  const back = path.relative(baseDir, abs)
  if (back === '' || back.startsWith('..') || path.isAbsolute(back)) {
    fail(`${field} must stay inside the pack directory`)
  }
  return abs
}

/**
 * Validate a parsed pack document and resolve its layer files.
 *
 * @param {object} doc parsed pack.json
 * @param {{dir: string, dirName?: string}} context
 * @returns normalized pack model
 */
export function buildPack (doc, context) {
  const dir = path.resolve(context.dir)
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) fail('pack.json must contain an object')
  if (doc.schema !== PACK_SCHEMA) fail(`unsupported schema: ${String(doc.schema)} (expected ${PACK_SCHEMA})`)

  const id = asString(doc.id ?? context.dirName ?? path.basename(dir), 'id', 64)
  if (!ID_RE.test(id)) fail('id may only contain letters, digits, dot, dash and underscore')
  const title = asString(doc.title ?? id, 'title', 80)
  const description = doc.description === undefined ? '' : asString(doc.description, 'description', 400)

  const canvasRaw = doc.canvas
  if (canvasRaw === null || typeof canvasRaw !== 'object') fail('canvas must be an object with width and height')
  const canvas = {
    width: asInt(canvasRaw.width, 'canvas.width', 1, MAX_CANVAS),
    height: asInt(canvasRaw.height, 'canvas.height', 1, MAX_CANVAS),
  }

  if (!Array.isArray(doc.slots) || doc.slots.length === 0) fail('slots must be a non-empty array')
  if (doc.slots.length > MAX_SLOTS) fail(`at most ${MAX_SLOTS} slots are supported`)
  if (!Array.isArray(doc.layers) || doc.layers.length === 0) fail('layers must be a non-empty array')
  if (doc.layers.length > MAX_LAYERS) fail(`at most ${MAX_LAYERS} layers are supported`)

  const slots = []
  const slotByKey = new Map()
  doc.slots.forEach((raw, index) => {
    if (raw === null || typeof raw !== 'object') fail(`slots[${index}] must be an object`)
    const key = asString(raw.key, `slots[${index}].key`, 48)
    if (!SLOT_RE.test(key)) fail(`slots[${index}].key contains unsupported characters`)
    if (slotByKey.has(key)) fail(`duplicate slot key: ${key}`)
    const mode = raw.mode ?? 'single'
    if (mode !== 'single' && mode !== 'toggle') fail(`slots[${index}].mode must be "single" or "toggle"`)
    const slot = {
      key,
      label: asString(raw.label ?? key, `slots[${index}].label`, 40),
      mode,
      note: raw.note === undefined ? '' : asString(raw.note, `slots[${index}].note`, 200),
      default: raw.default === undefined ? null : asString(raw.default, `slots[${index}].default`, 64),
      groups: null,
      members: [],
    }
    slots.push(slot)
    slotByKey.set(key, slot)
  })

  const layers = []
  const layerById = new Map()
  doc.layers.forEach((raw, index) => {
    if (raw === null || typeof raw !== 'object') fail(`layers[${index}] must be an object`)
    const layerId = asString(raw.id, `layers[${index}].id`, 64)
    if (!ID_RE.test(layerId)) fail(`layers[${index}].id contains unsupported characters`)
    if (layerById.has(layerId)) fail(`duplicate layer id: ${layerId}`)
    const slot = asString(raw.slot, `layers[${index}].slot`, 48)
    if (!slotByKey.has(slot)) fail(`layers[${index}].slot references unknown slot: ${slot}`)
    const src = asString(raw.src, `layers[${index}].src`, 400)
    if (!PNG_RE.test(src)) fail(`layers[${index}].src must be a .png file`)
    const absPath = resolveInside(dir, src, `layers[${index}].src`)
    let header
    try {
      header = readPngHeader(fs.readFileSync(absPath))
    } catch (error) {
      fail(`cannot read layer PNG ${src}: ${error instanceof Error ? error.message : String(error)}`)
    }
    if (header.width < 1 || header.height < 1 || header.width > MAX_CANVAS || header.height > MAX_CANVAS) {
      fail(`layer ${layerId} has unsupported dimensions ${header.width}x${header.height}`)
    }
    const layer = {
      id: layerId,
      name: asString(raw.name ?? layerId, `layers[${index}].name`, 80),
      src,
      absPath,
      slot,
      z: asNumber(raw.z, `layers[${index}].z`, -10000, 10000, 0),
      x: asInt(raw.x, `layers[${index}].x`, -MAX_CANVAS, MAX_CANVAS, 0),
      y: asInt(raw.y, `layers[${index}].y`, -MAX_CANVAS, MAX_CANVAS, 0),
      opacity: asNumber(raw.opacity, `layers[${index}].opacity`, 0, 1, 1),
      visible: raw.visible === undefined ? true : raw.visible === true,
      tags: Array.isArray(raw.tags) ? raw.tags.filter((tag) => typeof tag === 'string').slice(0, 16) : [],
      width: header.width,
      height: header.height,
      index,
    }
    layers.push(layer)
    layerById.set(layerId, layer)
  })

  // Attach members in file order; resolve defaults after every layer is known.
  for (const layer of layers) slotByKey.get(layer.slot).members.push(layer.id)

  for (const slot of slots) {
    if (slot.default !== null && !slot.members.includes(slot.default)) {
      fail(`slot ${slot.key} default references a layer outside the slot: ${slot.default}`)
    }
    if (slot.default === null && slot.mode === 'single') {
      const firstVisible = slot.members
        .map((memberId) => layerById.get(memberId))
        .find((layer) => layer.visible)
      slot.default = firstVisible?.id ?? slot.members[0] ?? null
    }
    if (slot.default === null && slot.mode === 'toggle') slot.default = null
  }

  // Optional display groups: keep AI-authored packs able to say
  // "these two slots are conceptually one face set" without changing rendering.
  for (const rawSlot of doc.slots) {
    const slot = slotByKey.get(rawSlot.key)
    if (!Array.isArray(rawSlot.groups)) continue
    slot.groups = rawSlot.groups.slice(0, 32).map((group, groupIndex) => {
      if (group === null || typeof group !== 'object') fail(`slot ${slot.key} groups[${groupIndex}] must be an object`)
      const label = asString(group.label, `slot ${slot.key} groups[${groupIndex}].label`, 40)
      if (!Array.isArray(group.members) || group.members.length === 0) {
        fail(`slot ${slot.key} groups[${groupIndex}].members must be a non-empty array`)
      }
      const members = group.members.map((member) => asString(member, `slot ${slot.key} groups[${groupIndex}].members`, 64))
      for (const member of members) {
        if (!slot.members.includes(member)) fail(`slot ${slot.key} group "${label}" references ${member}, which is not in the slot`)
      }
      return { label, members }
    })
  }

  const recipePaths = []
  if (doc.recipes !== undefined) {
    if (!Array.isArray(doc.recipes)) fail('recipes must be an array of relative .json paths')
    for (const [index, rel] of doc.recipes.entries()) {
      const resolved = resolveInside(dir, asString(rel, `recipes[${index}]`, 400), `recipes[${index}]`)
      if (!/\.json$/i.test(resolved)) fail(`recipes[${index}] must be a .json file`)
      if (!fs.existsSync(resolved)) fail(`recipe file is missing: ${rel}`)
      recipePaths.push(resolved)
    }
  }

  const pack = {
    slug: safeSlug(context.dirName ?? path.basename(dir)),
    id,
    title,
    description,
    author: doc.author === undefined ? '' : asString(doc.author, 'author', 120),
    license: doc.license === undefined ? '' : asString(doc.license, 'license', 120),
    homepage: doc.homepage === undefined ? '' : asString(doc.homepage, 'homepage', 300),
    schema: PACK_SCHEMA,
    dir,
    canvas,
    layers,
    layerById,
    slots,
    slotByKey,
    recipes: recipePaths,
    raw: doc,
  }
  return pack
}

/** Read and validate one pack directory. Throws PackError on bad input. */
const packCache = new Map()

export function loadPack (packsDir, id) {
  const slug = safeSlug(id)
  const dir = path.join(packsDir, slug)
  const file = path.join(dir, 'pack.json')
  let stat
  try {
    stat = fs.statSync(file)
  } catch (error) {
    throw new PackError(`cannot read ${slug}/pack.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  const cached = packCache.get(dir)
  if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size && Date.now() - cached.at < 5000) {
    return cached.pack
  }
  let doc
  try {
    doc = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch (error) {
    throw new PackError(`cannot read ${slug}/pack.json: ${error instanceof Error ? error.message : String(error)}`)
  }
  const pack = buildPack(doc, { dir, dirName: slug })
  packCache.set(dir, { mtimeMs: stat.mtimeMs, size: stat.size, at: Date.now(), pack })
  return pack
}

/**
 * List packs under `packsDir` without throwing on a broken one.
 *
 * @returns {{packs: Array<{id,title,description,layerCount,slotCount,recipeCount,problem?:string}>, problems: string[]}}
 */
export function listPacks (packsDir) {
  const packs = []
  const problems = []
  let entries
  try {
    entries = fs.readdirSync(packsDir, { withFileTypes: true })
  } catch {
    return { packs, problems: [`packs directory not found: ${packsDir}`] }
  }
  const dirs = entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.') && !entry.name.startsWith('_'))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, 'en'))
  for (const name of dirs) {
    if (!fs.existsSync(path.join(packsDir, name, 'pack.json'))) continue
    try {
      const pack = loadPack(packsDir, name)
      packs.push({
        slug: pack.slug,
        id: pack.id,
        title: pack.title,
        description: pack.description,
        layerCount: pack.layers.length,
        slotCount: pack.slots.length,
        recipeCount: pack.recipes.length,
        dir: pack.dir,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      problems.push(`${name}: ${message}`)
      packs.push({ slug: name, id: name, title: name, description: '', layerCount: 0, slotCount: 0, recipeCount: 0, dir: path.join(packsDir, name), problem: message })
    }
  }
  return { packs, problems }
}

/** Selection validity helper shared by state and the tool. */
export function isValidPick (pack, slotKey, layerId) {
  const slot = pack.slotByKey.get(slotKey)
  if (slot === undefined) return false
  return slot.members.includes(layerId)
}

/** Default picks: one layer per single slot, toggles off unless specified. */
export function defaultPicks (pack, overrides = {}) {
  const picks = {}
  for (const slot of pack.slots) {
    if (slot.mode === 'single' && slot.default !== null) picks[slot.key] = slot.default
  }
  for (const [key, value] of Object.entries(overrides)) {
    if (isValidPick(pack, key, value)) picks[key] = value
  }
  return picks
}

/** Paint order: lower z first (further back); stable by declaration order. */
export function paintOrder (pack, picks) {
  const chosen = []
  for (const slot of pack.slots) {
    const id = picks[slot.key]
    if (id === undefined || id === null || !slot.members.includes(id)) continue
    const layer = pack.layerById.get(id)
    if (layer !== undefined) chosen.push(layer)
  }
  chosen.sort((a, b) => (a.z - b.z) || (a.index - b.index))
  return chosen
}
