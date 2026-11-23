# TEST_REPORT — token-radar-01

Date: 2026-11-23. Tester: the agent that built the entry (local run only; no submission made).

## Environment

- Node.js v24.22.1 (requirement: 22.18+, met)
- No system browser was present in this VM, so rendering was checked with a headless Chromium (Chrome Headless Shell 159.0.8154.6, installed via `npx playwright install chromium-headless-shell` + `playwright-core` in /tmp/shot). The bounty expects the agent to open the dashboard in a browser and take the three screenshots — that is exactly what the headless run below does, via /tmp/shot/shot.mjs.
- No kit was available in this session (see § Limitations).

## 1. `node main.ts` — build

Command: `cd ~/workspace/token-radar-01 && node main.ts`

Result: PASS, exit 0.

```text
main.ts: no data/snapshot.json; using curated watchlist: 120 rows, 127 comps
main.ts: OK — 120 rows, 11,422,500,000 USD TVL
main.ts: total implied FDV $15.14B, farmer EV $388.1M, global multiple 1.37x
main.ts: #1 Lighter (Perp DEX) — radar 75, implied FDV $1238M, launch odds 74%
main.ts: wrote board.json, dossier.json, dashboard/data.js, dashboard/board.json, out/*
```

Built-in validation in main.ts (exit 1 on failure) checks: ≥ 100 rows, board
covers the whole watchlist, unique slugs, every row has an implied value
> 0 and a farm plan of ≥ 3 steps, radar scores in 0–100, rows ranked by
radar score. All passed.

## 2. Output integrity

- `board.json`, `dossier.json`, `data/watchlist.json`, `dashboard/board.json`: all valid JSON.
- board rows: 120; dossier rows: 120; board rows identical to dossier rows.
- All rows have farmPlan ≥ 3 steps; all impliedFdvUsd > 0; 120 unique slugs; rank order correct (rank = position, sorted by radar score desc).
- Verdicts: 8 PRIME (≥ 60), 29 WATCH (45–59), 83 LONG SHOT (< 45).
- Category multiples: DEX 1.33×, Lending 0.37×, Perp DEX 1.96×, Yield 0.49×, Bridge 2.07×, RWA 1.25×, Prediction 1.37×, Social 6.84× (capped at 5× global), Options 1.37×, Restaking 1.37×, NFT 1.37×; global 1.37×.
- Top 5: Lighter 75, Polymarket 70, Backpack 68, Meteora 65, Symbiotic 64.

## 3. Dashboard render (headless Chromium, file://, no network)

Script: /tmp/shot/shot.mjs — loads each URL, waits for `#board-body tr`,
asserts state, takes a full-page screenshot. Result: ALL CHECKS PASSED.

| Shot | URL state | Result |
| --- | --- | --- |
| board | `dashboard/index.html` | 120 rows, 3 SVG charts, "120 of 120 shown", no console errors, no non-file:// requests |
| detail | `…/index.html#protocol=lighter` | Detail open: "#1 · Lighter", metrics + pricing math + risks + 4-step farm plan |
| filtered | `…/index.html#cat=Perp%20DEX` | Category filter applied, 11 of 120 shown |

Screenshots were visually inspected (filtered + detail): dark radar theme,
top-10 bars, category multiples, TVL-vs-FDV scatter, filter bar, verdict
chips and the "How it works" section all render correctly. Launch odds now
show as plain percentages (74%, not +74%).

## 4. Offline / no-network check

The render script records every request: zero non-`file://` requests on all
three pages. `dashboard/app.js` and `dashboard/styles.css` contain no
external URLs; the only `https://` strings in `index.html` are outbound
links (make.fun bounty, DefiLlama protocol page, GitHub repo) — they load
nothing. No CDN, no fonts, no analytics.

## 5. Secret / key scan

`grep -rInE` for provider keys (`sk-ant-`, `sk-proj-`, `sk-or-v1-`, `AIza`),
`af_` API keys, `PRIVATE KEY`, and `api_key = "…"` patterns across the repo
(excluding `out/`): **no hits**. No credential is committed anywhere.

## 6. Repo size

Total repo excluding `out/`: 4,368,845 bytes (~4.2 MB), of which screenshots
are ~3.5 MB. Largest code/data file: `dossier.json` 217 KB. The requirements
set no entry size cap for this bounty (`entry_size` check: applies false),
so this is within the rules; if a cap appears, drop `out/` first (it is a
regenerable build copy).

## 7. Kit local grader

Not run: no token-radar-01 kit was obtained in this session, and the
tiny-chess-01 kit's `check`/`grade-local` commands are bound to that
competition. There is no local grader to run without the official kit.
The parent must download the kit and run its `check` before submitting.

## Reproduce

```sh
cd ~/workspace/token-radar-01
MAKEFUN_OUTPUT_DIR=out node main.ts --input data/snapshot.json   # rebuild out/*
node /tmp/cdp-shot.mjs 9223 "file://$PWD/out/dashboard/index.html" /tmp/cap-board.jpg "document.querySelector('.controls').scrollIntoView()"   # with a headless shell on :9223
```

Screenshot dimensions (1440×900 viewport JPEGs): board 1440×900,
detail 1440×900, filtered 1440×900.

## Official-kit rebuild — 2026-11-23

The official kit was downloaded (level 38) and the entry was rebuilt on
it; limitations 1, 4 and the screenshot sizes from the first build are
resolved. What changed and what was verified:

