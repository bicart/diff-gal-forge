/**
 * Minimal dependency-free PNG codec (RGBA8, non-interlaced).
 *
 * Why hand-written: the Host has to composite on demand, we do not want a
 * native image dependency, and spawning an external tool per request would be
 * far too slow. Every layer in the supported pack format must be 8-bit RGBA,
 * non-interlaced — which is exactly what `decodePng` accepts. Anything else
 * fails loudly instead of producing garbage.
 */

import zlib from 'node:zlib'

const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])

/** Parse IHDR without inflating anything. */
export function readPngHeader (buffer) {
  if (buffer.length < 33 || !buffer.subarray(0, 8).equals(SIGNATURE)) {
    throw new Error('not a PNG')
  }
  const width = buffer.readUInt32BE(16)
  const height = buffer.readUInt32BE(20)
  const bitDepth = buffer[24]
  const colorType = buffer[25]
  const interlace = buffer[28]
  return { width, height, bitDepth, colorType, interlace }
}

function idatPayload (buffer) {
  const parts = []
  let pos = 8
  while (pos + 8 <= buffer.length) {
    const length = buffer.readUInt32BE(pos)
    const type = buffer.toString('latin1', pos + 4, pos + 8)
    const start = pos + 8
    const end = start + length
    if (end > buffer.length) break
    if (type === 'IDAT') parts.push(buffer.subarray(start, end))
    else if (type === 'IEND') break
    pos = end + 4
  }
  return parts.length === 0 ? Buffer.alloc(0) : Buffer.concat(parts)
}

function paeth (a, b, c) {
  const p = a + b - c
  const pa = Math.abs(p - a)
  const pb = Math.abs(p - b)
  const pc = Math.abs(p - c)
  if (pa <= pb && pa <= pc) return a
  return pb <= pc ? b : c
}

/** Decode one RGBA8 PNG into a tightly packed Uint8Array. */
export function decodePng (buffer) {
  const header = readPngHeader(buffer)
  if (header.bitDepth !== 8 || header.colorType !== 6 || header.interlace !== 0) {
    throw new Error(
      `unsupported PNG (depth=${header.bitDepth} color=${header.colorType} interlace=${header.interlace}); ` +
      'Diff Forge needs 8-bit RGBA non-interlaced PNGs')
  }
  const { width, height } = header
  const stride = width * 4
  const raw = zlib.inflateSync(idatPayload(buffer))
  const expected = (stride + 1) * height
  if (raw.length < expected) throw new Error('truncated PNG data')

  const out = new Uint8Array(stride * height)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos]
    pos += 1
    const rowStart = y * stride
    const prevStart = rowStart - stride
    for (let x = 0; x < stride; x++) {
      const value = raw[pos + x]
      const a = x >= 4 ? out[rowStart + x - 4] : 0
      const b = y > 0 ? out[prevStart + x] : 0
      const c = x >= 4 && y > 0 ? out[prevStart + x - 4] : 0
      let result
      switch (filter) {
        case 0: result = value; break
        case 1: result = value + a; break
        case 2: result = value + b; break
        case 3: result = value + ((a + b) >> 1); break
        case 4: result = value + paeth(a, b, c); break
        default: throw new Error('bad PNG filter ' + filter)
      }
      out[rowStart + x] = result & 0xff
    }
    pos += stride
  }
  return { width, height, data: out }
}

/**
 * Box-downsample an RGBA image, alpha-weighted so transparent edges do not
 * drag colour toward black.
 */
