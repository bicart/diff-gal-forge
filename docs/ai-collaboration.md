# AI collaboration

Diff Forge is built around one loop:

```text
you describe the look / the pack
        ↓
AI reads a brief and writes DATA (recipe.json or pack.json)
        ↓
the plugin validates schema, ranges and paths
        ↓
the panel hot-reloads it; you preview and iterate
```

The AI never has to touch plugin code, and the plugin never executes AI output.

## The brief

The panel's **AI 协作** section offers four cards:

| Card | What it asks the AI to do |
|---|---|
| 新配色 | write a `recipe.json` for the described mood |
| 做素材包 | turn a folder of transparent PNGs into slots + `pack.json` |
| 诊断重影 | inspect `z` / `x` / `y` / slot assignments and diagnose ghosting or offsets |
| 扩展插件 | decide whether a wanted feature belongs in pack data, recipe data, or code |

Each card copies a prompt that includes:

- the packs directory and the user-recipe directory (absolute paths),
- the current pack, slots, selected layers and active recipe,
- the exact JSON schemas and numeric ranges,
- hard rules: data only, relative paths, no commercial game assets, ask before guessing,
- the hand-off format (confirm target file, write it, report how to verify).

**复制完整简报** copies the full `overview` brief, which includes both schemas. The agent tool exposes the same text:

```text
diff_forge action=guide mode=overview
diff_forge action=guide mode=recipe
diff_forge action=guide mode=pack
diff_forge action=guide mode=debug
```

## What the AI is allowed to write

Only JSON files:

- a pack: new directory under `packs/` with `pack.json` + PNGs,
- a recipe: `<workDir>/recipes/<id>.json`.

Validation happens on every load and every render:

- schema string and required fields,
- ids, uniqueness, slot references,
- numeric ranges (`z`, `opacity`, offsets, op params),
- recipe op whitelist and max 32 ops,
- path confinement (`src` cannot escape the pack directory).

A malformed file produces a human-readable warning in the panel; it does not crash the Host.

## Worked example

1. The user clicks **新配色** and fills in: "黄昏逆光，低饱和，奶油色描边".
2. The AI reads the brief and writes `work/diff-forge/recipes/golden-hour.json`:

```json
{
  "schema": "diff-forge/recipe@1",
  "id": "golden-hour",
  "label": "Golden hour",
  "ops": [
    { "op": "tint", "color": "#ff9a3c", "amount": 0.2 },
    { "op": "saturate", "amount": 0.85 },
    { "op": "border", "color": "#f4e6c8", "width": 2, "alpha": 0.9 }
  ]
}
```

3. The panel polls `/state`; the recipe appears in the recipe picker. The user selects it.
4. If the look is wrong, the user says "warm it more, but keep the outline"; the AI edits the same file. The render cache key includes the ops, so the preview updates immediately.

## Why data, not code

- **No code execution surface.** The Host only runs its own renderer.
- **Reviewable diffs.** A recipe is a small JSON diff, not a plugin release.
- **Portable.** Recipes survive plugin upgrades and AI changes.
- **Legally cleaner.** No need to ship or patch game-specific code; assets stay in the user's own pack directory.

Code is MIT, so forking is allowed. The data path is simply the intended extension path.

## Prompt safety

The briefs tell the AI not to reference commercial game assets, character names, or trademarks, and not to download anything. That is guidance, not enforcement: ultimately the user is responsible for the images they put in `packs/`. The plugin's enforcement is limited to paths, schemas, and numeric ranges.

If you build on this, keep the same split: **generated content is data; execution stays in reviewed code.**

## Customizing the briefs

All prompt text lives in `lib/guide.mjs` (`ZH` / `EN` dictionaries plus `starterPrompts`). Adding a card means adding an entry with an `id`, `title`, and `prompt`; no other file needs to change.