- **Kit vendor.** `vendor/makefun-board.ts` is now the kit's file byte
  for byte (19,788 B, sha256
  `9ca51b6e5cd84fe46cb0efa61e2ea99365a1fb0e21f2b75e6007f977f0dc326e`,
  matching kit.json). The stand-in's model moved to `lib/model.ts`
  (same multiples / implied FDV / odds / radar score / farm plans,
  adapted below); `main.ts` was rewritten to the kit's interface
  (`/input/snapshot.json` → `/output`, `buildDossier(out, caps)`).
- **Sealed snapshot.** `data/snapshot.json` is the kit's
  `input/snapshot.json` (247,940 B, sha256
  `42a71213519479f3a180cc5010cbbf6bd18a2447fa0ad29e4c5122b6c9184393`):
  as_of 2026-11-14, 758 protocols, watchlist 40, floor $50,000,000.
  The old `fromSnapshot` read the wrong field names (`tvl`, `mcap`,
  `listedAt` as epoch) and would have scored zero rows on the real
  shape; it now reads `tvl_usd`, `change_7d` (per cent), `mcap_usd`,
  `listed_at` (ISO date), `gecko_id`, `symbol`, with age in months
  from `listed_at` to `as_of` (no wall-clock time anywhere, so runs
  are byte-identical).
- **Board.** 232 rankable pre-token rows (342 pre-token in the
  snapshot; out go CEX / Restaked BTC / Liquid Staking / Liquid
  Restaking, versioned names, exchange-prefixed names, wrapped/staked
  words, LST/LRT tickers, and names that are only a wrapped form of an
  asset that already trades — the pattern removes exactly WBTC and
  USDT0, the two the kit's README names as off the watchlist, and no
  watchlist slug). Watchlist coverage 40/40. Comps: 128 traded
  protocols. Totals: $29.49B TVL, $9.40B implied FDV, $134.5M farmer
  EV, global multiple 0.21×. Top 5 by implied FDV: Base Bridge
  $2.02B, CCIP $745M, Steakhouse Financial $527M, Sentora Curator
  $494M, Unit $468M. Ranks follow implied value (the gate's order),
  radar score then slug breaking ties. Verdict bands recalibrated on
  this snapshot's scores (max 50, median 25): PRIME ≥ 45 (9 rows),
  WATCH 30–44, LONG SHOT &lt; 30 — the old bands (60/45) left zero
  PRIME rows because the snapshot carries no points/funding fields.
- **Gate-shaped rows.** Each row now carries `implied_value_usd`
  (= implied FDV) and `farm_steps` (3 strings, 143–198 chars each)
  beside the dashboard's own fields; `board.json` is 542,848 B.
- **Determinism.** Two runs of
  `MAKEFUN_OUTPUT_DIR=out node main.ts --input data/snapshot.json`
  produce byte-identical `board.json`, `data.js`, `dossier.json`
  (sha256 compared); the grader-shape run (`--input … --output …`)
  produces identical bytes too.
- **Local gate check (all 7 rows PASS).** Replicated against `out/`:
  dashboard_files (3 files, 28,708 B, no `http(s)` in any HTML
  attribute, CSS file or JS import — the four `https://` links the
  first build's dashboard carried were removed; the DefiLlama
  reference is plain text now); board_file (232 rows, no invented
  slugs); sorted_by_value (ranks 1–232, implied $2,015,841,095 →
  $662,768); coverage (40/40); farm_steps (all 3–12 strings,
  20–600 chars); screenshots (3 JPEGs, 1440×900, 115–155 KB each);
  dossier_matches (`dossier.json`, 596,669 B, byte-identical to a
  fresh `buildDossier(out, {text_max_bytes: 65536})` call; dossier
  text 28,981 B with no cut — all three dashboard files shown whole).
- **Screenshots.** Re-taken as 1440×900 viewport JPEGs from `out/`
  with a headless Chromium (Chrome Headless Shell 159.0.8154.6 from
  the Playwright cache; `/opt/meta-chromium/chrome` refuses to start
  here — "Hatch WebGL domain policy is required"): board (filter
  bar + table, ranks 1–12), detail (`#protocol=base-bridge`, title,
  metrics, pricing math, risks, 3-step farm plan), filtered
  (`#cat=Dexs`, "21 of 232 shown"). The old full-page PNGs violated
  the gate (long sides 8,770 / 9,504 / 1,714 px, two over 512 KiB);
  the new shots are 118,689 / 155,676 / 149,970 B. Visually
  inspected: all three render correctly. Note: the detail shot
  needed a −120 px scroll offset because the sticky filter bar
  covers the detail title otherwise.
- **Dashboard layout.** `data.js` now lives at the output root
  (beside the page, as the starter does), not inside `dashboard/`,
  so the dossier text shows the page's real source instead of being
  eaten by 360 KB of generated data. The page loads `../data.js`
  (fallback fetch `../board.json`).

## Limitations (remaining)

1. **LICENSE written once.** The MIT LICENSE is verbatim boilerplate (no
   authored code lines); it was written in a single message. Every other
   repo file was written once and revised in a later message.
2. **Generated files.** `out/board.json`, `out/data.js`,
   `out/dossier.json` and `out/dashboard/*` are outputs of
   `node main.ts`, not hand-written; their provenance is the
   `node main.ts` command in the build transcript, which regenerates
   them deterministically (verified byte-identical across runs).
3. Screenshots are viewport captures from a headless shell, not a headed
   desktop browser; retake them in a headed browser if the judge prefers
   headed-browser shots. (The old full-page PNGs, which violated the
   gate's 1440 px long-side and 512 KiB caps, are replaced.)
4. No kit `check` has been run yet: there is no repo to point it at
   until the parent publishes one. Run the kit's
   `node cli/makefun.mjs check` on the published commit + bundle
   before submitting.
