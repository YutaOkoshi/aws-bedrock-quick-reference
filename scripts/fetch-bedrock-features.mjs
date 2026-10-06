#!/usr/bin/env node
// 公式 docs (英語版) のモデルカード .md から Capabilities and Features を取り、data/features.json を作る
// (FEATURE-001 / D-015)。認証は要らない。判断ロジックは scripts/lib/features.mjs、
// ここは引数・ネットワーク・ファイル書き出しだけを持つ。
//
//   node scripts/fetch-bedrock-features.mjs [--date YYYY-MM-DD] [--dry-run]
//   node scripts/fetch-bedrock-features.mjs --from-raw YYYY-MM-DD

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { TOC_URL, cardMarkdownUrl, listModelCards, normalizeFeatures } from "./lib/features.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const defaultDataDir = join(root, "data");

export const USAGE = `usage: node scripts/fetch-bedrock-features.mjs [--date YYYY-MM-DD] [--dry-run]
       node scripts/fetch-bedrock-features.mjs --from-raw YYYY-MM-DD`;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const CONCURRENCY = 4;
const REQUEST_HEADERS = {
  "Accept-Language": "en-US",
  "User-Agent": "aws-bedrock-quick-reference (+https://github.com/koyakimu/aws-bedrock-quick-reference)",
};

// 引数解析 (純関数)。時計は読まない。
export function parseFeatureArgs(argv, { today = null } = {}) {
  const options = { date: null, dryRun: false, fromRaw: null };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const take = (name) => {
      const value = argv[index + 1];
      if (value == null || value.startsWith("--")) throw new Error(`${name} には値が必要です`);
      index += 1;
      return value;
    };
    switch (arg) {
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
  if (options.fromRaw && options.date)
    throw new Error("--from-raw と --date は同時に指定できません");

  return {
    date: options.fromRaw ?? options.date ?? today,
    dryRun: options.dryRun,
    fromRaw: options.fromRaw,
  };
}

export function rawCardName(card) {
  return card.replace(/\.html$/, ".md");
}

function serialize(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function readJsonIfExists(path, fallback) {
  return existsSync(path) ? readJson(path) : fallback;
}

// 正規化して書き出す。summary.md は常に raw に書き、安全弁が働いたら data/features.json は書かない。
function buildAndWrite({ cards, rawDir, dataDir, generatedAt, dryRun, log }) {
  const previousPath = join(dataDir, "features.json");
  const result = normalizeFeatures({
    cards,
    models: readJson(join(dataDir, "models.json")),
    names: readJson(join(dataDir, "feature-names.json")),
    map: readJsonIfExists(join(dataDir, "feature-model-map.json"), {}),
    previous: readJsonIfExists(previousPath, null),
    generatedAt,
  });

  mkdirSync(rawDir, { recursive: true });
  writeFileSync(join(rawDir, "summary.md"), result.summary);

  const { features } = result;
  log(
    `\ncards: ${features.cards} / with features: ${features.cardsWithFeatures} / failed: ${features.failedCards}` +
      ` / unmatched: ${features.unmatchedCards.length} / unknown: ${features.unknownFeatures.length}\n`,
  );

  if (result.guardTripped) {
    const previous = readJson(previousPath);
    log(
      `安全弁: cardsWithFeatures が ${features.cardsWithFeatures} で、前回の ${previous.cardsWithFeatures} の半分未満。` +
        `docs の書式が変わった可能性があるので data/features.json を書きません (FEATURE-001 AC-008)\n`,
    );
    return result;
  }
  if (!dryRun) writeFileSync(previousPath, serialize(features));
  return result;
}

// --from-raw: ネットワークを使わずに data/raw/<日付>/features/ から作り直す (FEATURE-001 AC-002)。
export function buildFromRaw({
  rawDir,
  dataDir = defaultDataDir,
  generatedAt = new Date().toISOString(),
  dryRun = false,
  log = (text) => process.stderr.write(text),
}) {
  const tocPath = join(rawDir, "toc-contents.json");
  if (!existsSync(tocPath)) throw new Error(`生データがありません: ${tocPath}`);
  const toc = readJson(tocPath);
  const cards = {};
  for (const card of listModelCards(toc)) {
    const path = join(rawDir, rawCardName(card));
    cards[card] = existsSync(path) ? readFileSync(path, "utf8") : null;
  }
  return buildAndWrite({ cards, rawDir, dataDir, generatedAt, dryRun, log });
}

// --- ネットワーク ----------------------------------------------------------

async function fetchText(url) {
  // 一時的な失敗に備えて 1 回だけ取り直す。
  let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      const response = await fetch(url, { headers: REQUEST_HEADERS, signal: AbortSignal.timeout(30_000) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.text();
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

async function download({ rawDir, log }) {
  mkdirSync(rawDir, { recursive: true });
  const tocText = await fetchText(TOC_URL);
  writeFileSync(join(rawDir, "toc-contents.json"), tocText);
  const toc = JSON.parse(tocText);
  const list = listModelCards(toc);
  const cards = {};
  let next = 0;
  const worker = async () => {
    while (next < list.length) {
      const card = list[next];
      next += 1;
      try {
        const text = await fetchText(cardMarkdownUrl(card));
        writeFileSync(join(rawDir, rawCardName(card)), text);
        cards[card] = text;
      } catch (error) {
        // 1 本の失敗で全体を止めない。failedCards に数える。
        cards[card] = null;
        log(`${card}: ${error.message}\n`);
      }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  log(`fetched ${list.length - Object.values(cards).filter((v) => v === null).length} / ${list.length} cards\n`);
  return { cards };
}

async function main(argv) {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(new Date());
  const options = parseFeatureArgs(argv, { today });
  const log = (text) => process.stderr.write(text);
  const rawDir = join(defaultDataDir, "raw", options.date, "features");

  const result = options.fromRaw
    ? buildFromRaw({ rawDir, dryRun: options.dryRun, log })
    : buildAndWrite({
        ...(await download({ rawDir, log })),
        rawDir,
        dataDir: defaultDataDir,
        generatedAt: new Date().toISOString(),
        dryRun: options.dryRun,
        log,
      });
  log(`summary: data/raw/${options.date}/features/summary.md\n`);
  if (result.guardTripped) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main(process.argv.slice(2)).catch((error) => {
    process.stderr.write(`${error.message}\n\n${USAGE}\n`);
    process.exitCode = 1;
  });
}
