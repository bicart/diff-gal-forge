/**
 * Generate the bundled demo pack from code.
 *
 * Everything here is original vector-ish artwork drawn with plain circles,
 * ellipses, polygons and lines, then supersampled. No third-party or game
 * assets are involved, so the generated PNGs can be committed under CC0.
 *
 *   node scripts/make-demo-pack.mjs
 */

import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { encodePng, scaleRgba } from '../lib/png.mjs'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const OUT = path.join(HERE, '..', 'examples', 'demo')
const W = 720
const H = 1080
const S = 2 // supersampling factor

const SKIN = [246, 214, 196]
const SKIN_SHADE = [232, 186, 168]
const HAIR = [104, 74, 62]
const HAIR_DARK = [78, 54, 46]
const HAIR_LIGHT = [138, 100, 82]
const INK = [43, 43, 48]
const WHITE = [255, 255, 255]
const CREAM = [244, 230, 200]
const RED = [217, 75, 61]
const NAVY = [51, 65, 92]
const GOLD = [240, 193, 90]
const BLUSH = [239, 143, 143]
const GLASS = [58, 58, 64]

function canvas () {
  return new Uint8Array(W * S * H * S * 4)
}

function px (data, x, y, color, alpha = 1) {
  if (x < 0 || y < 0 || x >= W * S || y >= H * S) return
  const i = (y * W * S + x) * 4
  const sa = Math.max(0, Math.min(1, alpha)) * (color[3] === undefined ? 1 : color[3] / 255)
  if (sa <= 0) return
  const da = data[i + 3] / 255
  const out = sa + da * (1 - sa)
  if (out <= 0) return
  data[i] = (color[0] * sa + data[i] * da * (1 - sa)) / out
  data[i + 1] = (color[1] * sa + data[i + 1] * da * (1 - sa)) / out
  data[i + 2] = (color[2] * sa + data[i + 2] * da * (1 - sa)) / out
  data[i + 3] = out * 255
}

function ellipse (data, cx, cy, rx, ry, color, alpha = 1) {
  cx *= S; cy *= S; rx *= S; ry *= S
  const x0 = Math.max(0, Math.floor(cx - rx))
  const x1 = Math.min(W * S - 1, Math.ceil(cx + rx))
  const y0 = Math.max(0, Math.floor(cy - ry))
  const y1 = Math.min(H * S - 1, Math.ceil(cy + ry))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const nx = (x - cx) / rx
      const ny = (y - cy) / ry
      if (nx * nx + ny * ny <= 1) px(data, x, y, color, alpha)
    }
  }
}

function polygon (data, points, color, alpha = 1) {
  const pts = points.map(([x, y]) => [x * S, y * S])
  const xs = pts.map(([x]) => x)
  const ys = pts.map(([, y]) => y)
  const x0 = Math.max(0, Math.floor(Math.min(...xs)))
  const x1 = Math.min(W * S - 1, Math.ceil(Math.max(...xs)))
  const y0 = Math.max(0, Math.floor(Math.min(...ys)))
  const y1 = Math.min(H * S - 1, Math.ceil(Math.max(...ys)))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      let inside = false
      for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
        const [xi, yi] = pts[i]
        const [xj, yj] = pts[j]
        if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
      }
      if (inside) px(data, x, y, color, alpha)
    }
  }
}

function rect (data, x, y, w, h, color, alpha = 1) {
  polygon(data, [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], color, alpha)
}

function roundRect (data, x, y, w, h, r, color, alpha = 1) {
  ellipse(data, x + r, y + r, r, r, color, alpha)
  ellipse(data, x + w - r, y + r, r, r, color, alpha)
  ellipse(data, x + r, y + h - r, r, r, color, alpha)
  ellipse(data, x + w - r, y + h - r, r, r, color, alpha)
  rect(data, x + r, y, w - r * 2, h, color, alpha)
  rect(data, x, y + r, r, h - r * 2, color, alpha)
  rect(data, x + w - r, y + r, r, h - r * 2, color, alpha)
}

