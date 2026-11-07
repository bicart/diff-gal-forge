/**
 * Diff Forge (差分工坊) — Host half.
 *
 * A game-agnostic layered-character variation studio. It knows nothing about
 * any specific title or file format: users bring `packs/<slug>/pack.json` plus
 * transparent PNGs, and the plugin composes exclusive slots, applies data-only
 * recipes, and hands the panel + the agent one shared selection.
 *
 * Endpoints (ROUTE below):
 *   GET  /diff-forge/state?since=        — packs, current pack, slots, recipes
 *   POST /diff-forge/set                 — { op: pack|pick|recipe|reset|note }
 *   GET  /diff-forge/render.png?w=       — composed PNG
 *   GET  /diff-forge/thumb/<pack>/<layer>.png?w=
 *   GET  /diff-forge/export.png?w=       — download
 *   GET  /diff-forge/prompt?mode=&lang=  — copyable AI brief
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { listPacks, loadPack, defaultPicks, PackError } from './lib/pack.mjs'
import { loadRecipes, RecipeError } from './lib/recipe.mjs'
import { Renderer } from './lib/render.mjs'
import { StateStore } from './lib/state.mjs'
import { buildGuide, starterPrompts } from './lib/guide.mjs'

export const name = 'diff-forge'

const ROUTE = '/diff-forge'
const TOOL_NAME = 'diff_forge'
const HERE = path.dirname(fileURLToPath(import.meta.url))

function resolveFrom (base, value) {
  return typeof value === 'string' && value.trim() !== '' ? path.resolve(base, value) : null
}

export function apply (ctx, config = {}) {
  const root = resolveFrom(process.cwd(), config.root) ?? process.cwd()
  const packsDir = resolveFrom(root, config.packsDir) ?? path.join(root, 'packs')
  const workDir = resolveFrom(root, config.workDir) ?? path.join(root, 'work', 'diff-forge')
  const userRecipeDir = path.join(workDir, 'recipes')
  const includeExamples = config.includeExamples !== false
  const examplesDir = path.join(HERE, 'examples')
  const locale = config.locale === 'en' ? 'en' : 'zh'

  const renderer = new Renderer({
    cacheDir: path.join(workDir, 'cache', 'render'),
    thumbDir: path.join(workDir, 'cache', 'thumb'),
    cacheBytes: config.cacheMb !== undefined ? Number(config.cacheMb) * 1024 * 1024 : undefined,
  })
  const store = new StateStore(path.join(workDir, 'state.json'))

  ctx.logger?.info?.(`diff-forge: packs ${packsDir}${includeExamples ? ` (+ built-in examples)` : ''}`)

  let lastPanelHit = null
  let catalogCache = null
  let catalogAt = 0

  // --------------------------------------------------------------- catalog
  function catalog () {
    if (catalogCache !== null && Date.now() - catalogAt < 1200) return catalogCache
    const own = listPacks(packsDir)
    const extras = includeExamples && path.resolve(examplesDir) !== path.resolve(packsDir)
      ? listPacks(examplesDir)
      : { packs: [], problems: [] }
    const seen = new Set(own.packs.map((entry) => entry.slug))
    const merged = own.packs.map((entry) => ({ ...entry }))
    for (const entry of extras.packs) {
      if (seen.has(entry.slug)) continue
      seen.add(entry.slug)
      merged.push({ ...entry, example: true })
    }
    // An absent personal packs dir is normal on first run when the built-in
    // example is what the panel shows. Only surface it when there is nothing
    // else to display, otherwise the first impression is a scary warning.
    const ownProblems = own.packs.length === 0 && extras.packs.length > 0
      ? own.problems.filter((line) => !line.startsWith('packs directory not found'))
      : own.problems
    catalogCache = {
      packs: merged,
      problems: [
        ...ownProblems,
        ...extras.problems.map((line) => `examples/${line}`),
      ],
      dirs: { own: packsDir, examples: includeExamples ? examplesDir : '' },
    }
    catalogAt = Date.now()
    return catalogCache
  }

  function usablePacks () {
    return catalog().packs.filter((entry) => entry.problem === undefined)
  }

  function loadBySlug (slug) {
    const entry = catalog().packs.find((item) => item.slug === slug)
    if (entry === undefined) throw new PackError(`unknown pack: ${slug}`)
    if (entry.problem !== undefined) throw new PackError(entry.problem)
    return loadPack(path.dirname(entry.dir), entry.slug)
  }

  function samePicks (a, b) {
    const ak = Object.keys(a ?? {})
    const bk = Object.keys(b ?? {})
    if (ak.length !== bk.length) return false
    return ak.every((key) => a[key] === b[key])
  }

  // ---------------------------------------------------------------- state
  function currentSelection () {
    const cat = catalog()
    const usable = cat.packs.filter((entry) => entry.problem === undefined)
    if (usable.length === 0) return { state: null, pack: null, recipes: null, problems: cat.problems }

    let previous = store.read() ?? null
    let entry = previous === null ? undefined : usable.find((item) => item.slug === previous.pack)
    if (entry === undefined) entry = usable[0]
    let pack
    try {
      pack = loadBySlug(entry.slug)
    } catch (error) {
      const problem = error instanceof Error ? error.message : String(error)
      return { state: null, pack: null, recipes: null, problems: [...cat.problems, problem] }
    }

    const recipeBook = loadRecipes(pack, userRecipeDir)
    const packChanged = previous === null || previous.pack !== pack.slug
    let picks = {}
    if (!packChanged) {
      for (const slot of pack.slots) {
        const wanted = previous.picks?.[slot.key]
        if (wanted !== undefined && slot.members.includes(wanted)) picks[slot.key] = wanted
        else if (slot.mode === 'single' && slot.default !== null) picks[slot.key] = slot.default
      }
    } else {
      picks = defaultPicks(pack)
    }
    const wantedRecipe = previous?.recipe ?? null
    const recipe = wantedRecipe !== null && recipeBook.recipes.some((item) => item.id === wantedRecipe)
      ? wantedRecipe
      : null

    let state
    if (packChanged || !samePicks(previous?.picks, picks) || (previous?.recipe ?? null) !== recipe) {
      state = {
        pack: pack.slug,
        picks,
        recipe,
        version: (previous?.version ?? 0) + 1,
        updatedAt: new Date().toISOString(),
        updatedBy: previous?.updatedBy ?? 'system',
        log: previous?.log ?? [],
      }
      store.write(state)
    } else {
      state = previous
    }
    return { state, pack, recipes: recipeBook, problems: [...cat.problems, ...recipeBook.problems] }
  }

  function resolveLayer (pack, slot, wanted) {
    if (typeof wanted !== 'string' && typeof wanted !== 'number') return null
    const needle = String(wanted).trim()
    if (needle === '') return null
    if (slot.members.includes(needle)) return needle
    const exact = slot.members.map((id) => pack.layerById.get(id)).find((layer) => layer !== undefined && layer.name === needle)
    if (exact !== undefined) return exact.id
    const loose = slot.members
      .map((id) => pack.layerById.get(id))
      .filter((layer) => layer !== undefined && (layer.name.includes(needle) || layer.id.includes(needle)))
    return loose.length === 1 ? loose[0].id : null
  }

  function operate (input, by) {
    const { state, pack, recipes } = currentSelection()
    if (state === null || pack === null) return { ok: false, problem: '没有可用的素材包（packs 目录为空）' }
    const op = typeof input.op === 'string' ? input.op : 'pick'
    const next = { ...state, picks: { ...state.picks } }

    if (op === 'pack') {
      const slug = typeof input.pack === 'string' ? input.pack.trim() : ''
      const target = usablePacks().find((item) => item.slug === slug)
      if (target === undefined) return { ok: false, problem: `没有这个素材包：${slug}` }
      const model = loadBySlug(target.slug)
      next.pack = model.slug
      next.picks = defaultPicks(model)
      next.recipe = null
      StateStore.note(next, by, `切换到 ${model.title}`)
    } else if (op === 'pick') {
      const slot = pack.slotByKey.get(String(input.slot ?? '').trim())
      if (slot === undefined) return { ok: false, problem: `没有这个槽位：${String(input.slot)}` }
      if (input.layer === null || input.layer === undefined || input.layer === '') {
        if (slot.mode === 'single') return { ok: false, problem: `「${slot.label}」是必选槽位，不能清空` }
        delete next.picks[slot.key]
        StateStore.note(next, by, `关闭 ${slot.label}`)
      } else {
        const id = resolveLayer(pack, slot, input.layer)
        if (id === null) return { ok: false, problem: `「${slot.label}」里没有这一项：${String(input.layer)}` }
        next.picks[slot.key] = id
        StateStore.note(next, by, `${slot.label} → ${pack.layerById.get(id)?.name ?? id}`)
      }
    } else if (op === 'recipe') {
      const wanted = typeof input.recipe === 'string' ? input.recipe.trim() : ''
      if (wanted === '') {
        next.recipe = null
        StateStore.note(next, by, '关闭配方')
      } else {
        const found = recipes.recipes.find((item) => item.id === wanted)
        if (found === undefined) return { ok: false, problem: `没有这个配方：${wanted}` }
        next.recipe = found.id
        StateStore.note(next, by, `配方 → ${found.label}`)
      }
    } else if (op === 'reset') {
      next.picks = defaultPicks(pack)
      next.recipe = null
      StateStore.note(next, by, '回到默认组合')
    } else if (op === 'note') {
      const text = typeof input.text === 'string' ? input.text.trim() : ''
      if (text === '') return { ok: false, problem: 'note 需要 text' }
      StateStore.note(next, by, text)
    } else {
      return { ok: false, problem: `不认识的 op：${op}` }
    }

    next.version = state.version + 1
    next.updatedAt = new Date().toISOString()
    next.updatedBy = by
    return { ok: true, state: store.write(next) }
  }

  function picksFor (pack, picks) {
    return pack.slots.map((slot) => {
      const id = picks[slot.key]
      const layer = id === undefined ? undefined : pack.layerById.get(id)
      return { key: slot.key, slot: slot.label, layerId: id ?? null, name: layer?.name ?? null }
    })
  }

  function packDetail (pack, recipes, state) {
    return {
      slug: pack.slug,
      id: pack.id,
      title: pack.title,
      description: pack.description,
      author: pack.author,
      license: pack.license,
      canvas: pack.canvas,
      dir: pack.dir,
      example: catalog().packs.find((item) => item.slug === pack.slug)?.example === true,
      layerCount: pack.layers.length,
      slots: pack.slots.map((slot) => ({
        key: slot.key,
        label: slot.label,
        mode: slot.mode,
        note: slot.note,
        groups: slot.groups,
        members: slot.members.map((id) => {
          const layer = pack.layerById.get(id)
          return {
            id,
            name: layer.name,
            visible: layer.visible,
            tag: layer.tags.join(','),
            thumb: `${ROUTE}/thumb/${encodeURIComponent(pack.slug)}/${encodeURIComponent(id)}.png?w=96`,
          }
        }),
      })),
      recipes: recipes.recipes.map((item) => ({
        id: item.id,
        label: item.label,
        description: item.description,
        source: item.source,
      })),
      recipeProblems: recipes.problems,
      picked: picksFor(pack, state.picks),
    }
  }

  function snapshot (pre) {
    const current = pre ?? currentSelection()
    const { state, pack, recipes, problems } = current
    const cat = catalog()
    const payload = {
      packs: cat.packs.map((entry) => ({
        slug: entry.slug,
        id: entry.id,
        title: entry.title,
        description: entry.description,
        layerCount: entry.layerCount,
        slotCount: entry.slotCount,
        recipeCount: entry.recipeCount,
        example: entry.example === true,
        problem: entry.problem,
      })),
      problems: problems ?? [],
      dirs: {
        packs: cat.dirs.own,
        examples: cat.dirs.examples,
        userRecipes: userRecipeDir,
        work: workDir,
      },
      state: null,
      pack: null,
      suggestions: [],
    }
    if (state === null || pack === null) {
      payload.suggestions = starterPrompts({ pack: null, packsDir: packsDir, userRecipeDir })
      return payload
    }
    payload.state = {
      version: state.version,
      pack: state.pack,
      picks: state.picks,
      picked: picksFor(pack, state.picks),
      recipe: state.recipe,
      updatedAt: state.updatedAt,
      updatedBy: state.updatedBy,
      log: state.log,
    }
    payload.pack = packDetail(pack, recipes, state)
    payload.suggestions = starterPrompts({ pack: packDetail(pack, recipes, state), packsDir: packsDir, userRecipeDir })
    return payload
  }

  // --------------------------------------------------------------- render
  function composePng (width) {
    const { state, pack, recipes } = currentSelection()
    if (state === null || pack === null) return null
    const w = Math.max(240, Math.min(2400, Math.round(width)))
    const recipe = state.recipe === null ? null : recipes.recipes.find((item) => item.id === state.recipe) ?? null
    const buffer = renderer.renderPng(pack, state.picks, recipe, w)
    const scale = w / pack.canvas.width
    return { buffer, width: w, height: Math.round(pack.canvas.height * scale), state, pack }
  }

  function guide (mode, lang) {
    const focus = mode === 'pack' || mode === 'recipe' || mode === 'debug' ? mode : 'overview'
    const { state, pack, recipes } = currentSelection()
    const recipe = state !== null && state.recipe !== null
      ? recipes.recipes.find((item) => item.id === state.recipe) ?? null
      : null
    return buildGuide({
      mode: focus,
      pack,
      picks: state?.picks ?? {},
      recipe,
      packsDir,
      workDir,
      userRecipeDir,
      lang: lang ?? locale,
    })
  }

  // -------------------------------------------------------------- routes
  ctx.inject(['webServer'], (hostCtx) => {
    const server = hostCtx.get('webServer')
    if (server === undefined) return

    hostCtx.effect(() => server.register({
      kind: 'prefix',
      path: ROUTE,
      handler: async (request, response) => {
        if (!trusted(request)) {
          response.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
          response.end('forbidden')
          return
        }
        const url = new URL(request.url ?? '/', 'http://localhost')
        const sub = url.pathname.slice(ROUTE.length).replace(/\/+$/, '') || '/'

        try {
          if (request.method === 'GET' && sub === '/state') {
            lastPanelHit = { at: Date.now(), kind: 'state' }
            const since = url.searchParams.get('since')
            if (since !== null) {
              const pre = currentSelection()
              if (pre.state !== null && pre.state.version === Number(since)) {
                sendJson(response, 200, { unchanged: true, version: pre.state.version })
                return
              }
              sendJson(response, 200, snapshot(pre))
              return
            }
            sendJson(response, 200, snapshot())
            return
          }

          if (request.method === 'POST' && sub === '/set') {
            const body = await readJson(request)
            const result = operate(body, body.actor === 'agent' ? 'AI' : '你')
            if (!result.ok) {
              sendJson(response, 400, { problem: result.problem })
              return
            }
            sendJson(response, 200, snapshot())
            return
          }

          if (request.method === 'GET' && sub === '/render.png') {
            lastPanelHit = { at: Date.now(), kind: 'render' }
            const width = Number(url.searchParams.get('w') ?? 900)
            const image = composePng(Number.isFinite(width) ? width : 900)
            if (image === null) throw new Error('no pack available')
            response.writeHead(200, {
              'content-type': 'image/png',
              'content-length': image.buffer.length,
              'cache-control': 'public, max-age=31536000, immutable',
              'x-diff-forge-version': String(image.state.version),
            })
            response.end(image.buffer)
            return
          }

          if (request.method === 'GET' && sub.startsWith('/thumb/')) {
            const parts = sub.slice('/thumb/'.length).split('/').filter((part) => part !== '')
            if (parts.length !== 2) throw new Error('bad thumb path')
            const [slug, layerFile] = parts.map((part) => decodeURIComponent(part))
            const pack = loadBySlug(slug)
            const layerId = layerFile.replace(/\.png$/i, '')
            const layer = pack.layerById.get(layerId)
            if (layer === undefined) throw new Error('no such layer')
            const maxEdge = Math.max(24, Math.min(256, Math.round(Number(url.searchParams.get('w') ?? 96))))
            const thumb = renderer.thumbnail(pack, layer, maxEdge)
            response.writeHead(200, { 'content-type': 'image/png', 'cache-control': 'public, max-age=31536000, immutable' })
            response.end(thumb)
            return
          }

          if (request.method === 'GET' && sub === '/export.png') {
            lastPanelHit = { at: Date.now(), kind: 'render' }
            const width = Number(url.searchParams.get('w') ?? 2400)
            const image = composePng(Number.isFinite(width) ? width : 2400)
            if (image === null) throw new Error('no pack available')
            const recipeName = image.state.recipe ?? 'plain'
            const slugPart = image.pack.slug.replace(/[^\w.@-]+/g, '-').replace(/^-+|-+$/g, '') || 'pack'
            const name = `${slugPart}-${recipeName}-v${image.state.version}.png`.replace(/[^\w.@-]+/g, '-')
            response.writeHead(200, {
              'content-type': 'image/png',
              'content-length': image.buffer.length,
              'content-disposition': `attachment; filename="${name}"`,
              'cache-control': 'no-store',
            })
            response.end(image.buffer)
            return
          }

          if (request.method === 'GET' && sub === '/prompt') {
            const mode = url.searchParams.get('mode') ?? 'overview'
            const lang = url.searchParams.get('lang') ?? locale
            const text = guide(mode === 'pack' || mode === 'recipe' || mode === 'debug' ? mode : 'overview', lang)
            response.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'cache-control': 'no-store' })
            response.end(text)
            return
          }

          sendJson(response, 404, { problem: 'not found' })
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          sendJson(response, error instanceof PackError || error instanceof RecipeError ? 400 : 500, { problem: message })
        }
      },
    }), 'diff-forge: routes')
  })

  // ---------------------------------------------------------------- tool
  ctx.inject(['tools'], (toolsCtx) => {
    const tools = toolsCtx.get('tools')
    if (tools === undefined) return

    const definition = {
      name: TOOL_NAME,
      description:
        'Diff Forge: a game-agnostic layered-character variation studio. It composes user-supplied PNG packs ' +
        '(no bundled game assets) into slots, applies data-only recipes, and can prepare a copyable brief so an ' +
        'AI can author new packs or recipes with the user. Actions: status, packs, layers, set, recipe, reset, ' +
        'snapshot, guide. Use guide before writing any pack/recipe.',
      parameters: {
        type: 'object',
        properties: {
          action: {
            type: 'string',
            enum: ['status', 'packs', 'layers', 'set', 'recipe', 'reset', 'snapshot', 'guide'],
            description: 'What to do.',
          },
          pack: {
            type: 'string',
            description: 'Pack slug (directory name under packs/). Used by layers and set.',
          },
          slot: {
            type: 'string',
            description: 'Slot key, for set.',
          },
          layer: {
            type: 'string',
            description: 'Layer id or name fragment, for set. Empty string clears a toggle slot.',
          },
          recipe: {
            type: 'string',
            description: 'Recipe id for the recipe action; empty string removes the active recipe.',
          },
          mode: {
            type: 'string',
            enum: ['overview', 'pack', 'recipe', 'debug'],
            description: 'Guide focus. Default overview.',
          },
          lang: {
            type: 'string',
            enum: ['zh', 'en'],
            description: 'Guide language. Defaults to the plugin locale.',
          },
          width: {
            type: 'number',
            description: 'Snapshot width in pixels (240-2400, default 900).',
          },
        },
        required: ['action'],
      },
      output: {
        schema: {
          type: 'object',
          properties: {
            message: { type: 'string' },
            status: { type: 'string' },
            snapshot: { type: 'string' },
          },
          required: ['message'],
          additionalProperties: true,
        },
        render: (_args, value) => [{ type: 'text', text: value.message }],
      },
      execute: async (args) => {
        const input = args !== null && typeof args === 'object' ? args : {}
        const action = typeof input.action === 'string' ? input.action : 'status'

        if (action === 'packs') {
          const cat = catalog()
          const lines = cat.packs.map((entry) => {
            if (entry.problem !== undefined) return `- ${entry.slug} [broken] ${entry.problem}`
            return `- ${entry.slug}｜${entry.title}｜${entry.layerCount} layers, ${entry.slotCount} slots, ${entry.recipeCount} recipes${entry.example ? '｜built-in example' : ''}`
          })
          return {
            message: `Packs (${cat.packs.length}) in ${packsDir}:\n${lines.join('\n') || '(none)'}` +
              (cat.problems.length > 0 ? `\nProblems:\n- ${cat.problems.join('\n- ')}` : ''),
            status: 'ok',
          }
        }

        if (action === 'layers') {
          const { pack, state, recipes } = currentSelection()
          if (pack === null) return { message: 'No usable pack. Add packs/<slug>/pack.json or use the built-in example.', status: 'error' }
          const wanted = typeof input.pack === 'string' ? input.pack.trim() : ''
          let target = pack
          if (wanted !== '' && wanted !== pack.slug) {
            const entry = usablePacks().find((item) => item.slug === wanted)
            if (entry === undefined) return { message: `No such pack: ${wanted}`, status: 'error' }
            target = loadBySlug(entry.slug)
          }
          const lines = [`${target.slug} · ${target.title} · ${target.canvas.width}x${target.canvas.height} · ${target.layerCount ?? target.layers.length} layers`]
          for (const slot of target.slots) {
            const current = state?.picks?.[slot.key]
            lines.push(`\n[${slot.key}] ${slot.label} (${slot.mode === 'single' ? 'one of' : 'toggle'}, ${slot.members.length})`)
            for (const id of slot.members) {
              const layer = target.layerById.get(id)
              lines.push(`  ${id}\t${layer.name}${layer.visible ? ' (visible)' : ''}${id === current ? ' <- selected' : ''}`)
            }
          }
          if (recipes !== null && recipes.recipes.length > 0) {
            lines.push(`\nRecipes: ${recipes.recipes.map((item) => `${item.id}${item.id === state?.recipe ? '*' : ''}`).join(', ')}`)
          }
          return { message: lines.join('\n'), status: 'ok' }
        }

        if (action === 'set') {
          if (typeof input.pack === 'string' && input.pack.trim() !== '') {
            const { state } = currentSelection()
            if (state !== null && state.pack !== input.pack.trim()) {
              const swapped = operate({ op: 'pack', pack: input.pack }, 'AI')
              if (!swapped.ok) return { message: swapped.problem, status: 'error' }
            }
          }
          if (typeof input.slot !== 'string' || input.slot.trim() === '') {
            return { message: 'action=set needs slot.', status: 'error' }
          }
          const result = operate({ op: 'pick', slot: input.slot, layer: input.layer ?? null }, 'AI')
          if (!result.ok) return { message: result.problem, status: 'error' }
          return { message: describeState(), status: 'set' }
        }

        if (action === 'recipe') {
          const result = operate({ op: 'recipe', recipe: input.recipe ?? '' }, 'AI')
          if (!result.ok) return { message: result.problem, status: 'error' }
          return { message: describeState(), status: 'recipe' }
        }

        if (action === 'reset') {
          const result = operate({ op: 'reset' }, 'AI')
          if (!result.ok) return { message: result.problem, status: 'error' }
          return { message: describeState(), status: 'reset' }
        }

        if (action === 'guide') {
          const mode = typeof input.mode === 'string' ? input.mode : 'overview'
          const text = guide(mode, typeof input.lang === 'string' ? input.lang : undefined)
          return { message: text, status: 'guide' }
        }

        if (action === 'snapshot') {
          const width = Number.isFinite(input.width) ? Number(input.width) : 900
          const { state, pack, recipes } = currentSelection()
          if (state === null || pack === null) return { message: 'No usable pack.', status: 'error' }
          const w = Math.max(240, Math.min(2400, Math.round(width)))
          const recipe = state.recipe === null ? null : recipes.recipes.find((item) => item.id === state.recipe) ?? null
          const buffer = renderer.renderPng(pack, state.picks, recipe, w)
          const dir = path.join(workDir, 'exports')
          fs.mkdirSync(dir, { recursive: true })
          const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
          const file = path.join(dir, `${pack.slug}_${stamp}.png`)
          fs.writeFileSync(file, buffer)
          const height = Math.round(pack.canvas.height * (w / pack.canvas.width))
          return {
            message: `${describeState()}\n\nRendered ${w}x${height} PNG:\n${file}`,
            status: 'snapshot',
            snapshot: file,
          }
        }

        return { message: describeState(), status: 'ok' }
      },
    }

    toolsCtx.effect(() => tools.register(definition), 'diff-forge: diff_forge tool')
  })

  function describeState () {
    const { state, pack, recipes, problems } = currentSelection()
    if (state === null || pack === null) {
      return `No usable pack.\nPacks dir: ${packsDir}${includeExamples ? `\nBuilt-in examples: ${examplesDir}` : ''}` +
        (problems?.length ? `\nProblems:\n- ${problems.join('\n- ')}` : '')
    }
    const lines = [`Pack: ${pack.slug} · ${pack.title} (${pack.canvas.width}x${pack.canvas.height})`]
    for (const slot of pack.slots) {
      const id = state.picks[slot.key]
      const layer = id === undefined ? undefined : pack.layerById.get(id)
      lines.push(`- ${slot.label}: ${layer === undefined ? '(none)' : `${layer.name} [${layer.id}]`}`)
    }
    const recipe = state.recipe === null ? null : recipes.recipes.find((item) => item.id === state.recipe)
    lines.push(`- Recipe: ${recipe === null ? '(none)' : `${recipe.label} (${recipe.id})`}`)
    lines.push(`- v${state.version}, last change: ${state.updatedBy || '-'}`)
    if (state.log.length > 0) {
      lines.push('', 'Recent:')
      for (const row of state.log.slice(-3)) lines.push(`- ${row.by}: ${row.text}`)
    }
    if (problems.length > 0) lines.push('', `Warnings: ${problems.slice(0, 3).join(' | ')}`)
    lines.push('', lastPanelHit === null
      ? 'Panel: no request yet (page may not have loaded).'
      : `Panel: ${Math.max(0, Math.round((Date.now() - lastPanelHit.at) / 1000))}s ago (${lastPanelHit.kind}).`)
    return lines.join('\n')
  }
}

// ---------------------------------------------------------------- helpers

function sendJson (response, status, body) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  response.end(JSON.stringify(body))
}

async function readJson (request, limit = 256 * 1024) {
  return await new Promise((resolve) => {
    let size = 0
    const chunks = []
    let settled = false
    const done = (value) => { if (!settled) { settled = true; resolve(value) } }
    request.on('data', (chunk) => {
      size += chunk.length
      if (size > limit) { done({}); try { request.destroy() } catch { /* ignore */ } return }
      chunks.push(chunk)
    })
    request.on('end', () => {
      if (chunks.length === 0) return done({})
      try {
        const parsed = JSON.parse(Buffer.concat(chunks).toString('utf8'))
        done(parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {})
      } catch {
        done({})
      }
    })
    request.on('error', () => done({}))
  })
}

/** Same fence the harness uses for plugin routes: loopback host, same origin. */
function trusted (request) {
  const headers = request?.headers ?? {}
  const host = headers.host
  if (typeof host !== 'string') return false
  let hostUrl
  try {
    hostUrl = new URL('http://' + host)
  } catch {
    return false
  }
  const hostname = hostUrl.hostname
  const loopback = hostname === 'localhost' || hostname === '[::1]' ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname)
  if (!loopback) return false
  if (headers['sec-fetch-site'] === 'cross-site') return false
  const origin = headers.origin
  if (typeof origin === 'string') {
    try {
      return new URL(origin).host === hostUrl.host
    } catch {
      return false
    }
  }
  return true
}
