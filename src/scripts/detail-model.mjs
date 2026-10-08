// 行を開いたときのパネル (DETAIL-001 v8) を組み立てる純関数群。
// パネルは「この起点からどう呼べるか」だけを扱う。リージョン横断の提供状況は
// REGIONS-001 の行列が、プロファイルごとの全行は将来の「プロファイル」ビューが持つ (D-013)。
// DOM も i18n も知らない。表示名が要るものは lang と regionNotes を受け取って組み立てる。

import {
  GLOBAL_PREFIX,
  endpointOf,
  judgeGeo,
  judgeGlobal,
  judgeInRegion,
  priceFor,
} from "./bedrock-view-model.mjs";
import { isMantleRegion, judgeMantle, mantleEndpointOf } from "./mantle-model.mjs";
import { splitDestinations } from "./flow-model.mjs";

// レーン。この順が「使えるレーンのうち最も狭いもの」の優先順でもある (AC-015)。
export const LANE_IN_REGION = "inRegion";
export const LANE_GEO = "geo";
export const LANE_GLOBAL = "global";
export const LANE_ORDER = Object.freeze([LANE_IN_REGION, LANE_GEO, LANE_GLOBAL]);

// レーンごとの価格の種別 (AC-013)。In-Region / Geo は標準系 (サービス階層の priority / flex を含む)、
// Global は global 行のみ。priority / flex しか無いモデル (Qwen3 Next 80B の東京) もある。
const LANE_PRICE_KINDS = Object.freeze({
  [LANE_IN_REGION]: Object.freeze(["standard", "batch", "cacheRead", "cacheWrite", "priority", "flex"]),
  [LANE_GEO]: Object.freeze(["standard", "batch", "cacheRead", "cacheWrite", "priority", "flex"]),
  [LANE_GLOBAL]: Object.freeze(["global", "globalBatch", "globalCacheRead", "globalCacheWrite"]),
});

/**
 * 起点 R のモデル M の単価を 種別 × 入力 / 出力 の行にする (AC-013 / PRICE-001 AC-010)。
 * 行はそのレーンに対応する種別だけを LANE_PRICE_KINDS の順で返す。
 * 単価が 1 つも無ければ空配列 (画面では「価格データなし」)。
 */
export function buildPriceRows(modelId, { prices, region, lane = LANE_IN_REGION } = {}) {
  const entry = priceFor(prices, modelId, region);
  if (!entry) return [];
  const kinds = LANE_PRICE_KINDS[lane] ?? LANE_PRICE_KINDS[LANE_IN_REGION];
  const rows = tokenRows(entry, kinds);
  for (const rate of entry.metered ?? []) {
    if ((rate.scope ?? "standard") !== (lane === LANE_GLOBAL ? "global" : "standard")) continue;
    rows.push({ kind: "metered", label: rate.label, unit: rate.unit, [rate.axis]: rate.value });
  }
  return rows;
}

// bedrock-mantle の単価の種別。Runtime とは別の SKU で、値も別に決まる。レーンには依らない。
const MANTLE_PRICE_KINDS = Object.freeze(["standard", "global", "batch", "cacheRead", "cacheWrite", "priority", "flex", "globalBatch", "globalCacheRead", "globalCacheWrite"]);

/**
 * 起点 R のモデル M の bedrock-mantle の単価を行にする。Runtime の単価は含めない。
 * 単価が無ければ空配列 (画面では Mantle の表を出さない)。
 */
export function buildMantlePriceRows(modelId, { prices, region } = {}) {
  const mantle = priceFor(prices, modelId, region)?.mantle;
  return mantle && typeof mantle === "object" ? tokenRows(mantle, MANTLE_PRICE_KINDS) : [];
}

// 種別ごとのトークン単価の行。長文コンテキストの単価は同じ種別の後ろにまとめて並べる。
function tokenRows(entry, kinds) {
  const rows = kinds
    .filter((kind) => entry[kind] != null)
    .map((kind) => ({
      kind,
      input: entry[kind]?.input ?? null,
      output: entry[kind]?.output ?? null,
      ...(entry[kind]?.maxInputTokens ? { maxInputTokens: entry[kind].maxInputTokens } : {}),
    }))
    // long_ctx だけで標準の単価が無い種別は、標準の行を出さない。
    .filter((row) => row.input != null || row.output != null);
  for (const kind of kinds) {
    // 長文コンテキストの単価。境界のトークン数は価格表に無いので、あるときだけ添える。
    if (entry[kind]?.longContext) {
      rows.push({ kind, ...entry[kind].longContext, longContext: true, ...(entry[kind].maxInputTokens ? { minInputTokens: entry[kind].maxInputTokens } : {}) });
    }
  }
  return rows;
}

/** Global のレーンで「バッチ・キャッシュの単価が価格表に無い」かどうか (AC-013 の注記)。 */
export function globalExtrasMissing(modelId, { prices, region } = {}) {
  const entry = priceFor(prices, modelId, region);
  if (!entry) return false;
  return ["globalBatch", "globalCacheRead", "globalCacheWrite"].every((kind) => entry[kind] == null);
}

/**
 * Geo のプロファイルを**狭い順**に並べる (AC-018)。
 * `sources[R]` の件数の昇順、同数なら接頭辞の昇順。
 * 引数は judgeGeo が返す配列でも、profiles.json のオブジェクトそのものでもよい。
 */
