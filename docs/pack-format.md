# Pack format

A **pack** is a directory under `packs/` containing `pack.json`, transparent PNG layers, and optional recipe JSON files.

```text
packs/
  my-character/
    pack.json
    layers/...
    recipes/...        # optional
```

The directory name (slug) is the pack's identity in URLs and state. It may contain
Unicode (e.g. a Chinese folder name) but no path separators or reserved characters.
`pack.json` `id` is a display id and stays ASCII; they may differ, but keeping them
equal avoids confusion.

Schema string: `diff-forge/pack@1`.

## Top-level fields

| Field | Required | Type | Notes |
|---|---|---|---|
| `schema` | yes | string | must be `diff-forge/pack@1` |
| `id` | no | string | `A-Z a-z 0-9 . _ -`, 1–64 chars; defaults to the directory name |
| `title` | no | string | 1–80 chars; defaults to `id` |
| `description` | no | string | ≤ 400 chars |
| `author`, `license`, `homepage` | no | string | metadata only |
| `canvas` | yes | `{ width, height }` | integers 1–8192 |
| `slots` | yes | array | 1–64 entries |
| `layers` | yes | array | 1–512 entries |
| `recipes` | no | string[] | pack-relative `.json` paths; must exist |

Unknown fields are ignored, so packs can carry extra metadata.

## Slots

```json
{ "key": "eyes", "label": "眼睛", "mode": "single", "default": "eyes-open", "note": "…" }
```

| Field | Required | Notes |
|---|---|---|
| `key` | yes | unique, `A-Z a-z 0-9 . _ -`, 1–48 chars; used by state/URLs/tool |
| `label` | no | UI label, 1–40 chars; defaults to `key` |
| `mode` | no | `single` (default) or `toggle` |
| `default` | no | layer id inside this slot |
| `note` | no | tooltip text |
| `groups` | no | display-only optgroups: `[{ "label": "预设", "members": ["a", "b"] }]` |

- `single`: exactly one member is shown. If `default` is omitted, the first `visible: true` member wins, then the first member.
- `toggle`: zero or one member. Omitted `default` means off.
- A layer belongs to exactly one slot via `slot`.

## Layers

```json
{
  "id": "eyes-closed",
  "name": "闭眼",
  "src": "layers/eyes-closed.png",
  "slot": "eyes",
  "z": 30,
  "x": 0,
  "y": 0,
  "opacity": 1,
  "visible": false,
  "tags": ["face"]
}
```

| Field | Required | Notes |
|---|---|---|
| `id` | yes | unique, `A-Z a-z 0-9 . _ -`, 1–64 chars |
| `name` | no | UI label, 1–80 chars; defaults to `id` |
| `src` | yes | pack-relative `.png`, no `..` / absolute / URL |
| `slot` | yes | must reference a declared slot |
| `z` | no | number −10000..10000, default `0`; **lower paints first (further back)** |
| `x`, `y` | no | integer offset on the canvas, ±8192, default `0` |
| `opacity` | no | 0..1, default `1` |
| `visible` | no | strict boolean, default `true`; only affects default selection |
| `tags` | no | string array, display/debug only |

Paint order: ascending `z`, ties by declaration order. The head is normally `z: 20`, face parts `30–32`, accessories `40+`, front hair `50`.

## PNG requirements

- 8-bit RGBA, non-interlaced. Anything else is rejected with a clear error.
- Layers may be full-canvas or cropped with `x`/`y` — the renderer clips to the canvas.
- No fixed DPI or color profile requirements; straight alpha is assumed.
- Very large layers cost decode time; 2000–4000 px per side is a sensible range.

## Validation and limits

- Paths are resolved inside the pack directory; traversal is rejected.
- Slot/layer ids must be unique; slot references must resolve.
- Recipes listed in `recipes` must exist.
- A single bad pack does not break the plugin: the panel shows it as broken and the tool reports the reason.

Validate from the CLI:

```bash
node scripts/validate-pack.mjs examples/demo
node scripts/validate-pack.mjs examples
```

## Minimal complete example

```json
{
  "schema": "diff-forge/pack@1",
  "id": "example",
  "title": "Example",
  "canvas": { "width": 800, "height": 1200 },
  "slots": [
    { "key": "body", "label": "Body", "mode": "single", "default": "body-a" },
    { "key": "face", "label": "Face", "mode": "single", "default": "face-a" }
  ],
  "layers": [
    { "id": "body-a", "name": "Body A", "src": "layers/body-a.png", "slot": "body", "z": 0 },
    { "id": "face-a", "name": "Face A", "src": "layers/face-a.png", "slot": "face", "z": 10 }
  ]
}
```

## Common mistakes

- **Two costumes in one slot both visible** — put them in the same `single` slot; only one is painted.
- **Face parts ghosting** — 表情 and 追加 belong in one `single` slot, not two stacked slots.
- **Accessory hidden under hair** — raise its `z`, or lower the hair's.
- **Default is a display name** — `default` takes a **layer id**, not `name`.
- **Opaque background** — a pack should stay transparent; the panel shows a checkerboard.