function segment (data, x1, y1, x2, y2, width, color, alpha = 1) {
  x1 *= S; y1 *= S; x2 *= S; y2 *= S; width *= S
  const r = width / 2
  const minX = Math.max(0, Math.floor(Math.min(x1, x2) - r - 1))
  const maxX = Math.min(W * S - 1, Math.ceil(Math.max(x1, x2) + r + 1))
  const minY = Math.max(0, Math.floor(Math.min(y1, y2) - r - 1))
  const maxY = Math.min(H * S - 1, Math.ceil(Math.max(y1, y2) + r + 1))
  const dx = x2 - x1
  const dy = y2 - y1
  const len2 = dx * dx + dy * dy
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      let t = len2 === 0 ? 0 : ((x - x1) * dx + (y - y1) * dy) / len2
      t = Math.max(0, Math.min(1, t))
      const xx = x1 + dx * t - x
      const yy = y1 + dy * t - y
      if (xx * xx + yy * yy <= r * r) px(data, x, y, color, alpha)
    }
  }
}

function arc (data, cx, cy, rx, ry, fromDeg, toDeg, width, color, alpha = 1) {
  const steps = Math.max(6, Math.round((Math.abs(toDeg - fromDeg) / 360) * 48))
  let prev = null
  for (let i = 0; i <= steps; i++) {
    const angle = (fromDeg + ((toDeg - fromDeg) * i) / steps) * Math.PI / 180
    const point = [cx + Math.cos(angle) * rx, cy + Math.sin(angle) * ry]
    if (prev !== null) segment(data, prev[0], prev[1], point[0], point[1], width, color, alpha)
    prev = point
  }
}

// ------------------------------------------------------------------ layers

const layers = []

function layer (file, draw) {
  layers.push({ file, draw })
}

layer('hair-long.png', (d) => {
  ellipse(d, 360, 430, 205, 275, HAIR)
  rect(d, 175, 470, 370, 470, HAIR)
  ellipse(d, 360, 940, 185, 90, HAIR)
  ellipse(d, 230, 420, 34, 210, HAIR_DARK, 0.35)
  ellipse(d, 490, 420, 34, 210, HAIR_DARK, 0.2)
  segment(d, 300, 620, 285, 900, 6, HAIR_LIGHT, 0.35)
})

layer('hair-bob.png', (d) => {
  ellipse(d, 360, 420, 195, 240, HAIR)
  ellipse(d, 360, 560, 180, 130, HAIR)
  ellipse(d, 220, 540, 34, 110, HAIR_DARK, 0.3)
  ellipse(d, 500, 540, 34, 110, HAIR_DARK, 0.18)
})

layer('body-dress.png', (d) => {
  ellipse(d, 258, 700, 42, 120, SKIN)
  ellipse(d, 462, 700, 42, 120, SKIN)
  polygon(d, [[300, 580], [420, 580], [490, 980], [230, 980]], CREAM)
  polygon(d, [[300, 580], [360, 640], [420, 580], [402, 566], [360, 604], [318, 566]], RED)
  rect(d, 230, 952, 260, 28, RED)
  rect(d, 292, 730, 136, 18, RED, 0.9)
  segment(d, 330, 700, 318, 930, 3, [214, 198, 168], 0.5)
  segment(d, 400, 720, 420, 940, 3, [214, 198, 168], 0.4)
})

layer('body-hoodie.png', (d) => {
  ellipse(d, 258, 710, 40, 115, SKIN)
  ellipse(d, 462, 710, 40, 115, SKIN)
  ellipse(d, 360, 600, 120, 54, NAVY)
  ellipse(d, 360, 610, 96, 36, [40, 52, 74])
  polygon(d, [[300, 590], [420, 590], [474, 950], [246, 950]], NAVY)
  rect(d, 246, 900, 228, 50, [40, 52, 74])
  roundRect(d, 300, 790, 120, 70, 10, [40, 52, 74])
  segment(d, 330, 585, 322, 700, 5, GOLD)
  segment(d, 390, 585, 398, 700, 5, GOLD)
  ellipse(d, 322, 706, 7, 7, GOLD)
  ellipse(d, 398, 706, 7, 7, GOLD)
})

