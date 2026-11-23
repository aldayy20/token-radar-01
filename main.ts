// main.ts — Token Launch Radar (make.fun bounty token-radar-01).
// Node 22, no dependencies, no network. The kit's interface, as the
// starter's main.ts does it:
//   node main.ts [--input <snapshot.json|dir>] [--output <dir>]
//   MAKEFUN_OUTPUT_DIR=out node main.ts --input data/snapshot.json
// Reads the sealed snapshot at /input/snapshot.json (or --input, or the
// kit copy at data/snapshot.json, or the legacy data/watchlist.json),
// scores every rankable pre-token protocol with lib/model.ts, and writes
// to the output directory:
//   board.json      the ranked board ({meta, rows}, gate-shaped rows)
//   data.js         window.TOKEN_RADAR_BOARD for the dashboard page
//   dashboard/      a copy of this repo's dashboard/ (the static page)
//   screenshots/    a copy of this repo's screenshots/ (3 images)
//   dossier.json    buildDossier(output, caps) from the kit's
//                   vendor/makefun-board.ts, byte for byte the scorer's.
// Deterministic: dates come from the snapshot's as_of, never the clock,
// so two runs write identical bytes. Exit code 1 when validation fails.

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  buildBoard,
  snapshotToInputs,
  watchlistToInputs,
  type BoardRow,
  type SnapshotDoc,
  type WatchlistFile,
} from "./lib/model.ts";
import { buildDossier } from "./vendor/makefun-board.ts";

const ROOT = dirname(fileURLToPath(import.meta.url));

const TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASHBOARD_CAPS = { max_files: 400, max_bytes: 4_194_304 };

/** --name <value> out of the arguments, or the fallback. */
function arg(name: string, fallback: string): string {
  const at = process.argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < process.argv.length) return process.argv[at + 1]!;
  const withEquals = process.argv.find((a) => a.startsWith(`--${name}=`));
  return withEquals === undefined ? fallback : withEquals.slice(name.length + 3);
}

function fail(msg: string): never {
  console.error(`main.ts: FAIL: ${msg}`);
  process.exit(1);
}

function parseSnapshot(text: string): SnapshotDoc {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    fail("snapshot is not JSON");
  }
  const o = raw as Record<string, unknown>;
  if (typeof o !== "object" || o === null || Array.isArray(o)) fail("snapshot is not an object");
  if (typeof o.as_of !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    fail("snapshot has no as_of date");
  }
  if (typeof o.source !== "string") fail("snapshot has no source");
  if (typeof o.floor_usd !== "number" || o.floor_usd <= 0) fail("snapshot has no floor_usd");
  if (!Array.isArray(o.protocols)) fail("snapshot has no protocols array");
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== "string")) {
    fail("snapshot has no watchlist of slugs");
  }
  return o as unknown as SnapshotDoc;
}

/** Copy a directory's regular files into `to`, skipping dot-names. */
function copyFiles(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from)) {
    if (name.startsWith(".")) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

/** The gate's own rules, checked locally before the dossier is built. */
function validateBoard(
  rows: BoardRow[],
  snapshot: SnapshotDoc | null,
): void {
  if (rows.length < 100) fail(`board has ${rows.length} rows, need at least 100`);
  if (rows.length > 4000) fail(`board has ${rows.length} rows, at most 4000`);
  const slugs = new Set<string>();
  const known = snapshot === null ? null : new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of rows) {
    if (slugs.has(r.slug)) fail(`duplicate slug ${r.slug}`);
    slugs.add(r.slug);
    if (known !== null && !known.has(r.slug)) fail(`${r.slug} is not one of the snapshot's protocols`);
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) {
      fail(`${r.slug}: no implied value`);
    }
    if (r.implied_value_usd > 100_000_000_000_000) fail(`${r.slug}: implied value over the cap`);
    if (!Array.isArray(r.farm_steps) || r.farm_steps.length < 3 || r.farm_steps.length > 12) {
      fail(`${r.slug}: farm_steps has ${r.farm_steps?.length ?? 0} strings, need 3..12`);
    }
    for (const s of r.farm_steps) {
      if (typeof s !== "string" || s.trim().length < 20 || s.trim().length > 600) {
        fail(`${r.slug}: a farm step is ${s?.trim().length ?? 0} chars, need 20..600`);
      }
    }
    if (!r.farmPlan || r.farmPlan.length < 3) fail(`${r.slug}: no farm plan`);
    if (!(r.radarScore >= 0 && r.radarScore <= 100)) fail(`${r.slug}: bad radar score`);
  }
  const ranks = rows.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) fail(`rank ${i + 1} is ${ranks[i]}`);
  }
  for (let i = 1; i < rows.length; i++) {
    if (rows[i]!.implied_value_usd > rows[i - 1]!.implied_value_usd) {
      fail(`row ${i + 1} outranks row ${i} on implied value`);
    }
  }
  if (rows.length >= 2 && rows[0]!.implied_value_usd === rows[rows.length - 1]!.implied_value_usd) {
    fail("all rows share the same implied value: not a ranking");
  }
  if (snapshot !== null) {
    const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
    if (missing.length > 0) fail(`board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(", ")}`);
  }
}

