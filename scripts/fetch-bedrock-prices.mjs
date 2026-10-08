#!/usr/bin/env node
// AWS Price List Bulk API から Bedrock のトークン単価を取り、data/prices.json を作る
// (PRICE-001 / D-009)。認証は要らない (AC-NFR-001)。判断ロジックは scripts/lib/prices.mjs、
// ここは引数・ネットワーク・ファイル書き出しだけを持つ。
//
//   node scripts/fetch-bedrock-prices.mjs [--regions a,b] [--date YYYY-MM-DD] [--dry-run]
//   node scripts/fetch-bedrock-prices.mjs --from-raw YYYY-MM-DD
//
// --regions を省くと data/fetch-log.json の status: "ok" のリージョン全件。

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { PRICE_OFFERS, normalizePrices, priceFileUrl } from "./lib/prices.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const dataDir = join(root, "data");
const rawRoot = join(dataDir, "raw");

export const USAGE = `usage: node scripts/fetch-bedrock-prices.mjs [--regions a,b,...] [--date YYYY-MM-DD] [--dry-run]
       node scripts/fetch-bedrock-prices.mjs --from-raw YYYY-MM-DD`;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 引数解析 (純関数)。時計は読まない。
export function parsePriceArgs(argv, { defaultRegions = [], today = null } = {}) {
  const options = { regions: null, date: null, dryRun: false, fromRaw: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = (name) => {
      const value = argv[index + 1];
      if (value == null || value.startsWith("--")) throw new Error(`${name} には値が必要です`);
      index += 1;
      return value;
    };
    switch (arg) {
      case "--regions":
        options.regions = take("--regions").split(",").map((r) => r.trim()).filter(Boolean);
        break;
      case "--date":
        options.date = take("--date");
        break;
      case "--from-raw":
        options.fromRaw = take("--from-raw");
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      default:
        throw new Error(`不明な引数: ${arg}`);
    }
  }
  if (options.date && !DATE_PATTERN.test(options.date))
    throw new Error("--date は YYYY-MM-DD で指定してください");
  if (options.fromRaw && !DATE_PATTERN.test(options.fromRaw))
    throw new Error("--from-raw は YYYY-MM-DD で指定してください");
  if (options.fromRaw && options.regions)
    throw new Error("--from-raw と --regions は同時に指定できません");
  if (options.regions && options.regions.length === 0) throw new Error("--regions が空です");

  return {
    regions: options.regions ?? defaultRegions,
    date: options.fromRaw ?? options.date ?? today,
    dryRun: options.dryRun,
    fromRaw: options.fromRaw,
  };
}

// fetch-log.json で取得できているリージョンだけを価格の対象にする (AC-001)。
export function okRegions(fetchLog) {
  return Object.entries(fetchLog?.regions ?? {})
    .filter(([, entry]) => entry?.status === "ok")
    .map(([code]) => code)
    .sort();
}

export function rawName(offer, region) {
  return `prices-${offer}-${region}.json`;
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

// --- I/O -----------------------------------------------------------------

async function download({ regions, rawDir, log }) {
  mkdirSync(rawDir, { recursive: true });
  const files = {};
  for (const offer of PRICE_OFFERS) {
    files[offer] = {};
    for (const region of regions) {
      const url = priceFileUrl(offer, region);
      const response = await fetch(url);
      if (!response.ok) {
        // 1 リージョンの失敗で全体を止めない。offer にそのリージョンが無いこともある。
        log(`${offer} ${region}: HTTP ${response.status}\n`);
        continue;
      }
      const text = await response.text();
      writeFileSync(join(rawDir, rawName(offer, region)), text);
      files[offer][region] = JSON.parse(text);
      log(`${offer} ${region}: ok\n`);
    }
  }
  return files;
}

function loadRaw({ rawDir, log }) {
  if (!existsSync(rawDir)) throw new Error(`生データのディレクトリがありません: ${rawDir}`);
  const files = {};
  for (const offer of PRICE_OFFERS) {
    files[offer] = {};
    for (const region of okRegions(readJson(join(dataDir, "fetch-log.json")))) {
      const path = join(rawDir, rawName(offer, region));
      if (!existsSync(path)) continue;
      files[offer][region] = readJson(path);
      log(`${offer} ${region}: from raw\n`);
    }
  }
  return files;
}

async function main(argv) {
  const fetchLog = readJson(join(dataDir, "fetch-log.json"));
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const options = parsePriceArgs(argv, { defaultRegions: okRegions(fetchLog), today });

  const log = (text) => process.stderr.write(text);
  const rawDir = join(rawRoot, options.date);
  const files = options.fromRaw
    ? loadRaw({ rawDir, log })
    : await download({ regions: options.regions, rawDir, log });

  const models = readJson(join(dataDir, "models.json"));
  const mapPath = join(dataDir, "price-model-map.json");
  const map = existsSync(mapPath) ? readJson(mapPath) : {};

  const { prices, unmappedList } = normalizePrices({
    files,
    models,
    map,
    generatedAt: new Date().toISOString(),
  });

  // 未マッピングの SKU はメンテナが地図を足すための材料。生データ側に残す (AC-006)。
  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, "prices-unmapped.json"), serialize(unmappedList));

  if (!options.dryRun) writeFileSync(join(dataDir, "prices.json"), serialize(prices));

  const modelCount = Object.keys(prices.byModel).length;
  log(`\nmodels with a price: ${modelCount}\n`);
  log(`unmapped names: ${prices.unmapped} (data/raw/${options.date}/prices-unmapped.json)\n`);
  log(`out of scope SKUs: ${prices.outOfScope} / ignored: ${prices.ignored}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    process.exitCode = 1;
  });
}
