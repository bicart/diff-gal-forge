/**
 * Recipes: data-only post-processing pipelines.
 *
 * A recipe is JSON, never code. That is a design decision, not a limitation:
 * users (and their AI) can author new looks without executing arbitrary files,
 * and the Host can validate every op before it touches a pixel. The supported
 * op set is intentionally small and predictable.
 *
 * Pipeline order is top-to-bottom. Alpha is preserved; ops never read outside
 * the canvas.
 */

import fs from 'node:fs'
import path from 'node:path'
import { blendOver } from './png.mjs'

export const RECIPE_SCHEMA = 'diff-forge/recipe@1'

export class RecipeError extends Error {
  constructor (message) {
    super(message)
    this.name = 'RecipeError'
  }
}

const MAX_OPS = 32

function fail (message) {
  throw new RecipeError(message)
}

function number (value, field, min, max, fallback) {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || value < min || value > max) {
    fail(`${field} must be a number in [${min}, ${max}]`)
  }
  return value
}

/** Accept #rgb / #rrggbb / #rrggbbaa. */
export function parseColor (value, field = 'color') {
  if (typeof value !== 'string') fail(`${field} must be a hex colour like "#ff8800"`)
  const match = /^#([0-9a-f]{3}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(value.trim())
  if (match === null) fail(`${field} must be a hex colour like "#ff8800"`)
  let hex = match[1]
  if (hex.length === 3) hex = hex.split('').map((ch) => ch + ch).join('')
  const r = Number.parseInt(hex.slice(0, 2), 16)
  const g = Number.parseInt(hex.slice(2, 4), 16)
  const b = Number.parseInt(hex.slice(4, 6), 16)
  const a = hex.length === 8 ? Number.parseInt(hex.slice(6, 8), 16) : 255
  return [r, g, b, a]
}

function clampByte (value) {
  return value <= 0 ? 0 : value >= 255 ? 255 : Math.round(value)
}

function luma (r, g, b) {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** Validate one op and return a normalized copy. */
export function normalizeOp (raw, index) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) fail(`ops[${index}] must be an object`)
  const op = raw.op
  switch (op) {
    case 'tint': {
      const color = parseColor(raw.color, `ops[${index}].color`)
      return { op, color, amount: number(raw.amount, `ops[${index}].amount`, 0, 1, 0.2) }
    }
    case 'brightness':
      return { op, amount: number(raw.amount, `ops[${index}].amount`, -1, 1, 0) }
    case 'contrast':
      return { op, amount: number(raw.amount, `ops[${index}].amount`, -1, 1, 0) }
    case 'saturate':
      return { op, amount: number(raw.amount, `ops[${index}].amount`, 0, 3, 1) }
    case 'grayscale':
      return { op, amount: number(raw.amount, `ops[${index}].amount`, 0, 1, 1) }
    case 'opacity':
      return { op, amount: number(raw.amount, `ops[${index}].amount`, 0, 1, 1) }
    case 'flip': {
      const axis = raw.axis ?? 'h'
      if (axis !== 'h' && axis !== 'v') fail(`ops[${index}].axis must be "h" or "v"`)
      return { op, axis }
    }
    case 'shadow': {
      const dx = Math.round(number(raw.dx, `ops[${index}].dx`, -200, 200, 0))
      const dy = Math.round(number(raw.dy, `ops[${index}].dy`, -200, 200, 8))
      return {
        op,
        color: parseColor(raw.color ?? '#000000', `ops[${index}].color`),
        dx,
        dy,
        alpha: number(raw.alpha, `ops[${index}].alpha`, 0, 1, 0.35),
      }
    }
    case 'border': {
      const width = Math.round(number(raw.width, `ops[${index}].width`, 1, 4, 2))
      return {
        op,
        color: parseColor(raw.color ?? '#ffffff', `ops[${index}].color`),
        width,
        alpha: number(raw.alpha, `ops[${index}].alpha`, 0, 1, 1),
      }
    }
    default:
      fail(`ops[${index}].op is not supported: ${String(op)}`)
  }
}

