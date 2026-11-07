# Recipe format

A **recipe** is a JSON post-processing pipeline applied to the composed image. It is data, never code: the Host validates every op and only runs known operations.

Schema string: `diff-forge/recipe@1`.

```json
{
  "schema": "diff-forge/recipe@1",
  "id": "sunset",
  "label": "黄昏",
  "description": "optional",
  "ops": [
    { "op": "tint", "color": "#ff8a3d", "amount": 0.18 },
    { "op": "shadow", "dx": 0, "dy": 10, "alpha": 0.18 }
  ]
}
```

| Field | Required | Notes |
|---|---|---|
| `schema` | no | should be `diff-forge/recipe@1` |
| `id` | yes | `A-Z a-z 0-9 . _ -`, 1–64 chars; unique per pack |
| `label` | no | UI label, 1–40 chars |
| `description` | no | ≤ 300 chars |
| `ops` | yes | 1–32 ops, executed top to bottom |

## Where recipes live

- Pack recipes: `recipes/*.json` listed in `pack.json` → `recipes`.
- User recipes: `<workDir>/recipes/*.json` (default `<workspace>/work/diff-forge/recipes/`).
- A user recipe with the same `id` **overrides** the pack recipe. This is how a project can tweak a shipped look without forking the pack.

Recipes are hot-reloaded by mtime; adding a file while the plugin runs is enough.

## Ops

### `tint`

Lerp RGB toward a colour. Alpha is untouched.

```json
{ "op": "tint", "color": "#ff8a3d", "amount": 0.18 }
```

| Param | Range | Default |
|---|---|---|
| `color` | `#rgb` / `#rrggbb` / `#rrggbbaa` | required |
| `amount` | 0..1 | 0.2 |

### `brightness`

```json
{ "op": "brightness", "amount": 0.06 }
```

`amount` −1..1 (added as `amount * 255`). Negative darkens.

### `contrast`

```json
{ "op": "contrast", "amount": 0.1 }
```

`amount` −1..1. Positive expands around mid-grey, negative flattens.

### `saturate`

```json
{ "op": "saturate", "amount": 1.2 }
```

`amount` 0..3. `0` = grey, `1` = unchanged.

### `grayscale`

```json
{ "op": "grayscale", "amount": 1 }
```

`amount` 0..1 (default 1). Rec. 709 luma.

### `opacity`

```json
{ "op": "opacity", "amount": 0.8 }
```

Multiplies alpha; 0..1.

### `flip`

```json
{ "op": "flip", "axis": "h" }
```

`axis` `h` (default) or `v`. Useful for mirrored variants.

### `shadow`

Solid silhouette offset behind the artwork. No blur.

```json
{ "op": "shadow", "dx": 0, "dy": 10, "alpha": 0.25, "color": "#000000" }
```

| Param | Range | Default |
|---|---|---|
| `dx`, `dy` | −200..200 | 0, 8 |
| `alpha` | 0..1 | 0.35 |
| `color` | hex | `#000000` |

### `border`

Grow a 1–4 px outline around the silhouette. Later ops see the outline as part of the image.

```json
{ "op": "border", "color": "#f7f7f7", "width": 2, "alpha": 0.9 }
```

| Param | Range | Default |
|---|---|---|
| `width` | 1..4 | 2 |
| `alpha` | 0..1 | 1 |
| `color` | hex | `#ffffff` |

## Order and caching

- Ops run in array order. `border` then `shadow` differs from `shadow` then `border`.
- Renders are cached with the recipe's ops in the key: editing a recipe invalidates affected renders automatically.
- Unsupported ops, out-of-range numbers, or more than 32 ops are rejected with a message naming the problem.

## Performance notes

- `border` scans the image `width` times; keep it ≤ 4 and prefer preview widths while iterating.
- Recipes run after compositing, so a recipe affects **everything** including accessories; layer-scoped effects are on the roadmap.
- For sticker exports, `border` + `shadow` at 2400 px is typically < 1 s for a 720×1080 pack.

## Validate a recipe by hand

```js
import { normalizeRecipe, applyRecipe } from './lib/recipe.mjs'
const recipe = normalizeRecipe(JSON.parse(raw))
const out = applyRecipe(rgba, width, height, recipe.ops)
```
