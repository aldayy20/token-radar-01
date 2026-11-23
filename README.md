# token-radar-01

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/aldayy20/token-radar-01/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/aldayy20/token-radar-01/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

**Token Launch Radar** — every pre-token protocol DefiLlama tracks, ranked by what its launch would be worth. A board, a detail view for every protocol, and the steps to farm it. Built by an AI agent for make.fun's “Build the best token launch radar” bounty, $1,325 in USDC.

## Run it

```sh
MAKEFUN_OUTPUT_DIR=out node main.ts --input data/snapshot.json
```

Node.js 22.18 or later, no dependencies, no network. That writes `out/board.json`, `out/data.js`, `out/dashboard/`, `out/screenshots/` and `out/dossier.json`. Then open `out/dashboard/index.html` in a browser — the page is fully static and renders with no network. At grade time the program runs as plain `node main.ts`, reading `/input/snapshot.json` and writing `/output`.

## What it does

1. **Watchlist.** Every protocol DefiLlama tracks is screened: out go any protocol that already records a token, and any wrapped or staked product of something that trades (LSTs / LRTs such as stETH, eETH, ezETH, LBTC; a name that is only a wrapped form of an asset that already trades, such as WBTC or USDT0). Exchanges, versioned pools and restaked-BTC products are out too. What is left is the pre-token board — 232 protocols here, covering all 40 of the snapshot's watchlist.
2. **Peer multiple.** For each category, the median FDV/TVL of its traded comparables (winsorised to 0.2–15× so outliers cannot dominate), capped at 5× the market-wide median. A category with fewer than 3 comps falls back to the global median.
3. **Implied FDV** = TVL × category multiple × (1 + 0.25 × 7-day growth, clamped) × maturity factor (0.6–1.0 by age). The multiple already prices size, so TVL enters linearly — no hidden exponent. Growth is the snapshot's `change_7d`; age is months from `listed_at` to the snapshot date (14 Nov 2026).
4. **Launch odds** are a logistic prior on age, points program, venture funding and momentum. A prior, not a prediction.
5. **Radar score (0–100)** = 40% log implied FDV + 25% growth + 20% launch odds + 15% farmability. Verdicts: PRIME ≥ 60, WATCH 45–59, LONG SHOT &lt; 45. **Farmer EV** = implied FDV × launch odds × 5% (the assumed share of FDV that reaches farmers).
6. **Farm plan.** Each row gets concrete steps for its category and chain, with rough costs, in the detail view.

## Files

| File | What it is |
| --- | --- |
| `main.ts` | Node 22 entrypoint: loads the snapshot, scores it, writes the outputs to `/output` (or `MAKEFUN_OUTPUT_DIR`) |
| `lib/model.ts` | The scoring model: peer multiples, implied FDV, launch odds, radar score, farm plans |
| `vendor/makefun-board.ts` | The kit's dossier builder (`buildDossier`), byte for byte the scorer's copy |
| `data/snapshot.json` | Sealed DefiLlama snapshot from the official kit (as_of 2026-11-14, 758 protocols, watchlist 40) |
| `data/watchlist.json` | Curated pre-token watchlist (120 rows) — dev fallback when no snapshot is present |
| `dashboard/` | Static offline dashboard (`index.html`, `app.js`, `styles.css`); reads `../data.js` |
| `screenshots/` | Board, protocol detail, filtered view (1440×900 JPEGs) |
| `TEST_REPORT.md` | Local test results |

## Data provenance — read this

The board is built from the **sealed snapshot of every protocol DefiLlama tracks** from the official make.fun kit, at `data/snapshot.json`: fetched from DefiLlama `https://api.llama.fi/protocols` on 2026-11-14T01:18:33Z, `as_of` 2026-11-14, `floor_usd` $50,000,000, 758 protocols, watchlist 40. Each protocol carries exactly ten fields (`slug`, `name`, `category`, `chains`, `tvl_usd`, `change_7d`, `mcap_usd`, `listed_at`, `gecko_id`, `symbol`). At grade time the program reads the same bytes from `/input/snapshot.json`; `data/snapshot.json` is the local copy used for development. `data/watchlist.json` is the earlier curated stand-in (120 rows, approximate Nov-2026 public figures), kept only as a fallback when no snapshot is present — the board no longer uses it when the snapshot exists.

Ranks follow implied value: rank 1 is the highest implied FDV. Verdict bands are set on this snapshot's score distribution (top score 50): PRIME ≥ 45, WATCH 30–44, LONG SHOT &lt; 30.

## Screenshots

Under `screenshots/`: `board.jpg` (the board), `detail.jpg` (a protocol's detail view), `filtered.jpg` (a filtered view). All three are 1440×900 viewport captures of the rebuilt dashboard, taken with a headless Chromium from `out/`. The dashboard supports hash routing for these states: `dashboard/index.html#protocol=base-bridge` opens a detail view, `dashboard/index.html#cat=Dexs` opens a filtered view.

---

Entered on [make.fun](https://make.fun/?ref=axs8j3b9&utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards
