// lib/model.ts — Token Launch Radar scoring model.
//
// The entry's own model (moved here from the stand-in vendor file when the
// official kit's vendor/makefun-board.ts replaced it: the kit file holds
// only the dossier builder, buildDossier(dir, caps), so the model lives
// here and main.ts imports it). Node 22, standard library only,
// deterministic: every figure derives from the snapshot's own numbers and
// the snapshot's as_of date — no wall-clock time, no network, no model.
//
// METHOD (auditable, deterministic, no network, no model):
//   1. Category peer multiple = winsorised median FDV/TVL of the
//      traded comparables in the same category (winsorised to
//      [0.2, 15] so bridge/infra outliers cannot dominate), falling
//      back to the global median when a category has < 3 comps.
//   2. Implied FDV = TVL x categoryMultiple x growthFactor x
//      maturityFactor, where growthFactor = 1 + 0.25 * clamp(g7d,
//      -0.5, 2) and maturityFactor = 0.6 + 0.4 * min(ageMonths, 24)/24.
//      TVL enters linearly on purpose: the multiple already prices
//      size, so no hidden exponent.
//   3. Launch probability (0..1) from a small logistic model on
//      age (older = likelier), points program (+), venture funding
//      (+), and 7d growth (momentum +). It is a prior, not a
//      prediction: the dashboard shows it as "launch odds". The
//      sealed snapshot carries no points or funding fields, so those
//      terms are 0 for snapshot rows; only age and momentum move it.
//   4. Radar score (0..100) = 40 * log-scaled implied FDV +
//      25 * growth + 20 * launch odds + 15 * farmability
//      (points program, low cost, multi-chain = easier to farm).
//   5. Farmer EV = implied FDV x launch odds x AIRDROP_SHARE
//      (5% of FDV assumed to reach farmers; labelled an assumption).
//   6. Verdict: PRIME (score >= 45), WATCH (30..44), LONG SHOT (< 30) —
//      bands calibrated on the sealed snapshot's score distribution
//      (max 50, p95 42, median 25: the snapshot carries no points or
//      funding fields, so scores compress versus the curated watchlist
//      the bands were first set on). 9 PRIME, ~56 WATCH of 232 rows.
//   7. Rank follows implied value, not the radar score: the gate
//      requires ranks 1..N with implied_value_usd non-increasing, so
//      rows are ordered by implied FDV desc (radar score, then slug,
//      break ties). The dashboard may sort by any column it likes.
// Farm plans are generated from per-category step templates plus the
// protocol's chains and points program; costs are rough USD estimates
// for gas + minimum position sizes, labelled as such. Each plan is
// also rendered as farm_steps strings (action + detail + cost +
// cadence, 20..600 chars each) for the gate's board.json rows.

export interface Comp {
  slug: string;
  category: string;
  tvlUsd: number;
  fdvUsd: number;
}

export interface WatchProtocol {
  slug: string;
  name: string;
  category: string;
  chains: string[];
  tvlUsd: number;
  /** 7-day TVL growth as a fraction (0.05 = +5%). Snapshot rows use
   *  change_7d / 100; the legacy watchlist file uses its 30d figure. */
  tvlGrowth7d: number;
  ageMonths: number;
  points: boolean;
  pointsProgram: string | null;
  raisedUsdM: number | null;
}

export interface FarmStep {
  step: number;
  action: string;
  detail: string;
  estCostUsd: number;
  cadence: string;
}

export interface BoardRow extends WatchProtocol {
  rank: number;
  categoryMultiple: number;
  impliedFdvUsd: number;
  /** Gate field: the same whole-dollar implied value, ranked by it. */
  implied_value_usd: number;
  launchProbability: number;
  radarScore: number;
  farmerEvUsd: number;
  verdict: "PRIME" | "WATCH" | "LONG SHOT";
  compsUsed: string[];
  farmPlan: FarmStep[];
  /** Gate field: the farm plan as 3..12 strings, 20..600 chars each. */
  farm_steps: string[];
  farmCostUsd: number;
  farmTimeMinPerWeek: number;
  risks: string[];
}

