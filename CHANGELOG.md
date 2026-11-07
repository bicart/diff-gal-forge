# Changelog

## 0.1.0 — 2026-11-07

First public release.

- Generic layered-character packs (`pack.json` + RGBA PNGs), no game-specific code.
- Exclusive `single` slots, `toggle` slots, `groups` display hints.
- Data-only recipes: tint, brightness, contrast, saturate, grayscale, opacity,
  flip, shadow, border.
- Host composition with disk caches for renders and thumbnails.
- Shared selection state between the panel and the `diff_forge` agent tool.
- AI collaboration briefs (overview / pack / recipe / debug) and four copyable
  starter cards in the panel; the panel opens as a full-height overlay so the
  slots above cannot squeeze it into a strip.
- Panel: pack/slot/recipe pickers, zoom/pan preview, 2400 px PNG export,
  draggable/resizable window, light/dark palette; first open is centered so it
  does not hide behind the side panels.
- Collapse/expand chevron in the title bar, matching the other DSH panels.
- Bundled demo pack generated from code (CC0).
- Bundled `examples/aria`: an 832×1216 character generated on-device with
  OpenVINO + Animagine XL 4.0. Its expression and costume variants are masked
  inpainting edits of the same render, so layers stay pixel-aligned; the
  pipeline is documented in `docs/ai-art.md`.
- Tests for pack validation, recipe ops, and HTTP routes.
- Visual pass in a real browser: light/dark palette polarity now follows the
  surface (no more dark form wells or checkerboard on a white panel), the AI
  overlay header keeps its label on one line, and the slot list keeps its
  share of the window when maximized.
- Example layers are trimmed to their alpha bounds, shrinking `examples/aria`
  from ~11 MB to ~2 MB; the panel uses the stored `x / y` offsets to place them.
- Preview panning now follows the letterboxed image instead of the stage box,
  so zoomed portraits can no longer slide off and expose empty corners.