function main(): void {
  // ---- input: --input, then the grader's /input, then the kit copy
  // in data/, then the legacy curated watchlist (dev fallback only). ----
  const inputArg = arg("input", "");
  const inputFile =
    inputArg !== ""
      ? inputArg.endsWith(".json")
        ? inputArg
        : join(inputArg, "snapshot.json")
      : existsSync("/input/snapshot.json")
        ? "/input/snapshot.json"
        : join(ROOT, "data", "snapshot.json");
  const watchlistPath = join(ROOT, "data", "watchlist.json");

  let protocols;
  let comps;
  let source: string;
  let snapshotDate: string;
  let snapshot: SnapshotDoc | null = null;
  if (existsSync(inputFile)) {
    snapshot = parseSnapshot(readFileSync(inputFile, "utf8"));
    ({ protocols, comps } = snapshotToInputs(snapshot));
    source = `sealed DefiLlama snapshot (${snapshot.source})`;
    snapshotDate = snapshot.as_of;
    console.log(
      `main.ts: using sealed snapshot ${inputFile}: ${protocols.length} rankable pre-token, ${comps.length} traded comps, watchlist ${snapshot.watchlist.length}`,
    );
  } else if (existsSync(watchlistPath)) {
    const file = JSON.parse(readFileSync(watchlistPath, "utf8")) as WatchlistFile;
    ({ protocols, comps } = watchlistToInputs(file));
    source = "curated watchlist (data/watchlist.json) — STAND-IN until the kit snapshot lands";
    snapshotDate = file.meta.snapshotDate;
    console.log(
      `main.ts: no snapshot at ${inputFile}; using curated watchlist: ${protocols.length} rows, ${comps.length} comps`,
    );
  } else {
    fail(`no snapshot at ${inputFile} and no ${watchlistPath}: pass --input <snapshot.json|directory>`);
  }

  const { rows, meta } = buildBoard(protocols, comps, source, snapshotDate);
  validateBoard(rows, snapshot);

  // ---- output: --output, then MAKEFUN_OUTPUT_DIR, then /output. ----
  const out = arg("output", process.env.MAKEFUN_OUTPUT_DIR ?? "/output");
  mkdirSync(out, { recursive: true });
  const boardJson = JSON.stringify({ meta, rows }, null, 2) + "\n";
  const dataJs =
    `// Generated by main.ts — do not hand-edit. Regenerate with: node main.ts\n` +
    `window.TOKEN_RADAR_BOARD = ${JSON.stringify({ meta, rows })};\n`;
  writeFileSync(join(out, "board.json"), boardJson);
  writeFileSync(join(out, "data.js"), dataJs);
  const dash = copyFiles(join(ROOT, "dashboard"), join(out, "dashboard"));
  const shots = copyFiles(join(ROOT, "screenshots"), join(out, "screenshots"));
  if (dash.length === 0) fail("dashboard/ holds no files to copy");
  if (shots.length < 3) {
    fail(`screenshots/ holds ${shots.length} images: hand in 3, the board, a detail view and a filtered view`);
  }
  // The dossier is written last: the scorer rebuilds it from this
  // output directory and compares bytes.
  const dossier = buildDossier(out, {
    text_max_bytes: TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_CAPS,
    dashboard: DASHBOARD_CAPS,
  });
  writeFileSync(join(out, "dossier.json"), dossier);

  const top = rows[0]!;
  console.log(`main.ts: OK — ${rows.length} rows, ${meta.totalTvlUsd.toLocaleString("en-US")} USD TVL`);
  console.log(
    `main.ts: total implied FDV $${(meta.totalImpliedFdvUsd / 1e9).toFixed(2)}B, ` +
      `farmer EV $${(meta.totalFarmerEvUsd / 1e6).toFixed(1)}M, global multiple ${meta.globalMultiple}x`,
  );
  console.log(
    `main.ts: #1 ${top.name} (${top.category}) — radar ${top.radarScore}, ` +
      `implied FDV $${(top.impliedFdvUsd / 1e6).toFixed(0)}M, launch odds ${(top.launchProbability * 100).toFixed(0)}%`,
  );
  console.log(
    `main.ts: wrote ${join(out, "board.json")}, ${join(out, "data.js")}, ` +
      `${join(out, "dashboard")} (${dash.length} files), ${join(out, "screenshots")} (${shots.length} images), ` +
      `${join(out, "dossier.json")} (${dossier.length} bytes)`,
  );
}

main();