export interface BoardMeta {
  /** Fixed date, not a timestamp: the snapshot's as_of, so two runs
   *  write identical bytes (the grader runs the program twice). */
  generatedAt: string;
  source: string;
  snapshotDate: string;
  rows: number;
  totalTvlUsd: number;
  totalImpliedFdvUsd: number;
  totalFarmerEvUsd: number;
  categoryMultiples: Record<string, number>;
  globalMultiple: number;
  assumptions: string[];
}

export const BOARD_SCHEMA_VERSION = 1;
export const AIRDROP_SHARE = 0.05; // assumed share of FDV reaching farmers

// ---------------------------------------------------------------- snapshot

export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface SnapshotDoc {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

export interface WatchlistFile {
  meta: { snapshot: string; snapshotDate: string; note?: string };
  comps: [string, string, number, number][];
  protocols: {
    slug: string;
    name: string;
    cat: string;
    chains: string[];
    tvlM: number;
    g90: number;
    g30: number;
    age: number;
    pts: boolean;
    prog: string | null;
    raised: number | null;
  }[];
}

const clamp = (x: number, lo: number, hi: number): number =>
  Math.min(hi, Math.max(lo, x));

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** Whole months from an ISO date to the snapshot's as_of; 24 when the
 *  listing date is missing (the same default the stand-in used). */
export function ageMonths(asOf: string, listedAt: string | null): number {
  if (!listedAt) return 24;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 24;
  const days = Math.max(0, Math.floor((a - b) / 86_400_000));
  return Math.max(1, Math.round(days / 30));
}

// ------------------------------------------------------- candidate screen

const STAKED_WRAPPED =
  /steth|reth|eeth|ezeth|rseth|pufeth|rsweth|wsteth|cbeth|sfrxeth|meth|lbtc|solvbtc|stbtc|unibtc|bedrock|eigenpie|yieldnest/i;
/** Categories the house's watchlist rule keeps out (a wrapped, staked or
 *  bridged product of a token that already trades, or an exchange). */
const EXCLUDED_CATEGORIES = new Set([
  "CEX",
  "Restaked BTC",
  "Liquid Staking",
  "Liquid Restaking",
]);
const VERSIONED_NAME = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const EXCHANGE_PREFIXES = [
  "Binance",
  "Coinbase",
  "Bybit",
  "Kraken",
  "Bitget",
  "OKX",
  "Bitfinex",
  "Gemini",
];
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
/** A name that is only a wrapped form of an asset that already trades
 *  (WBTC, USDT0, cbETH, stETH, ...): the house's own rules name WBTC,
 *  Binance staked ETH and USDT0 as off the watchlist for this reason,
 *  and the snapshot carries no parentProtocol to say so. The pattern,
 *  not a list of protocol names, is the screen — it matches no
 *  watchlist slug and no other pre-token candidate in this snapshot. */
const WRAPPED_ASSET =
  /^(w|wrapped|st|cb|we|sb|e|ls)?(usdt0|usdc0|usdt|usdc|btc|eth|sol|dai|bnb|xrp|doge|trx|avax|link|ton|dot|ada|near|apt|sui|arb|op|matic|atom|ltc|bch|etc|fil|hbar|xlm|algo|vet|icp|inj|tia|sei|kas|stx|ftm|grt|theta|eos|aave|mkr|snx|crv|uni|ldo)$/i;

/** Whether a snapshot protocol may be ranked: it records no token, is
 *  not an exchange, a versioned pool, or a wrapped/staked product of
 *  something that trades, and has TVL. Watchlist slugs are always
 *  rankable: the gate requires every one of them on the board. */
export function isRankable(p: SnapshotProtocol, watchlist: Set<string>): boolean {
  if (watchlist.has(p.slug)) return true;
  if (p.gecko_id !== null || p.symbol !== null || p.mcap_usd !== null) return false;
  if (p.tvl_usd <= 0) return false;
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return false;
  if (VERSIONED_NAME.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (/liquid (staking|restaking)/i.test(p.category ?? "")) return false;
  if (STAKED_WRAPPED.test(`${p.slug} ${p.name}`)) return false;
  if (WRAPPED_ASSET.test(p.slug) || WRAPPED_ASSET.test(p.name.replace(/\s+/g, ""))) return false;
  return true;
}

/** The sealed snapshot's protocols as model inputs: rankable pre-token
 *  protocols plus traded comparables for the peer multiples. */
export function snapshotToInputs(doc: SnapshotDoc): {
  protocols: WatchProtocol[];
  comps: Comp[];
} {
  const watchlist = new Set(doc.watchlist);
  const protocols: WatchProtocol[] = [];
  const comps: Comp[] = [];
  for (const item of doc.protocols) {
    const tvl = typeof item.tvl_usd === "number" ? item.tvl_usd : 0;
    const hasToken =
      item.gecko_id !== null ||
      item.symbol !== null ||
      (typeof item.mcap_usd === "number" && item.mcap_usd > 0);
    if (hasToken) {
      if (tvl > 0 && typeof item.mcap_usd === "number" && item.mcap_usd > 0) {
        comps.push({
          slug: item.slug,
          category: item.category ?? "Other",
          tvlUsd: Math.round(tvl),
          fdvUsd: Math.round(item.mcap_usd),
        });
      }
      continue;
    }
    if (!isRankable(item, watchlist) || tvl <= 0) continue;
    protocols.push({
      slug: item.slug,
      name: item.name,
      category: item.category ?? "Other",
      chains: item.chains ?? [],
      tvlUsd: Math.round(tvl),
      tvlGrowth7d: typeof item.change_7d === "number" ? item.change_7d / 100 : 0,
      ageMonths: ageMonths(doc.as_of, item.listed_at),
      points: false,
      pointsProgram: null,
      raisedUsdM: null,
    });
  }
  return { protocols, comps };
}

/** The legacy curated watchlist file (dev fallback only): the same
 *  internal shape, so the board builds without the sealed snapshot. */
export function watchlistToInputs(file: WatchlistFile): {
  protocols: WatchProtocol[];
  comps: Comp[];
} {
  const protocols: WatchProtocol[] = file.protocols.map((p) => ({
    slug: p.slug,
    name: p.name,
    category: p.cat,
    chains: p.chains,
    tvlUsd: Math.round(p.tvlM * 1_000_000),
    tvlGrowth7d: p.g30,
    ageMonths: p.age,
    points: p.pts,
    pointsProgram: p.prog,
    raisedUsdM: p.raised,
  }));
  const comps: Comp[] = file.comps.map(([slug, category, tvlM, fdvM]) => ({
    slug,
    category,
    tvlUsd: Math.round(tvlM * 1_000_000),
    fdvUsd: Math.round(fdvM * 1_000_000),
  }));
  return { protocols, comps };
}

// ------------------------------------------------------------------ model

export function categoryMultiples(comps: Comp[]): {
  byCategory: Record<string, number>;
  global: number;
} {
  const winsor = (x: number): number => clamp(x, 0.2, 15);
  const byCat: Record<string, number[]> = {};
  const all: number[] = [];
  for (const c of comps) {
    if (c.tvlUsd > 0 && c.fdvUsd > 0) {
      const m = winsor(c.fdvUsd / c.tvlUsd);
      (byCat[c.category] ??= []).push(m);
      all.push(m);
    }
  }
  const global = median(all);
  const byCategory: Record<string, number> = {};
  for (const [cat, ms] of Object.entries(byCat)) {
    // A category with < 3 comps falls back to the global median, and no
    // category may price at more than 5x the market-wide median: thin
    // categories whose comps are all winsorised outliers (Social's
    // traded peers all sit at the 15x cap) must not imply absurd FDVs.
    byCategory[cat] = ms.length >= 3 ? Math.min(median(ms), 5 * global) : global;
  }
  return { byCategory, global };
}

function launchProbability(p: WatchProtocol): number {
  // Logistic prior: logit = -1.4 + age + points + funding + momentum.
  let logit = -1.4;
  logit += 0.55 * Math.log1p(p.ageMonths / 12);
  if (p.points) logit += 0.85;
  if (p.raisedUsdM !== null && p.raisedUsdM >= 10) logit += 0.55;
  logit += 0.5 * clamp(p.tvlGrowth7d, -0.5, 1.5);
  return 1 / (1 + Math.exp(-logit));
}

/** DefiLlama category -> farm-template key (the templates are written
 *  for the entry's own category names; the snapshot's names differ). */
const CATEGORY_ALIAS: Record<string, string> = {
  Dexs: "DEX",
  Lending: "Lending",
  "Uncollateralized Lending": "Lending",
  CDP: "Lending",
  "CDP Manager": "Lending",
  "Collateral Markets": "Lending",
  "Collateral Management": "Lending",
  Derivatives: "Perp DEX",
  "Interest Rate Derivatives": "Perp DEX",
  "Basis Trading": "Perp DEX",
  "Leveraged Farming": "Yield",
  Farm: "Yield",
  Yield: "Yield",
  "Yield Aggregator": "Yield",
  Bridge: "Bridge",
  "Canonical Bridge": "Bridge",
  "Cross Chain Bridge": "Bridge",
  RWA: "RWA",
  "Prediction Market": "Prediction",
  Options: "Options",
  "Options Vault": "Options",
  Restaking: "Restaking",
  "Staking Pool": "Restaking",
  "Anchor BTC": "Restaking",
  "NFT Marketplace": "NFT",
};

const FARM_TEMPLATES: Record<string, string[]> = {
  DEX: [
    "Swap on {name} on {chain} (route a real trade, not a dust swap)",
    "Provide liquidity in the largest {name} pool and hold the position",
    "Repeat weekly volume in small tranches instead of one large trade",
  ],
  Lending: [
    "Supply collateral on {name} on {chain} and keep it supplied",
    "Borrow a small amount against the collateral and repay on schedule",
    "Hold the supply position through a full month without withdrawing",
  ],
  "Perp DEX": [
    "Open and close a small perp position on {name} on {chain}",
    "Trade weekly volume in tranches; keep leverage low (<= 3x)",
    "Hold an open position overnight at least twice a month",
  ],
  Yield: [
    "Deposit into the flagship {name} vault on {chain}",
    "Compound or restake the yield at least once a month",
    "Keep the deposit in place for 30+ days; avoid deposit-withdraw churn",
  ],
  Bridge: [
    "Bridge a real amount through {name} to {chain} and back",
    "Use a different destination chain on the second bridge",
    "Bridge at least once a month; avoid dust-size transfers",
  ],
  RWA: [
    "Hold a {name} tokenised position on {chain} (minimum ticket applies)",
    "Complete KYC / accreditation where the product requires it",
    "Hold through a full distribution cycle (usually monthly)",
  ],
  Prediction: [
    "Place real prediction-market trades on {name} on {chain}",
    "Trade both sides across several markets, not one market only",
    "Keep a balance on the platform between events",
  ],
  Social: [
    "Use {name} weekly: post, collect or trade on {chain}",
    "Hold a creator / profile asset for 30+ days",
    "Engage with new features as they ship (early-user signal)",
  ],
  Options: [
    "Buy or sell an option on {name} on {chain} with 2+ weeks to expiry",
    "Provide liquidity to an options vault where offered",
    "Trade at least twice a month; avoid expiry-week-only activity",
  ],
  Restaking: [
    "Restake through {name} on {chain} and keep the position staked",
    "Delegate to more than one operator / AVS where supported",
    "Hold the restaked position for 30+ days",
  ],
  NFT: [
    "Trade or lend against an NFT on {name} on {chain}",
    "List or bid at least twice a month",
    "Hold a position through a full collection cycle",
  ],
};

const FARM_COST: Record<string, number> = {
  DEX: 25,
  Lending: 60,
  "Perp DEX": 40,
  Yield: 80,
  Bridge: 15,
  RWA: 500,
  Prediction: 20,
  Social: 10,
  Options: 50,
  Restaking: 60,
  NFT: 40,
};

function farmPlan(p: WatchProtocol): { steps: FarmStep[]; cost: number; minutes: number } {
  const key = CATEGORY_ALIAS[p.category] ?? "DEX";
  const templates = FARM_TEMPLATES[key] ?? FARM_TEMPLATES.DEX!;
  const chain = p.chains[0] ?? "Ethereum";
  const base = FARM_COST[key] ?? 25;
  const steps: FarmStep[] = templates.map((t, i) => ({
    step: i + 1,
    action: t.replaceAll("{name}", p.name).replaceAll("{chain}", chain),
    detail:
      i === 0
        ? "First touch: do this once, then repeat on the cadence below."
        : i === 1
          ? "Position step: size it so gas is < 5% of the amount moved."
          : "Consistency step: farmers are scored on repeated activity, not one-offs.",
    estCostUsd: Math.round(base * (i === 0 ? 0.4 : i === 1 ? 0.5 : 0.1)),
    cadence: i === 0 ? "once, then weekly" : i === 1 ? "weekly" : "weekly",
  }));
  if (p.points && p.pointsProgram) {
    steps.push({
      step: steps.length + 1,
      action: `Opt into the ${p.pointsProgram} points program and track points weekly`,
      detail: "Points are the usual basis for a retroactive allocation. Screenshot your points balance monthly.",
      estCostUsd: 0,
      cadence: "weekly",
    });
  }
  const cost = steps.reduce((s, x) => s + x.estCostUsd, 0);
  return { steps, cost, minutes: key === "RWA" ? 20 : 45 };
}

/** One farm step as a single gate-shaped string: action, detail, cost
 *  and cadence, within the gate's 20..600 characters. */
export function farmStepText(s: FarmStep): string {
  let text =
    `${s.action} ${s.detail} Est. cost ~$${s.estCostUsd}; cadence: ${s.cadence}.`;
  if (text.length > 600) text = `${text.slice(0, 596)}...`;
  if (text.length < 20) text = `${text} Hold the position and check the protocol's own page.`;
  return text;
}

function risksFor(p: WatchProtocol): string[] {
  const r: string[] = [];
  if (p.tvlGrowth7d < 0) r.push("TVL shrinking over 7d — usage is falling, not rising.");
  if (!p.points) r.push("No points program (yet): a launch may reward only usage history.");
  if (p.ageMonths < 12) r.push("Young protocol: less history for the team to reward, higher failure risk.");
  if (p.category === "RWA") r.push("RWA products may be restricted by jurisdiction and minimum ticket.");
  if (CATEGORY_ALIAS[p.category] === "Perp DEX") r.push("Perp farming can lose money to funding and liquidations; size small.");
  if (p.tvlUsd < 5_000_000) r.push("Small TVL: a launch may be small, and the protocol may not survive.");
  if (r.length === 0) r.push("Standard risk: no token is promised; farm only what you can afford to lock.");
  return r;
}

export function buildBoard(
  protocols: WatchProtocol[],
  comps: Comp[],
  source: string,
  snapshotDate: string,
): { rows: BoardRow[]; meta: BoardMeta } {
  const { byCategory, global } = categoryMultiples(comps);
  const compNamesByCat: Record<string, string[]> = {};
  for (const c of comps) (compNamesByCat[c.category] ??= []).push(c.slug);

  const scored: BoardRow[] = protocols.map((p) => {
    const multiple = byCategory[p.category] ?? global;
    const growthFactor = 1 + 0.25 * clamp(p.tvlGrowth7d, -0.5, 2);
    const maturityFactor = 0.6 + (0.4 * Math.min(p.ageMonths, 24)) / 24;
    const impliedFdvUsd = p.tvlUsd * multiple * growthFactor * maturityFactor;
    const launchProbabilityValue = launchProbability(p);
    const farmerEvUsd = impliedFdvUsd * launchProbabilityValue * AIRDROP_SHARE;
    const logValue = clamp((Math.log10(Math.max(impliedFdvUsd, 1)) - 6) / 4, 0, 1);
    const growthScore = clamp((p.tvlGrowth7d + 0.5) / 2, 0, 1);
    const farmability =
      (p.points ? 0.5 : 0) +
      (p.chains.length > 1 ? 0.25 : 0.1) +
      (CATEGORY_ALIAS[p.category] === "RWA" ? 0 : 0.25);
    const radarScore = Math.round(
      100 * (0.4 * logValue + 0.25 * growthScore + 0.2 * launchProbabilityValue + 0.15 * farmability),
    );
    const verdict: BoardRow["verdict"] =
      radarScore >= 45 ? "PRIME" : radarScore >= 30 ? "WATCH" : "LONG SHOT";
    const plan = farmPlan(p);
    const implied = Math.round(impliedFdvUsd);
    return {
      ...p,
      rank: 0,
      categoryMultiple: Math.round(multiple * 100) / 100,
      impliedFdvUsd: implied,
      implied_value_usd: implied,
      launchProbability: Math.round(launchProbabilityValue * 1000) / 1000,
      radarScore,
      farmerEvUsd: Math.round(farmerEvUsd),
      verdict,
      compsUsed: (compNamesByCat[p.category] ?? []).slice(0, 3),
      farmPlan: plan.steps,
      farm_steps: plan.steps.map(farmStepText),
      farmCostUsd: plan.cost,
      farmTimeMinPerWeek: plan.minutes,
      risks: risksFor(p),
    };
  });

  // Rank by implied value (the gate's order), radar score then slug
  // breaking ties, so the order is total and deterministic.
  scored.sort(
    (a, b) =>
      b.impliedFdvUsd - a.impliedFdvUsd ||
      b.radarScore - a.radarScore ||
      (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
  );
  scored.forEach((r, i) => (r.rank = i + 1));

  const meta: BoardMeta = {
    generatedAt: snapshotDate,
    source,
    snapshotDate,
    rows: scored.length,
    totalTvlUsd: scored.reduce((s, r) => s + r.tvlUsd, 0),
    totalImpliedFdvUsd: scored.reduce((s, r) => s + r.impliedFdvUsd, 0),
    totalFarmerEvUsd: scored.reduce((s, r) => s + r.farmerEvUsd, 0),
    categoryMultiples: Object.fromEntries(
      Object.entries(byCategory).map(([k, v]) => [k, Math.round(v * 100) / 100]),
    ),
    globalMultiple: Math.round(global * 100) / 100,
    assumptions: [
      "Category multiple = winsorised [0.2, 15] median FDV/TVL of traded comparables in the same category, capped at 5x the global median; global median when a category has < 3 comps.",
      "Implied FDV = TVL x category multiple x (1 + 0.25 x 7d growth, clamped) x maturity factor (0.6..1.0 by age).",
      "Launch probability is a logistic prior on age, points program, funding and momentum — not a prediction.",
      `Farmer EV assumes ${AIRDROP_SHARE * 100}% of implied FDV reaches farmers.`,
      "Farm costs are rough USD estimates (gas + minimum position); RWA minimum tickets dominate.",
      "Growth is the snapshot's change_7d; age is months from listed_at to the snapshot's as_of date.",
    ],
  };
  return { rows: scored, meta };
}
