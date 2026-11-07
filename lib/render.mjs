/**
 * Composition and caching.
 *
 * Layers are decoded once per (pack, layer, width) and composited on the Host;
 * the browser receives a single PNG. Final renders and layer thumbnails are
 * also cached on disk, because a panel open otherwise re-decodes every layer.
 * Cache keys include the source files' size+mtime and the recipe ops, so
 * changing a pack or a recipe invalidates exactly the affected renders.
 */

import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import { decodePng, scaleRgba, encodePng, blendOver } from './png.mjs'
import { paintOrder } from './pack.mjs'
import { applyRecipe, recipeSignature } from './recipe.mjs'

const CACHE_VERSION = 1

export class Renderer {
  /**
   * @param {{cacheDir?: string|null, thumbDir?: string|null, cacheBytes?: number}} options
   */
  constructor (options = {}) {
    this.cacheDir = options.cacheDir ?? null
    this.thumbDir = options.thumbDir ?? null
    this.budget = options.cacheBytes ?? 200 * 1024 * 1024
    this.used = 0
    /** @type {Map<string, {data: Uint8Array, width: number, height: number}>} */
    this.cache = new Map()
  }

  /**
   * @returns {{data: Uint8Array, width: number, height: number}}
   */
  compose (pack, picks, recipe, targetWidth) {
    const scale = targetWidth / pack.canvas.width
    const width = Math.max(1, Math.round(pack.canvas.width * scale))
    const height = Math.max(1, Math.round(pack.canvas.height * scale))
    const canvas = new Uint8Array(width * height * 4)

    for (const layer of paintOrder(pack, picks)) {
      const scaled = this.layerAt(pack, layer, Math.max(1, Math.round(layer.width * scale)))
      const offsetX = Math.round(layer.x * scale)
      const offsetY = Math.round(layer.y * scale)
      blendOver(canvas, scaled, width, height, offsetX, offsetY, Math.round(layer.opacity * 255))
    }

    if (recipe !== null && recipe !== undefined && recipe.ops.length > 0) {
      return { data: applyRecipe(canvas, width, height, recipe.ops), width, height }
    }
    return { data: canvas, width, height }
  }

  /** Compose + encode, memoised on disk by pack/picks/recipe/width. */
  renderPng (pack, picks, recipe, targetWidth) {
    const key = this.cacheKey('render', [
      pack.slug,
      this.packStamp(pack, picks),
      Object.keys(picks).sort().map((slot) => `${slot}:${picks[slot]}`).join(','),
      recipeSignature(recipe),
      Math.round(targetWidth),
      CACHE_VERSION,
    ])
    const hit = this.diskGet(this.cacheDir, key)
    if (hit !== null) return hit
    const composed = this.compose(pack, picks, recipe, targetWidth)
    const buffer = encodePng(composed.data, composed.width, composed.height)
    this.diskPut(this.cacheDir, key, buffer)
    return buffer
  }

  /** One layer scaled so its longest edge is `maxEdge`. */
  thumbnail (pack, layer, maxEdge = 96) {
    const longest = Math.max(layer.width, layer.height)
    const scale = Math.min(1, maxEdge / longest)
    const width = Math.max(1, Math.round(layer.width * scale))
    const height = Math.max(1, Math.round(layer.height * scale))
    const key = this.cacheKey('thumb', [
      pack.slug,
      layer.id,
      this.fileStamp(layer.absPath),
      Math.round(maxEdge),
      CACHE_VERSION,
    ])
    const hit = this.diskGet(this.thumbDir, key)
    if (hit !== null) return hit
    const scaled = this.layerAt(pack, layer, width)
    const buffer = encodePng(scaled.data, scaled.width, scaled.height)
    this.diskPut(this.thumbDir, key, buffer)
    return buffer
  }

  /** Decode + downscale one layer, memoised in memory. */
  layerAt (pack, layer, targetWidth) {
    const key = `${pack.slug}#${layer.id}@${targetWidth}@${this.fileStamp(layer.absPath)}`
    const hit = this.cache.get(key)
    if (hit !== undefined) {
      this.cache.delete(key)
      this.cache.set(key, hit)
      return hit
    }
    const png = decodePng(fs.readFileSync(layer.absPath))
    const scale = targetWidth / layer.width
    const width = Math.max(1, Math.round(layer.width * scale))
    const height = Math.max(1, Math.round(layer.height * scale))
    const data = scaleRgba(png.data, png.width, png.height, width, height)
    const entry = { data, width, height }
    this.cache.set(key, entry)
    this.used += data.byteLength
    while (this.used > this.budget) {
      const oldest = this.cache.keys().next()
      if (oldest.done) break
      const victim = this.cache.get(oldest.value)
      this.cache.delete(oldest.value)
      this.used -= victim.data.byteLength
    }
    return entry
  }

  // ------------------------------------------------------------ cache keys

  cacheKey (kind, parts) {
    return crypto.createHash('sha1').update([kind, ...parts.map(String)].join('|')).digest('hex').slice(0, 24)
  }

  fileStamp (file) {
    try {
      const stat = fs.statSync(file)
      return `${stat.size}:${Math.round(stat.mtimeMs)}`
    } catch {
      return 'missing'
    }
  }

  /** Identity of everything that can change a render. */
  packStamp (pack, picks) {
    const parts = [pack.slug, this.fileStamp(path.join(pack.dir, 'pack.json'))]
    for (const layer of paintOrder(pack, picks)) {
      parts.push(`${layer.id}@${this.fileStamp(layer.absPath)}`)
    }
    return parts.join('|')
  }

  diskGet (dir, key) {
    if (dir === null) return null
    try {
      return fs.readFileSync(path.join(dir, key + '.png'))
    } catch {
      return null
    }
  }

  diskPut (dir, key, buffer) {
    if (dir === null) return
    try {
      fs.mkdirSync(dir, { recursive: true })
      const temp = path.join(dir, `${key}.${process.pid}.tmp`)
      fs.writeFileSync(temp, buffer)
      fs.renameSync(temp, path.join(dir, key + '.png'))
    } catch { /* cache failures only cost time, never correctness */ }
  }
}
