import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeRecipe, applyRecipe, parseColor, RecipeError } from '../lib/recipe.mjs'

test('parseColor handles short and alpha hex', () => {
  assert.deepEqual(parseColor('#f80'), [255, 136, 0, 255])
  assert.deepEqual(parseColor('#ff880080'), [255, 136, 0, 128])
  assert.throws(() => parseColor('red'), RecipeError)
})

test('normalizeRecipe rejects unknown ops and bad ranges', () => {
  assert.throws(() => normalizeRecipe({ id: 'x', ops: [{ op: 'explode' }] }), /not supported/)
  assert.throws(() => normalizeRecipe({ id: 'x', ops: [{ op: 'brightness', amount: 5 }] }), /number in/)
  assert.throws(() => normalizeRecipe({ id: 'x', ops: [] }), /non-empty/)
})

test('tint, opacity and grayscale mutate RGBA correctly', () => {
  const pixel = new Uint8Array([255, 0, 0, 255])
  applyRecipe(pixel, 1, 1, [{ op: 'tint', color: [0, 0, 255, 255], amount: 1 }])
  assert.deepEqual([...pixel], [0, 0, 255, 255])

  const faded = new Uint8Array([10, 20, 30, 200])
  applyRecipe(faded, 1, 1, [{ op: 'opacity', amount: 0.5 }])
  assert.equal(faded[3], 100)

  const gray = new Uint8Array([255, 0, 0, 255])
  applyRecipe(gray, 1, 1, [{ op: 'grayscale', amount: 1 }])
  assert.equal(gray[0], gray[1])
  assert.equal(gray[1], gray[2])
})

test('flip mirrors horizontally and vertically', () => {
  const data = new Uint8Array([
    1, 0, 0, 255, 2, 0, 0, 255,
    3, 0, 0, 255, 4, 0, 0, 255,
  ])
  applyRecipe(data, 2, 2, [{ op: 'flip', axis: 'h' }])
  assert.deepEqual([...data], [
    2, 0, 0, 255, 1, 0, 0, 255,
    4, 0, 0, 255, 3, 0, 0, 255,
  ])
  applyRecipe(data, 2, 2, [{ op: 'flip', axis: 'v' }])
  assert.deepEqual([...data], [
    4, 0, 0, 255, 3, 0, 0, 255,
    2, 0, 0, 255, 1, 0, 0, 255,
  ])
})

test('border and shadow add pixels without moving the original', () => {
  const data = new Uint8Array(3 * 3 * 4)
  const center = (1 * 3 + 1) * 4
  data.set([255, 0, 0, 255], center)
  const bordered = applyRecipe(data.slice(), 3, 3, [{ op: 'border', color: [0, 0, 0, 255], width: 1, alpha: 1 }])
  let opaque = 0
  for (let i = 3; i < bordered.length; i += 4) if (bordered[i] > 0) opaque++
  assert.equal(opaque, 9)
  assert.deepEqual([...bordered.slice(center, center + 4)], [255, 0, 0, 255])

  const shadowed = applyRecipe(data.slice(), 3, 3, [{ op: 'shadow', color: [0, 0, 0, 255], dx: 1, dy: 0, alpha: 0.5 }])
  const right = (1 * 3 + 2) * 4
  assert.ok(shadowed[right + 3] > 0)
  assert.deepEqual([...shadowed.slice(center, center + 4)], [255, 0, 0, 255])
})