/** Validate a parsed recipe document. */
export function normalizeRecipe (doc, { id, path: file = '' } = {}) {
  if (doc === null || typeof doc !== 'object' || Array.isArray(doc)) fail('recipe must be a JSON object')
  if (doc.schema !== undefined && doc.schema !== RECIPE_SCHEMA) {
    fail(`unsupported schema: ${String(doc.schema)} (expected ${RECIPE_SCHEMA})`)
  }
  const recipeId = String(doc.id ?? id ?? '').trim()
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(recipeId)) fail('recipe id must use letters, digits, dot, dash or underscore')
  const label = String(doc.label ?? recipeId).trim()
  if (label === '' || label.length > 40) fail('recipe label must be 1-40 characters')
  if (!Array.isArray(doc.ops) || doc.ops.length === 0) fail('recipe ops must be a non-empty array')
  if (doc.ops.length > MAX_OPS) fail(`at most ${MAX_OPS} ops are supported`)
  return {
    schema: RECIPE_SCHEMA,
    id: recipeId,
    label,
    description: typeof doc.description === 'string' ? doc.description.slice(0, 300) : '',
    ops: doc.ops.map((op, index) => normalizeOp(op, index)),
    path: file,
  }
}

/** Apply one normalized recipe's ops to an RGBA canvas, in place. */
export function applyRecipe (data, width, height, ops) {
  let canvas = data
  for (const op of ops) {
    switch (op.op) {
      case 'tint': canvas = applyTint(canvas, op.color, op.amount); break
      case 'brightness': canvas = applyBrightness(canvas, op.amount); break
      case 'contrast': canvas = applyContrast(canvas, op.amount); break
      case 'saturate': canvas = applySaturate(canvas, op.amount); break
      case 'grayscale': canvas = applyGrayscale(canvas, op.amount); break
      case 'opacity': canvas = applyOpacity(canvas, op.amount); break
      case 'flip': canvas = flip(canvas, width, height, op.axis); break
      case 'shadow': canvas = applyShadow(canvas, width, height, op); break
      case 'border': canvas = applyBorder(canvas, width, height, op); break
      default: break // normalizeOp already rejected unknown ops
    }
  }
  return canvas
}

function applyTint (data, [tr, tg, tb], amount) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    data[i] += (tr - data[i]) * amount
    data[i + 1] += (tg - data[i + 1]) * amount
    data[i + 2] += (tb - data[i + 2]) * amount
  }
  return data
}

function applyBrightness (data, amount) {
  const delta = amount * 255
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    data[i] = clampByte(data[i] + delta)
    data[i + 1] = clampByte(data[i + 1] + delta)
    data[i + 2] = clampByte(data[i + 2] + delta)
  }
  return data
}

function applyContrast (data, amount) {
  const factor = amount >= 0 ? 1 + amount * 2 : 1 + amount
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    data[i] = clampByte((data[i] - 128) * factor + 128)
    data[i + 1] = clampByte((data[i + 1] - 128) * factor + 128)
    data[i + 2] = clampByte((data[i + 2] - 128) * factor + 128)
  }
  return data
}

function applySaturate (data, amount) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const gray = luma(data[i], data[i + 1], data[i + 2])
    data[i] = clampByte(gray + (data[i] - gray) * amount)
    data[i + 1] = clampByte(gray + (data[i + 1] - gray) * amount)
    data[i + 2] = clampByte(gray + (data[i + 2] - gray) * amount)
  }
  return data
}

function applyGrayscale (data, amount) {
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue
    const gray = luma(data[i], data[i + 1], data[i + 2])
    data[i] += (gray - data[i]) * amount
    data[i + 1] += (gray - data[i + 1]) * amount
    data[i + 2] += (gray - data[i + 2]) * amount
  }
  return data
}

function applyOpacity (data, amount) {
  for (let i = 3; i < data.length; i += 4) data[i] *= amount
  return data
}

function flip (data, width, height, axis) {
  if (axis === 'h') {
    for (let y = 0; y < height; y++) {
      const row = y * width * 4
      for (let x = 0; x < Math.floor(width / 2); x++) {
        const a = row + x * 4
        const b = row + (width - 1 - x) * 4
        for (let k = 0; k < 4; k++) {
          const tmp = data[a + k]
          data[a + k] = data[b + k]
          data[b + k] = tmp
        }
      }
    }
  } else {
    for (let y = 0; y < Math.floor(height / 2); y++) {
      const a = y * width * 4
      const b = (height - 1 - y) * width * 4
      for (let x = 0; x < width * 4; x++) {
        const tmp = data[a + x]
        data[a + x] = data[b + x]
        data[b + x] = tmp
      }
    }
  }
  return data
}

