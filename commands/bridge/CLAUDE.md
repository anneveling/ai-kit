# bridge: notes for Claude

- Node ≥ 22.18 runs the `.ts` files directly. Keep to erasable syntax: no `enum`, `namespace` or parameter properties (`tsc` enforces it). Import with the `.ts` extension.
- No runtime dependencies. `web/` is plain JS (the browser doesn't run TS).
- Pure units (`topics`, `urgency`, `clock`, `briefing`, `view`, later `rules/*`) take `now` and config as input; test them first with `node --test`.
- The repo is public: fixtures and demo data are made up (acme, Sam, Toby, Maya, Wren, Jo).
- Never claim someone is reviewing: GitHub can't tell. Say "with Toby for review".
- Labels are fixed on every screen: **Make it so** (the officer does it in the background) and **Take the helm** (you open Claude yourself).
- Check a UI change with `npm run demo` (or the `bridge-demo` launch config) and `node scripts/screenshot.ts`.
