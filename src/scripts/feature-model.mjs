// モデル別 Capabilities and Features の画面用の組み立て (FEATURE-001)。純関数。DOM を触らない。
// data/features.json の値は true / false / キーなし の 3 状態。「記載なし」を false に倒さない (D-003 と同じ方針)。

import { judgeMantle } from "./mantle-model.mjs";

export const DOCS_BASE = "https://docs.aws.amazon.com/bedrock/latest/userguide/";
// モデルカードが分からないモデルの行き先 (D-018)。
export const PRICING_PAGE_URL = "https://aws.amazon.com/bedrock/pricing/";

/**
 * docs のモデルカード (Programmatic Access の表) と ListInferenceProfiles の、Geo / Global の推論 ID の食い違い。
 * 判定に使うのは bedrock-runtime の行 (表の Geo / Global の列は bedrock-runtime の推論プロファイルで決まる)。
 * 行が無ければ docs では「無い」として比べる。カードの表自体が分からないモデルは比べない (null)。
 * 戻り値: { geo: { api, docs } | null, global: { api, docs } | null }。一致していれば null
 */
export function inferenceMismatches(features, profiles, modelId) {
  const endpoints = features?.byModel?.[modelId]?.endpoints;
  if (!endpoints) return { geo: null, global: null };
  const runtime = endpoints["bedrock-runtime"] ?? { geo: [], global: [] };
  // カードの行が別の ID (文脈長の付いた Provisioned 専用の ID は基の ID のカードを共有する) なら比べない。
  if (runtime.modelId && runtime.modelId !== modelId) return { geo: null, global: null };
  const api = { geo: [], global: [] };
  for (const [profileId, profile] of Object.entries(profiles ?? {})) {
    if (profile?.modelId !== modelId) continue;
    (profileId.startsWith("global.") ? api.global : api.geo).push(profileId);
  }
  const compare = (lane) => {
    const a = [...api[lane]].sort();
    // GovCloud (us-gov.) はこのサイトの対象外。
    const d = [...new Set(runtime[lane] ?? [])].filter((id) => !id.startsWith("us-gov.")).sort();
    return a.length === d.length && a.every((id, index) => id === d[index]) ? null : { api: a, docs: d };
  };
  return { geo: compare("geo"), global: compare("global") };
}

/**
 * In-Region / Geo / Global を、bedrock-runtime と bedrock-mantle のそれぞれで使えるか (2026-10-08)。
 * - runtime: 表の判定と同じ API (ListFoundationModels / ListInferenceProfiles) の結果。row の inRegion / geo / global
 * - mantle: docs のモデルカードの地域の表 (features.json の regions["bedrock-mantle"]。接続先を分けていない表なら shared)。
 *   Programmatic Access に bedrock-mantle の行が無ければ不可。地域の表が無ければ In-Region だけ mantle.json で決める。
 *   どれにも記載が無ければ null (画面では「—」)
 * 戻り値: { inRegion | geo | global: { runtime: boolean, mantle: boolean | null, mantleShared: boolean } }
 */
export function endpointAvailability({ features, mantle, modelId, region, row }) {
  const runtime = {
    inRegion: Boolean(row?.inRegion),
    geo: Array.isArray(row?.geo) ? row.geo.length > 0 : Boolean(row?.geo),
    global: Boolean(row?.global),
  };
  const entry = features?.byModel?.[modelId];
  const endpoints = entry?.endpoints;
  const table = entry?.regions?.["bedrock-mantle"] ?? entry?.regions?.shared ?? null;
  const shared = !entry?.regions?.["bedrock-mantle"] && Boolean(entry?.regions?.shared);
  const fallback = judgeMantle(mantle, modelId, region);

  const mantleFor = (lane) => {
    if (endpoints && !endpoints["bedrock-mantle"]) return false;
    if (endpoints?.["bedrock-mantle"] && table) return (table[lane] ?? []).includes(region);
    if (lane === "inRegion" && fallback) return fallback.available;
    return null;
  };
  const usedShared = (lane) => shared && Boolean(endpoints?.["bedrock-mantle"]) && mantleFor(lane) !== null;
  return Object.fromEntries(
    ["inRegion", "geo", "global"].map((lane) => [lane, { runtime: runtime[lane], mantle: mantleFor(lane), mantleShared: usedShared(lane) }]),
  );
}

/** 価格未収録のときに案内する docs の URL。モデルカード (features.json の card) が無ければ料金ページ。 */
export function modelDocsUrl(features, modelId) {
  const card = features?.byModel?.[modelId]?.card;
  return typeof card === "string" && card ? `${DOCS_BASE}${card}` : PRICING_PAGE_URL;
}

// 脚注の出典。モデルカードの一覧ページ。
export const MODEL_CARDS_URL = `${DOCS_BASE}model-cards.html`;

export const FEATURE_STATES = Object.freeze({ YES: "yes", NO: "no", NONE: "none" });

// 並べ替えの順位。yes > no > none。
const RANK = { yes: 2, no: 1, none: 0 };

function stateOf(value) {
  if (value === true) return FEATURE_STATES.YES;
  if (value === false) return FEATURE_STATES.NO;
  return FEATURE_STATES.NONE;
}

/** 列ピッカーの選択肢。features.features の順に { key, label }。label は docs の英語名のまま。 */
export function featureOptions(features) {
  return Object.entries(features?.features ?? {}).map(([key, value]) => ({
    key,
    label: value?.label ?? key,
  }));
}

/** 既定で表に出す列。defaultColumns のうち features に在るものだけ。 */
export function defaultFeatureColumns(features) {
  const known = features?.features ?? {};
  return (features?.defaultColumns ?? []).filter((key) => Object.hasOwn(known, key));
}

/** モデル × 機能の 1 セル。{ runtime, mantle } をそれぞれ yes / no / none で返す。 */
export function featureCell(features, modelId, key) {
  const entry = features?.byModel?.[modelId];
  return {
    runtime: stateOf(entry?.runtime?.[key]),
    mantle: stateOf(entry?.mantle?.[key]),
  };
}

/** 子列 (Runtime / Mantle の片側) の並べ替えの値。yes=2 > no=1 > none=0。 */
export function featureStateRank(state) {
  return RANK[state] ?? 0;
}

/** 並べ替えの値。runtime を優先し、同順なら mantle。 */
export function featureSortValue(cell) {
  return (RANK[cell?.runtime] ?? 0) * 3 + (RANK[cell?.mantle] ?? 0);
}

/** 詳細パネルの機能表。features の順で、runtime / mantle のどちらかが記載ありの行だけ。 */
export function buildFeatureRows(features, modelId) {
  return featureOptions(features)
    .map(({ key, label }) => ({ key, label, ...featureCell(features, modelId, key) }))
    .filter((row) => row.runtime !== FEATURE_STATES.NONE || row.mantle !== FEATURE_STATES.NONE);
}
