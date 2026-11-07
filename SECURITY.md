# Security

## Design boundaries

- The Host never executes pack or recipe content. Packs are JSON + PNG; recipes are JSON ops from a fixed whitelist.
- Every pack-relative path is resolved and confined to the pack directory. `..`, absolute paths, and URLs are rejected.
- Numeric fields and op counts are bounded before reaching the renderer.
- The HTTP routes only accept loopback hosts and same-origin requests, mirroring the Harness plugin route fence.
- No telemetry, network calls, install scripts, or runtime dependencies.

## Reporting a vulnerability

Open a private security advisory on the repository, or email the maintainer
listed in `package.json`. Please include:

- the input that triggers the issue,
- the expected and actual behaviour,
- the plugin version and Node version.

Do not include third-party game assets in a report.