layer('head.png', (d) => {
  polygon(d, [[250, 300], [300, 150], [352, 268]], HAIR)
  polygon(d, [[470, 300], [420, 150], [368, 268]], HAIR)
  polygon(d, [[268, 284], [300, 184], [336, 270]], [236, 170, 160])
  polygon(d, [[452, 284], [420, 184], [384, 270]], [236, 170, 160])
  rect(d, 332, 540, 56, 80, SKIN_SHADE)
  ellipse(d, 360, 386, 152, 168, SKIN)
  ellipse(d, 240, 430, 30, 60, SKIN_SHADE, 0.35)
  ellipse(d, 480, 430, 30, 60, SKIN_SHADE, 0.2)
  segment(d, 360, 448, 360, 452, 3, [214, 160, 146], 0.8)
})

layer('bangs-a.png', (d) => {
  polygon(d, [[210, 330], [236, 236], [300, 214], [360, 206], [426, 218], [486, 246], [510, 330], [474, 292], [438, 316], [398, 286], [360, 318], [320, 286], [280, 316], [244, 292]], HAIR)
  polygon(d, [[300, 226], [360, 214], [412, 226], [372, 250], [332, 248]], HAIR_LIGHT, 0.55)
})

layer('bangs-b.png', (d) => {
  // A middle-part fringe: one concave silhouette with a soft V at the crown,
  // so the forehead shows through the parting instead of two horns.
  polygon(d, [
    [210, 332], [228, 244], [300, 210], [354, 220], [360, 296], [366, 220],
    [420, 210], [492, 244], [510, 332], [472, 300], [428, 338], [382, 302],
    [360, 332], [338, 302], [292, 338], [248, 300],
  ], HAIR)
  polygon(d, [[286, 226], [352, 218], [356, 280], [316, 250]], HAIR_LIGHT, 0.4)
  polygon(d, [[434, 226], [368, 218], [364, 280], [404, 250]], HAIR_LIGHT, 0.35)
})

layer('eyes-open.png', (d) => {
  for (const cx of [302, 418]) {
    ellipse(d, cx, 398, 25, 34, INK)
    ellipse(d, cx - 8, 388, 8, 11, WHITE)
    ellipse(d, cx + 7, 410, 4, 5, WHITE, 0.7)
    segment(d, cx - 30, 356, cx + 28, 352, 5, HAIR_DARK, 0.9)
  }
})

layer('eyes-closed.png', (d) => {
  arc(d, 302, 392, 26, 20, 20, 160, 4, INK)
  arc(d, 418, 392, 26, 20, 20, 160, 4, INK)
})

layer('eyes-star.png', (d) => {
  const star = (cx, cy, outer, inner) => {
    const points = []
    for (let i = 0; i < 10; i++) {
      const angle = -Math.PI / 2 + (i * Math.PI) / 5
      const r = i % 2 === 0 ? outer : inner
      points.push([cx + Math.cos(angle) * r, cy + Math.sin(angle) * r])
    }
    polygon(d, points, GOLD)
    ellipse(d, cx, cy, inner * 0.55, inner * 0.55, WHITE, 0.9)
  }
  star(302, 398, 30, 12)
  star(418, 398, 30, 12)
  ellipse(d, 302, 398, 34, 40, INK, 0.12)
  ellipse(d, 418, 398, 34, 40, INK, 0.12)
})

layer('mouth-smile.png', (d) => {
  arc(d, 360, 456, 26, 18, 20, 160, 4, INK)
})