export function sortGeoProfiles(profiles, region) {
  const list = Array.isArray(profiles)
    ? [...profiles]
    : Object.entries(profiles ?? {})
        .filter(
          ([, profile]) =>
            typeof profile?.prefix === "string" &&
            profile.prefix.length > 0 &&
            profile.prefix !== GLOBAL_PREFIX &&
            Array.isArray(profile?.sources?.[region]),
        )
        .map(([profileId, profile]) => ({
          profileId,
          prefix: profile.prefix,
          destinations: [...profile.sources[region]].sort(),
        }));
  const count = (entry) => (entry.destinations ?? entry.sources?.[region] ?? []).length;
  return list.sort(
    (a, b) =>
      count(a) - count(b) ||
      String(a.prefix).localeCompare(String(b.prefix)) ||
      String(a.profileId).localeCompare(String(b.profileId)),
  );
}

/**
 * 3 レーン分の「常に見える 1 行の要約」の材料 (AC-014)。
 * 文言そのものは i18n が持つ。ここが返すのは 可否・件数・プロファイルの並びだけ。
 */
export function buildLaneSummaries(
  modelId,
  { models, profiles, region, regionNotes, lang = "ja" } = {},
) {
  const geoProfiles = sortGeoProfiles(judgeGeo(profiles, modelId, region), region);
  const globalProfile = judgeGlobal(profiles, modelId, region);

  // Geo の国内 N / 国外 M は「そのレーンの全プロファイルの推論先の和集合」(AC-014)。
  const union = [...new Set(geoProfiles.flatMap((entry) => entry.destinations))];
  const split = splitDestinations(union, { origin: region, regionNotes, lang });

  return {
    [LANE_IN_REGION]: {
      lane: LANE_IN_REGION,
      available: judgeInRegion(models, modelId, region),
      id: modelId,
    },
    [LANE_GEO]: {
      lane: LANE_GEO,
      available: geoProfiles.length > 0,
      profiles: geoProfiles,
      prefixes: geoProfiles.map((entry) => entry.prefix),
      countryKnown: split.countryKnown,
      domesticCount: split.domestic.length,
      foreignCount: split.foreign.length,
      // 起点の国が分からないときは件数を切り分けず「推論先 K」とだけ書く (AC-014)。
      totalCount: union.length,
    },
    [LANE_GLOBAL]: {
      lane: LANE_GLOBAL,
      available: globalProfile != null,
      id: globalProfile?.profileId ?? null,
    },
  };
}

/**
 * 既定で選ばれるレーン (AC-015)。
 * 使えるレーンのうち最も狭いもの。3 つとも使えないときは In-Region。
 */
export function defaultLane(summaries) {
  for (const lane of LANE_ORDER) {
    if (summaries?.[lane]?.available) return lane;
  }
  return LANE_IN_REGION;
}

/**
 * セッション内で覚えたレーンを、今開く行に当てはめる (AC-020)。
 * そのレーンがこの行で使えなければ既定に戻す。
 */
export function resolveLane(remembered, summaries) {
  if (remembered && summaries?.[remembered]?.available) return remembered;
  return defaultLane(summaries);
}

/**
 * 「推論先」節の行 (AC-019)。**リージョンコードは返さない。地名だけ**。
 * 返すのは種別と地名の配列で、文言は i18n 側が組み立てる。
 */
export function buildDestinationLines(
  lane,
  { destinations = [], region, regionNotes, lang = "ja", available = true } = {},
) {
  const originName = regionNotes?.[region]?.[lang] ?? region;

  if (lane === LANE_IN_REGION) {
    if (!available) return { lines: [{ kind: "notOffered", place: originName }], note: null };
    return {
      lines: [{ kind: "inRegion", places: [originName], warn: false }],
      note: null,
    };
  }

  // 使えない Geo / Global のレーンは推論先が無い。タブの要約と同じ「提供なし」だけを出し、
  // 呼べるかのような行（「国内 0」「範囲: 全商用リージョン…」）を出さない (AC-016)。
  if (!available) return { lines: [{ kind: "unavailable" }], note: null };

  if (lane === LANE_GLOBAL) {
    return {
      lines: [{ kind: "globalScope", places: [], warn: true }],
      note: "global",
    };
  }

  const split = splitDestinations(destinations, { origin: region, regionNotes, lang });
  const lines = [];
  if (split.countryKnown) {
    lines.push({
      kind: "domestic",
      count: split.domestic.length,
      places: split.domestic.map((place) => place.name),
      warn: false,
    });
    // 国外が 0 件ならその行を出さない (AC-019)。
    if (split.foreign.length > 0) {
      lines.push({
        kind: "foreign",
        count: split.foreign.length,
        places: split.foreign.map((place) => place.name),
        warn: true,
      });
    }
  } else {
    lines.push({
      kind: "any",
      count: split.rest.length,
      places: split.rest.map((place) => place.name),
      warn: false,
    });
  }
  return { lines, note: "geo", origin: originName };
}

/**
 * パネル 1 枚ぶん。共通の見出し行 (AC-010) とレーンの要約 (AC-014) を返す。
 * 「提供状況」「推論プロファイル」はこのモデルに無い (D-013)。
 */
export function buildDetail(
  modelId,
  { models, profiles, regionNotes, prices, region, mantle = null, lang = "ja" } = {},
) {
  const summaries = buildLaneSummaries(modelId, { models, profiles, region, regionNotes, lang });
  return {
    modelId,
    region,
    // AC-010 項目 2: 起点の bedrock-runtime の FQDN。
    endpoint: endpointOf(regionNotes, region),
    // AC-010 項目 3: mantle があるリージョンのときだけ出す (MANTLE-001 AC-005)。
    mantleRegion: isMantleRegion(mantle, region),
    mantleEndpoint: isMantleRegion(mantle, region) ? mantleEndpointOf(region) : null,
    mantle: judgeMantle(mantle, modelId, region),
    summaries,
    defaultLane: defaultLane(summaries),
    anyLane: LANE_ORDER.some((lane) => summaries[lane].available),
    prices,
  };
}
