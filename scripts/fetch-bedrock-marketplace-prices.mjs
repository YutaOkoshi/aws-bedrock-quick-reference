#!/usr/bin/env node
// Price List に無いモデルの単価を AWS Marketplace の offer から取り、data/marketplace-prices.json を作る (D-018)。
// Bedrock の ListFoundationModelAgreementOffers を models.json の全モデルに呼ぶ。認証が要るので
// 手元の SSO で手動実行する (D-002。CI では走らせない)。判断ロジックは scripts/lib/marketplace-prices.mjs。
//
//   node scripts/fetch-bedrock-marketplace-prices.mjs --profile <名前> [--region us-east-1] [--date YYYY-MM-DD]
//   node scripts/fetch-bedrock-marketplace-prices.mjs --from-raw YYYY-MM-DD
//
// 書き出した後に node scripts/fetch-bedrock-prices.mjs --from-raw <日付> を走らせると prices.json に反映される。

import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRunner, listAgreementOffers } from "./lib/aws-cli.mjs";
import { normalizeMarketplaceOffers } from "./lib/marketplace-prices.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const dataDir = join(here, "..", "data");
const rawRoot = join(dataDir, "raw");

export const USAGE = `usage: node scripts/fetch-bedrock-marketplace-prices.mjs --profile <name> [--region us-east-1] [--date YYYY-MM-DD]
       node scripts/fetch-bedrock-marketplace-prices.mjs --from-raw YYYY-MM-DD`;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

// 引数解析 (純関数)。時計は読まない。
export function parseMarketplaceArgs(argv, { today = null } = {}) {
  const options = { profile: null, region: "us-east-1", date: null, fromRaw: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = () => {
      const value = argv[index + 1];
      if (value == null || value.startsWith("--")) throw new Error(`${arg} には値が必要です`);
      index += 1;
      return value;
    };
    if (arg === "--profile") options.profile = take();
    else if (arg === "--region") options.region = take();
    else if (arg === "--date") options.date = take();
    else if (arg === "--from-raw") options.fromRaw = take();
    else throw new Error(`不明な引数: ${arg}`);
  }
  for (const key of ["date", "fromRaw"]) {
    if (options[key] && !DATE_PATTERN.test(options[key])) throw new Error(`--${key === "fromRaw" ? "from-raw" : "date"} は YYYY-MM-DD で指定してください`);
  }
  if (!options.fromRaw && !options.profile) throw new Error("--profile が必要です (--from-raw のときは不要)");
  return { ...options, date: options.fromRaw ?? options.date ?? today };
}

// 生データのファイル名。モデル ID の ":" はそのまま使える (macOS / Linux)。
export function rawName(modelId) {
  return `marketplace-${modelId}.json`;
}

const serialize = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

function main(argv) {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const options = parseMarketplaceArgs(argv, { today });
  const log = (text) => process.stderr.write(text);
  const models = readJson(join(dataDir, "models.json"));
  const rawDir = join(rawRoot, options.date, "marketplace");
  const rawByModel = {};

  if (options.fromRaw) {
    if (!existsSync(rawDir)) throw new Error(`生データのディレクトリがありません: ${rawDir}`);
    for (const name of readdirSync(rawDir)) {
      const match = /^marketplace-(.+)\.json$/.exec(name);
      if (match) rawByModel[match[1]] = readJson(join(rawDir, name));
    }
  } else {
    mkdirSync(rawDir, { recursive: true });
    let notSupported = 0;
    for (const modelId of Object.keys(models).sort()) {
      const result = listAgreementOffers(defaultRunner, { profile: options.profile, region: options.region, modelId });
      if (result.ok) {
        writeFileSync(join(rawDir, rawName(modelId)), result.raw);
        rawByModel[modelId] = result.json;
      } else if (result.notSupported) {
        notSupported += 1;
      } else {
        // 認証切れなどの失敗。原文は生データ側にだけ残す (D-008)。
        writeFileSync(join(rawDir, `marketplace-${modelId}.err`), result.stderr ?? "");
        log(`${modelId}: failed (see data/raw/${options.date}/marketplace/)\n`);
      }
    }
    log(`offers: ${Object.keys(rawByModel).length} / not on Marketplace: ${notSupported}\n`);
  }

  const { byModel, unmatchedImages } = normalizeMarketplaceOffers(rawByModel, models);
  const generatedAt = new Date().toISOString();
  writeFileSync(
    join(dataDir, "marketplace-prices.json"),
    serialize({
      fetchedAt: options.fromRaw && existsSync(join(dataDir, "marketplace-prices.json"))
        ? readJson(join(dataDir, "marketplace-prices.json")).fetchedAt ?? generatedAt
        : generatedAt,
      source: "bedrock:ListFoundationModelAgreementOffers",
      unmatchedImages,
      byModel,
    }),
  );
  log(`models with an offer price: ${Object.keys(byModel).length} / unmatched image dimensions: ${unmatchedImages.length}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    main(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    process.exitCode = 1;
  }
}