layer('mouth-o.png', (d) => {
  ellipse(d, 360, 476, 12, 16, INK)
  ellipse(d, 360, 482, 7, 9, [120, 60, 60])
})

layer('mouth-smirk.png', (d) => {
  arc(d, 372, 458, 26, 16, 10, 140, 4, INK)
  segment(d, 396, 450, 408, 444, 3, INK, 0.7)
})

layer('blush-soft.png', (d) => {
  ellipse(d, 258, 448, 34, 18, BLUSH, 0.5)
  ellipse(d, 462, 448, 34, 18, BLUSH, 0.5)
  segment(d, 240, 446, 252, 438, 2, [220, 120, 120], 0.5)
  segment(d, 250, 452, 262, 444, 2, [220, 120, 120], 0.5)
  segment(d, 470, 446, 482, 438, 2, [220, 120, 120], 0.5)
  segment(d, 460, 452, 472, 444, 2, [220, 120, 120], 0.5)
})

layer('ribbon-red.png', (d) => {
  polygon(d, [[360, 590], [300, 556], [304, 624]], RED)
  polygon(d, [[360, 590], [420, 556], [416, 624]], RED)
  ellipse(d, 360, 590, 16, 16, [178, 54, 44])
  ellipse(d, 360, 590, 8, 8, [232, 106, 96])
})

layer('glasses.png', (d) => {
  roundRect(d, 258, 368, 90, 58, 12, GLASS, 0.16)
  roundRect(d, 372, 368, 90, 58, 12, GLASS, 0.16)
  arc(d, 303, 397, 45, 29, 0, 360, 4, GLASS)
  arc(d, 417, 397, 45, 29, 0, 360, 4, GLASS)
  segment(d, 348, 396, 372, 396, 4, GLASS)
  segment(d, 258, 396, 240, 386, 3, GLASS)
  segment(d, 462, 396, 480, 386, 3, GLASS)
  ellipse(d, 288, 382, 10, 6, WHITE, 0.45)
  ellipse(d, 402, 382, 10, 6, WHITE, 0.45)
})

// ------------------------------------------------------------------ write

fs.mkdirSync(path.join(OUT, 'layers'), { recursive: true })
fs.mkdirSync(path.join(OUT, 'recipes'), { recursive: true })

for (const { file, draw } of layers) {
  const data = canvas()
  draw(data)
  const small = scaleRgba(data, W * S, H * S, W, H)
  fs.writeFileSync(path.join(OUT, 'layers', file), encodePng(small, W, H))
  console.log('layer', file)
}