/** Solid silhouette dropped behind the artwork. */
function applyShadow (data, width, height, { color, dx, dy, alpha }) {
  const [r, g, b] = color
  const out = new Uint8Array(data.length)
  for (let y = 0; y < height; y++) {
    const ty = y + dy
    if (ty < 0 || ty >= height) continue
    for (let x = 0; x < width; x++) {
      const tx = x + dx
      if (tx < 0 || tx >= width) continue
      const sa = data[(y * width + x) * 4 + 3]
      if (sa === 0) continue
      const a = sa * alpha
      const j = (ty * width + tx) * 4
      if (a > out[j + 3]) {
        out[j] = r
        out[j + 1] = g
        out[j + 2] = b
        out[j + 3] = a
      }
    }
  }
  return blendOver(out, { data, width, height }, width, height, 0, 0, 255)
}

/** Grow a 1-4 px outline around the opaque silhouette. */
function applyBorder (data, width, height, { color, width: thickness, alpha }) {
  const [r, g, b] = color
  const opaque = new Uint8Array(width * height)
  for (let i = 0, p = 0; i < data.length; i += 4, p++) opaque[p] = data[i + 3] > 0 ? 1 : 0
  let mask = opaque
  for (let step = 0; step < thickness; step++) {
    const next = mask.slice()
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const p = y * width + x
        if (mask[p] === 1) continue
        const up = y > 0 && mask[p - width] === 1
        const down = y < height - 1 && mask[p + width] === 1
        const left = x > 0 && mask[p - 1] === 1
        const right = x < width - 1 && mask[p + 1] === 1
        const diagonal = (y > 0 && x > 0 && mask[p - width - 1] === 1) ||
          (y > 0 && x < width - 1 && mask[p - width + 1] === 1) ||
          (y < height - 1 && x > 0 && mask[p + width - 1] === 1) ||
          (y < height - 1 && x < width - 1 && mask[p + width + 1] === 1)
        if (up || down || left || right || diagonal) next[p] = 1
      }
    }
    mask = next
  }
  const out = new Uint8Array(data.length)
  const a = Math.round(255 * alpha)
  for (let p = 0; p < width * height; p++) {
    if (mask[p] === 1 && data[p * 4 + 3] === 0) {
      out[p * 4] = r
      out[p * 4 + 1] = g
      out[p * 4 + 2] = b
      out[p * 4 + 3] = a
    }
  }
  return blendOver(out, { data, width, height }, width, height, 0, 0, 255)
}

// --------------------------------------------------------------- discovery

const recipeCache = new Map()

function readRecipeFile (file, fallbackId) {
  let stat
  try {
    stat = fs.statSync(file)
  } catch {
    return null
  }
  const cached = recipeCache.get(file)
  if (cached !== undefined && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return cached
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'))
    const recipe = normalizeRecipe(doc, { id: fallbackId, path: file })
    const entry = { mtimeMs: stat.mtimeMs, size: stat.size, recipe }
    recipeCache.set(file, entry)
    return entry
  } catch (error) {
    return { mtimeMs: stat.mtimeMs, size: stat.size, problem: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * Load pack recipes plus user recipes. A user recipe with the same id replaces
 * the pack recipe, so a project can tweak a shipped look without forking it.
 *
 * @returns {{recipes: Array, problems: string[]}}
 */
export function loadRecipes (pack, userRecipeDir) {
  const recipes = []
  const problems = []
  const byId = new Map()

  const add = (recipe, source) => {
    const entry = { ...recipe, source }
    if (byId.has(recipe.id)) {
      const index = recipes.findIndex((item) => item.id === recipe.id)
      if (index >= 0) recipes.splice(index, 1)
    }
    byId.set(recipe.id, entry)
    recipes.push(entry)
  }

  for (const file of pack.recipes) {
    const fallbackId = path.basename(file, '.json')
    const result = readRecipeFile(file, fallbackId)
    if (result === null) { problems.push(`recipe missing: ${file}`); continue }
    if (result.problem !== undefined) { problems.push(`${path.basename(file)}: ${result.problem}`); continue }
    add(result.recipe, 'pack')
  }

  if (typeof userRecipeDir === 'string' && userRecipeDir !== '') {
    let files = []
    try {
      files = fs.readdirSync(userRecipeDir).filter((name) => /\.json$/i.test(name)).sort((a, b) => a.localeCompare(b, 'en'))
    } catch { /* no user recipe dir yet is normal */ }
    for (const name of files) {
      const file = path.join(userRecipeDir, name)
      const result = readRecipeFile(file, path.basename(name, '.json'))
      if (result === null) continue
      if (result.problem !== undefined) { problems.push(`${name}: ${result.problem}`); continue }
      add(result.recipe, 'user')
    }
  }

  return { recipes, problems }
}

/** Stable dependency signature for the render cache. */
export function recipeSignature (recipe) {
  if (recipe === null || recipe === undefined) return 'none'
  return JSON.stringify(recipe.ops)
}
