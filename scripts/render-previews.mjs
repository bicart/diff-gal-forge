/**
 * Render the README screenshots from the demo pack.
 *
 *   node scripts/render-previews.mjs
 *
 * The output is deterministic: same code, same images. No browser needed.
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { loadPack } from '../lib/pack.mjs'
import { loadRecipes } from '../lib/recipe.mjs'
import { Renderer } from '../lib/render.mjs'
import { encodePng, scaleRgba, blendOver, fillRgba } from '../lib/png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.join(HERE, '..')
const PACK_DIR = path.join(ROOT, 'examples', 'demo')
const OUT = path.join(ROOT, 'docs')
const PAPER = [247, 243, 232, 255]

const pack = loadPack(path.dirname(PACK_DIR), path.basename(PACK_DIR))
const recipeBook = loadRecipes(pack, '')
const renderer = new Renderer()

const byId = (id) => recipeBook.recipes.find((entry) => entry.id === id) ?? null

const variants = [
  {
    file: 'preview-default.png',
    picks: { base: 'head', costume: 'dress', hair: 'hair-long', eyes: 'eyes-open', mouth: 'mouth-smile', bangs: 'bangs-a' },
    recipe: null,
  },
  {
    file: 'preview-variant.png',
    picks: {
      base: 'head', costume: 'hoodie', hair: 'hair-bob', eyes: 'eyes-star', mouth: 'mouth-o',
      bangs: 'bangs-b', blush: 'blush-soft', ribbon: 'ribbon-red', glasses: 'glasses',
    },
    recipe: byId('sunset'),
  },
  {
    file: 'preview-sticker.png',
    picks: {
      base: 'head', costume: 'dress', hair: 'hair-long', eyes: 'eyes-closed', mouth: 'mouth-smirk',
      bangs: 'bangs-a', blush: 'blush-soft',
    },
    recipe: byId('sticker'),
  },
]

function withPaper (rendered, targetWidth = 480) {
  const scale = targetWidth / rendered.width
  const w = Math.round(rendered.width * scale)
  const h = Math.round(rendered.height * scale)
  const data = scaleRgba(rendered.data, rendered.width, rendered.height, w, h)
  const bg = fillRgba(w, h, PAPER)
  const layer = { data, width: w, height: h }
  blendOver(bg, layer, w, h, 0, 0, 255)
  return { data: bg, width: w, height: h }
}

fs.mkdirSync(OUT, { recursive: true })

for (const variant of variants) {
  const rendered = renderer.compose(pack, variant.picks, variant.recipe, 480)
  const framed = withPaper(rendered, 480)
  fs.writeFileSync(path.join(OUT, variant.file), encodePng(framed.data, framed.width, framed.height))
  console.log('wrote', variant.file)
}

// Lineup: three states side by side with captions drawn as simple separators.
const panels = variants.map((variant) => withPaper(renderer.compose(pack, variant.picks, variant.recipe, 480), 420))
const gap = 18
const margin = 24
const totalW = panels.reduce((sum, panel) => sum + panel.width, 0) + gap * (panels.length - 1) + margin * 2
const totalH = Math.max(...panels.map((panel) => panel.height)) + margin * 2
const montage = fillRgba(totalW, totalH, [247, 243, 232, 255])
let x = margin
for (const panel of panels) {
  blendOver(montage, panel, totalW, totalH, x, margin, 255)
  x += panel.width + gap
}
fs.writeFileSync(path.join(OUT, 'preview-lineup.png'), encodePng(montage, totalW, totalH))
console.log('wrote preview-lineup.png', `${totalW}x${totalH}`)