const pack = {
  schema: 'diff-forge/pack@1',
  id: 'demo-momo',
  title: 'Momo - 示例角色',
  description: '程序生成的原创猫耳角色，用来演示槽位、开关和纯数据配方。所有 PNG 都由 scripts/make-demo-pack.mjs 绘制，CC0。',
  author: 'Diff Forge contributors',
  license: 'CC0-1.0',
  canvas: { width: W, height: H },
  slots: [
    { key: 'base', label: '素体', mode: 'single', default: 'head' },
    { key: 'costume', label: '服装', mode: 'single', default: 'dress' },
    { key: 'hair', label: '发型', mode: 'single', default: 'hair-long' },
    { key: 'eyes', label: '眼睛', mode: 'single', default: 'eyes-open' },
    { key: 'mouth', label: '嘴', mode: 'single', default: 'mouth-smile' },
    { key: 'bangs', label: '刘海', mode: 'single', default: 'bangs-a' },
    { key: 'blush', label: '红晕', mode: 'toggle' },
    { key: 'ribbon', label: '蝴蝶结', mode: 'toggle' },
    { key: 'glasses', label: '眼镜', mode: 'toggle' },
  ],
  layers: [
    { id: 'hair-long', name: '长发', src: 'layers/hair-long.png', slot: 'hair', z: 0, visible: true },
    { id: 'hair-bob', name: '短发', src: 'layers/hair-bob.png', slot: 'hair', z: 0, visible: false },
    { id: 'dress', name: '奶油连衣裙', src: 'layers/body-dress.png', slot: 'costume', z: 10, visible: true },
    { id: 'hoodie', name: '藏青卫衣', src: 'layers/body-hoodie.png', slot: 'costume', z: 10, visible: false },
    { id: 'head', name: '头与耳朵', src: 'layers/head.png', slot: 'base', z: 20, visible: true },
    { id: 'eyes-open', name: '睁眼', src: 'layers/eyes-open.png', slot: 'eyes', z: 30, visible: true },
    { id: 'eyes-closed', name: '闭眼', src: 'layers/eyes-closed.png', slot: 'eyes', z: 30, visible: false },
    { id: 'eyes-star', name: '星星眼', src: 'layers/eyes-star.png', slot: 'eyes', z: 30, visible: false },
    { id: 'mouth-smile', name: '微笑', src: 'layers/mouth-smile.png', slot: 'mouth', z: 31, visible: true },
    { id: 'mouth-o', name: '惊讶', src: 'layers/mouth-o.png', slot: 'mouth', z: 31, visible: false },
    { id: 'mouth-smirk', name: '坏笑', src: 'layers/mouth-smirk.png', slot: 'mouth', z: 31, visible: false },
    { id: 'blush-soft', name: '淡淡红晕', src: 'layers/blush-soft.png', slot: 'blush', z: 32, visible: false },
    { id: 'ribbon-red', name: '红蝴蝶结', src: 'layers/ribbon-red.png', slot: 'ribbon', z: 40, visible: false },
    { id: 'glasses', name: '圆眼镜', src: 'layers/glasses.png', slot: 'glasses', z: 41, visible: false },
    { id: 'bangs-a', name: '侧分刘海', src: 'layers/bangs-a.png', slot: 'bangs', z: 50, visible: true },
    { id: 'bangs-b', name: '中分刘海', src: 'layers/bangs-b.png', slot: 'bangs', z: 50, visible: false },
  ],
  recipes: [
    'recipes/sunset.json',
    'recipes/night.json',
    'recipes/sticker.json',
  ],
}

fs.writeFileSync(path.join(OUT, 'pack.json'), JSON.stringify(pack, null, 2) + '\n', 'utf8')
console.log('pack.json')

const recipes = {
  'sunset.json': {
    schema: 'diff-forge/recipe@1',
    id: 'sunset',
    label: '黄昏逆光',
    description: '暖色偏移 + 轻微提亮 + 下方投影',
    ops: [
      { op: 'tint', color: '#ff8a3d', amount: 0.18 },
      { op: 'brightness', amount: 0.04 },
      { op: 'saturate', amount: 1.12 },
      { op: 'shadow', dx: 0, dy: 10, alpha: 0.18, color: '#000000' },
    ],
  },
  'night.json': {
    schema: 'diff-forge/recipe@1',
    id: 'night',
    label: '夜色描边',
    description: '冷色、低饱和、细白描边',
    ops: [
      { op: 'tint', color: '#3b5bdb', amount: 0.24 },
      { op: 'brightness', amount: -0.05 },
      { op: 'saturate', amount: 0.85 },
      { op: 'border', color: '#f7f7f7', width: 2, alpha: 0.9 },
    ],
  },
  'sticker.json': {
    schema: 'diff-forge/recipe@1',
    id: 'sticker',
    label: '贴纸',
    description: '黑描边 + 硬投影，适合导出做表情包',
    ops: [
      { op: 'border', color: '#101010', width: 3, alpha: 1 },
      { op: 'shadow', dx: 0, dy: 12, alpha: 0.28, color: '#000000' },
    ],
  },
}

for (const [file, doc] of Object.entries(recipes)) {
  fs.writeFileSync(path.join(OUT, 'recipes', file), JSON.stringify(doc, null, 2) + '\n', 'utf8')
  console.log('recipe', file)
}

console.log('demo pack written to', OUT)
