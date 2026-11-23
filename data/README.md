# data/

- `snapshot.json` — the sealed DefiLlama snapshot from the official
  make.fun kit (copied from the kit's `input/snapshot.json`, sha256
  `42a71213519479f3a180cc5010cbbf6bd18a2447fa0ad29e4c5122b6c9184393`):
  `as_of` 2026-11-14, `source` "DefiLlama
  https://api.llama.fi/protocols, fetched 2026-11-14T01:18:33.201Z",
  `floor_usd` 50,000,000, 758 protocols, watchlist 40. Each protocol
  carries exactly ten fields: `slug`, `name`, `category`, `chains`,
  `tvl_usd`, `change_7d` (per cent), `mcap_usd`, `listed_at` (ISO date),
  `gecko_id`, `symbol`. `main.ts` reads this copy locally; at grade
  time it reads the same bytes from `/input/snapshot.json`.
  The snapshot is read-only; the board never writes back to it.
- `watchlist.json` — curated stand-in watchlist (120 pre-token
  protocols) plus traded comparables, from the first build session.
  Used only when no snapshot is present. Figures are approximate
  public DefiLlama figures (Nov 2026); see `TEST_REPORT.md`.
  The fallback is only for local development.