export function scaleRgba (src, sw, sh, dw, dh) {
  if (dw === sw && dh === sh) return src
  const mid = new Float32Array(dw * sh * 4)
  const xSpans = []
  for (let dx = 0; dx < dw; dx++) {
    const from = (dx * sw) / dw
    const to = ((dx + 1) * sw) / dw
    const first = Math.floor(from)
    const last = Math.min(sw - 1, Math.ceil(to) - 1)
    const weights = []
    let total = 0
    for (let sx = first; sx <= last; sx++) {
      const overlap = Math.min(to, sx + 1) - Math.max(from, sx)
      if (overlap <= 0) continue
      weights.push(sx, overlap)
      total += overlap
    }
    xSpans.push({ weights, total: total === 0 ? 1 : total })
  }
  for (let sy = 0; sy < sh; sy++) {
    const srcRow = sy * sw * 4
    const midRow = sy * dw * 4
    for (let dx = 0; dx < dw; dx++) {
      const { weights, total } = xSpans[dx]
      let r = 0; let g = 0; let b = 0; let a = 0
      for (let i = 0; i < weights.length; i += 2) {
        const o = srcRow + weights[i] * 4
        const w = weights[i + 1]
        const alpha = src[o + 3]
        r += src[o] * alpha * w
        g += src[o + 1] * alpha * w
        b += src[o + 2] * alpha * w
        a += alpha * w
      }
      const o2 = midRow + dx * 4
      if (a > 0) {
        mid[o2] = r / a
        mid[o2 + 1] = g / a
        mid[o2 + 2] = b / a
        mid[o2 + 3] = a / total
      }
    }
  }
  const out = new Uint8Array(dw * dh * 4)
  for (let dy = 0; dy < dh; dy++) {
    const from = (dy * sh) / dh
    const to = ((dy + 1) * sh) / dh
    const first = Math.floor(from)
    const last = Math.min(sh - 1, Math.ceil(to) - 1)
    const rows = []
    let total = 0
    for (let sy = first; sy <= last; sy++) {
      const overlap = Math.min(to, sy + 1) - Math.max(from, sy)
      if (overlap <= 0) continue
      rows.push(sy, overlap)
      total += overlap
    }
    if (total === 0) total = 1
    const outRow = dy * dw * 4
    for (let dx = 0; dx < dw; dx++) {
      let r = 0; let g = 0; let b = 0; let a = 0
      for (let i = 0; i < rows.length; i += 2) {
        const o = (rows[i] * dw + dx) * 4
        const w = rows[i + 1]
        const alpha = mid[o + 3]
        r += mid[o] * alpha * w
        g += mid[o + 1] * alpha * w
        b += mid[o + 2] * alpha * w
        a += alpha * w
      }
      const o3 = outRow + dx * 4
      if (a > 0) {
        out[o3] = Math.min(255, r / a)
        out[o3 + 1] = Math.min(255, g / a)
        out[o3 + 2] = Math.min(255, b / a)
        out[o3 + 3] = Math.min(255, a / total)
      }
    }
  }
  return out
}

/** Encode an RGBA buffer as PNG (filter 0, deflate 6). */
export function encodePng (data, width, height) {
  const stride = width * 4
  const raw = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0
    Buffer.from(data.buffer, data.byteOffset + y * stride, stride)
      .copy(raw, y * (stride + 1) + 1)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  ihdr[10] = 0
  ihdr[11] = 0
  ihdr[12] = 0

  const chunks = [SIGNATURE, chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 6 })), chunk('IEND', Buffer.alloc(0))]
  return Buffer.concat(chunks)
}

function chunk (type, payload) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(payload.length, 0)
  head.write(type, 4, 'latin1')
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, 'latin1'), payload])) >>> 0, 0)
  return Buffer.concat([head, payload, crc])
}

let CRC_TABLE = null
function crc32 (buf) {
  if (CRC_TABLE === null) {
    CRC_TABLE = new Uint32Array(256)
    for (let n = 0; n < 256; n++) {
      let c = n
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
      CRC_TABLE[n] = c >>> 0
    }
  }
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

/** Composite one layer onto an RGBA canvas with source-over. */
export function blendOver (canvas, layer, canvasWidth, canvasHeight, offsetX, offsetY, opacity = 255) {
  const layerWidth = layer.width
  const layerHeight = layer.height
  const data = layer.data
  const opacityScale = opacity / 255
  const opacityUnit = opacityScale / 255
  for (let y = 0; y < layerHeight; y++) {
    const cy = offsetY + y
    if (cy < 0 || cy >= canvasHeight) continue
    const row = y * layerWidth
    const canvasRow = cy * canvasWidth
    for (let x = 0; x < layerWidth; x++) {
      const cx = offsetX + x
      if (cx < 0 || cx >= canvasWidth) continue
      const s = (row + x) * 4
      const sa = data[s + 3] * opacityScale
      if (sa <= 0) continue
      const d = (canvasRow + cx) * 4
      const da = canvas[d + 3]
      const saN = sa / 255
      const daN = da / 255
      const outA = saN + daN * (1 - saN)
      if (outA <= 0) continue
      const sr = data[s]; const sg = data[s + 1]; const sb = data[s + 2]
      const dr = canvas[d]; const dg = canvas[d + 1]; const db = canvas[d + 2]
      canvas[d] = (sr * saN + dr * daN * (1 - saN)) / outA
      canvas[d + 1] = (sg * saN + dg * daN * (1 - saN)) / outA
      canvas[d + 2] = (sb * saN + db * daN * (1 - saN)) / outA
      canvas[d + 3] = outA * 255
    }
  }
  return canvas
}

/** A flat canvas filled with one colour (used as a backdrop layer). */
export function fillRgba (width, height, [r, g, b, a = 255]) {
  const data = new Uint8Array(width * height * 4)
  for (let i = 0; i < data.length; i += 4) {
    data[i] = r
    data[i + 1] = g
    data[i + 2] = b
    data[i + 3] = a
  }
  return data
}
