#!/usr/bin/env node
/**
 * Validate one pack (a directory with pack.json) or every pack under a packs
 * directory. Prints a short summary and exits non-zero on the first bad pack.
 *
 *   node scripts/validate-pack.mjs examples/demo
 *   node scripts/validate-pack.mjs examples
 */

import fs from 'node:fs'
import path from 'node:path'
import { loadPack, listPacks, defaultPicks, paintOrder, PackError } from '../lib/pack.mjs'
import { loadRecipes } from '../lib/recipe.mjs'

function describe (pack, recipes) {
  const picks = defaultPicks(pack)
  const lines = [
    `OK ${pack.slug} — ${pack.title}`,
    `   canvas ${pack.canvas.width}x${pack.canvas.height}; ${pack.layers.length} layers; ${pack.slots.length} slots; ${recipes.recipes.length} recipes`,
  ]
  for (const slot of pack.slots) {
    lines.push(`   [${slot.mode}] ${slot.key} (${slot.label}): ${slot.members.join(', ')}`)
  }
  lines.push(`   default paint: ${paintOrder(pack, picks).map((layer) => `${layer.id}@z${layer.z}`).join(' -> ')}`)
  if (recipes.problems.length > 0) lines.push(`   recipe warnings: ${recipes.problems.join(' | ')}`)
  return lines.join('\n')
}

const target = path.resolve(process.argv[2] ?? 'examples/demo')

try {
  if (fs.existsSync(path.join(target, 'pack.json'))) {
    const pack = loadPack(path.dirname(target), path.basename(target))
    const recipes = loadRecipes(pack, '')
    console.log(describe(pack, recipes))
  } else {
    const { packs, problems } = listPacks(target)
    if (packs.length === 0) {
      console.error(`No packs found in ${target}`)
      process.exit(1)
    }
    for (const entry of packs) {
      if (entry.problem !== undefined) {
        console.error(`FAIL ${entry.slug}: ${entry.problem}`)
        process.exitCode = 1
        continue
      }
      const pack = loadPack(target, entry.slug)
      const recipes = loadRecipes(pack, '')
      console.log(describe(pack, recipes))
    }
    if (problems.length > 0) console.error(`\n${problems.length} pack(s) failed.`)
  }
} catch (error) {
  if (error instanceof PackError) {
    console.error(`FAIL: ${error.message}`)
    process.exit(1)
  }
  throw error
}
