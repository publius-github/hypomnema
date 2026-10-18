## What and why

<!-- What does this change, and which issue does it address? -->

## Checklist

- [ ] `npm run lint && npm run typecheck && npm test && npm run build` pass
- [ ] `npm run e2e` passes (Playwright against the fake core)
- [ ] `cargo fmt && cargo clippy --all-targets -- -D warnings && cargo test` pass (in `src-tauri/`)
- [ ] The matching `docs/*/ARCHITECTURE.md` section is updated, if behavior or structure changed
- [ ] `THIRD_PARTY_LICENSES.txt` is regenerated, if dependencies changed
- [ ] No version bump (the maintainer does that on merge)
