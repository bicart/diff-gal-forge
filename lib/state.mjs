/**
 * The one piece of state the panel and the agent both operate.
 *
 * Small on purpose: selected pack, one layer per slot, one recipe, a version
 * for cheap polling, and the last few edits. Both the panel and the model tool
 * write through the same `operate` path, so they cannot drift apart.
 */

import fs from 'node:fs'
import path from 'node:path'

const MAX_LOG = 12

export class StateStore {
  constructor (file) {
    this.file = file
    this.cached = undefined
  }

  read () {
    if (this.cached !== undefined) return this.cached
    try {
      const parsed = JSON.parse(fs.readFileSync(this.file, 'utf8'))
      this.cached = sanitize(parsed)
      return this.cached
    } catch {
      this.cached = undefined
      return undefined
    }
  }

  write (state) {
    const next = sanitize(state)
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const temp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(temp, JSON.stringify(next, null, 2), 'utf8')
    fs.renameSync(temp, this.file)
    this.cached = next
    return next
  }

  static note (state, by, text) {
    const log = Array.isArray(state.log) ? state.log.slice(-(MAX_LOG - 1)) : []
    log.push({ at: new Date().toISOString(), by, text })
    state.log = log
    return state
  }
}

function sanitize (value) {
  const state = value !== null && typeof value === 'object' ? value : {}
  const picks = {}
  if (state.picks !== null && typeof state.picks === 'object') {
    for (const [key, layer] of Object.entries(state.picks)) {
      if (typeof key !== 'string') continue
      if (typeof layer === 'string' && layer !== '') picks[key] = layer
    }
  }
  return {
    pack: typeof state.pack === 'string' && state.pack !== '' ? state.pack : '',
    picks,
    recipe: typeof state.recipe === 'string' && state.recipe !== '' ? state.recipe : null,
    version: Number.isFinite(state.version) ? state.version : 0,
    updatedAt: typeof state.updatedAt === 'string' ? state.updatedAt : '',
    updatedBy: typeof state.updatedBy === 'string' ? state.updatedBy : '',
    log: Array.isArray(state.log)
      ? state.log
        .filter((row) => row !== null && typeof row === 'object')
        .slice(-MAX_LOG)
        .map((row) => ({
          at: typeof row.at === 'string' ? row.at : '',
          by: typeof row.by === 'string' ? row.by : '',
          text: typeof row.text === 'string' ? row.text : '',
        }))
      : [],
  }
}
