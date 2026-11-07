# Contributing

Thanks for wanting to improve Diff Forge.

## Ground rules

- **No game assets, game names, or character names** in issues, PRs, tests, or
  examples. The demo must stay generated/original.
- **No new runtime dependencies** unless there is a very strong reason; the
  plugin is deliberately dependency-free.
- Keep the extension surface **data-only**. New capabilities that execute
  user/AI code will not be merged.

## Development

```bash
npm test
npm run validate
npm run demo      # regenerates examples/demo (intended to be committed)
npm run previews  # regenerates docs/preview-*.png
```

The test suite covers pack validation, recipe ops, and the HTTP/tool routes via
a stubbed webServer. Add a test for every validator change and every new recipe
op.

## Adding a recipe op

1. Implement it in `lib/recipe.mjs` (`normalizeOp` + `applyRecipe`).
2. Add range checks and clamp/normalize in `normalizeOp`.
3. Document it in `docs/recipe-format.md`.
4. Add a unit test in `tests/recipe.test.mjs`.
5. If it needs to appear in AI prompts, update `lib/guide.mjs`.

Keep ops deterministic, canvas-bounded, and independent of external files.

## Adding a pack feature

Pack changes are schema changes. Bump the schema string if incompatible
(`diff-forge/pack@2`), update `docs/pack-format.md`, `lib/pack.mjs`, the demo
generator, and the tests. Prefer optional fields so existing packs keep working.

## Style

- Node ESM, no TypeScript, two-space indent, single quotes.
- Comments explain *why*, not *what*.
- Error messages should name the field and the allowed range.
- UI text goes through the `ZH` / `EN` dictionaries in `client.js`.

## Pull requests

- Describe the user-visible change and how you verified it.
- Include the test output.
- Do not include personal artwork or extracted game assets.
