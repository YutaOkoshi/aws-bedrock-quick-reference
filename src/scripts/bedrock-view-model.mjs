// 起点リージョンから見た表の行を組み立てる純関数群 (TABLE-001 / D-003)。
// DOM も i18n も知らない。入力は data/*.json をそのまま渡す形にしてある。

import { endpointAvailability, inferenceMismatches, modelDocsUrl } from "./feature-model.mjs";
import { isMantleRegion, judgeMantle, mantleEndpointOf } from "./mantle-model.mjs";

// Global の接頭辞 (D-003)。これ以外の接頭辞はすべて地理圏 (Geo) として扱う (D-012)。
// 接頭辞の閉じた一覧はコードにもデータにも持たない (DATA-001 AC-013)。
export const GLOBAL_PREFIX = "global";

// 行の並びで先頭に固定するプロバイダ (D-011 / TABLE-001 AC-014)。
// これは「どのプロバイダを Geo と見なすか」のような判定の一覧ではなく、
// 並び順の好みの定義。データに無いプロバイダは単に飛ばす (空の見出しを作らない)。
export const PINNED_PROVIDERS = Object.freeze(["Anthropic", "OpenAI"]);

// 行の並びの値 (TABLE-001 AC-014)。既定は pinned。
export const SORT_PINNED = "pinned";
export const SORT_ALPHA = "alpha";
export const SORT_NEWEST = "newest";
export const SORT_VALUES = Object.freeze([SORT_PINNED, SORT_ALPHA, SORT_NEWEST]);
export const DEFAULT_SORT = SORT_PINNED;

// In-Region: availability[R] に ON_DEMAND が含まれるか。
// INFERENCE_PROFILE だけ / PROVISIONED だけ / 空配列 はいずれも「不可」(AC-003)。
export function judgeInRegion(models, modelId, region) {
  const types = models?.[modelId]?.availability?.[region];
  return Array.isArray(types) && types.includes("ON_DEMAND");
}

// プロファイルが「その起点から呼べる」か。sources[R] を持つことが条件 (D-003)。
function servesRegion(profile, region) {
  return Array.isArray(profile?.sources?.[region]);
}

// Geo: 接頭辞が global 以外のプロファイルのうち modelId が一致し sources[R] を持つ全件 (D-012)。
// 接頭辞の固定リストを持たないので、新しい地理圏 (ca. / in. など) も自動的に拾う。
// destination は昇順、プロファイルが複数あれば profileId の昇順で並べる (AC-004)。
export function judgeGeo(profiles, modelId, region) {
  return Object.entries(profiles ?? {})
    .filter(
      ([, profile]) =>
        typeof profile?.prefix === "string" &&
        profile.prefix.length > 0 &&
        profile.prefix !== GLOBAL_PREFIX &&
        profile.modelId === modelId &&
        servesRegion(profile, region),
    )
    .map(([profileId, profile]) => ({
      profileId,
      prefix: profile.prefix,
      destinations: [...profile.sources[region]].sort(),
    }))
    .sort((a, b) => a.profileId.localeCompare(b.profileId));
}

// Global: 接頭辞 global のみ。destination は API から取れず sources[R] は ["*"] なので、
// 列挙せず「該当プロファイルがある」という事実だけを返す (AC-005 / Design FAQ Q6)。
export function judgeGlobal(profiles, modelId, region) {
  const found = Object.entries(profiles ?? {}).find(
    ([, profile]) =>
      profile?.prefix === GLOBAL_PREFIX &&
      profile.modelId === modelId &&
      servesRegion(profile, region),
  );
  if (!found) return null;
  return { profileId: found[0], prefix: GLOBAL_PREFIX };
}

// リージョンの表示名は region-notes.json の ja / en が正 (I18N-001 AC-005)。
// 辞書ではなくデータなので、この純関数群から直接引いてよい。
function localName(regionNotes, code, lang) {
  const name = regionNotes?.[code]?.[lang];
  return typeof name === "string" && name.length > 0 ? name : code;
}

// 並び順の段: 起点リージョン自身 → 起点と同じ国 → それ以外 (TABLE-001 v4 AC-004)。
function placeRank(place) {
  if (place.isSource) return 0;
  return place.outside ? 2 : 1;
}

/**
 * Geo の推論先を「地名の並び」にする (TABLE-001 v4 AC-004)。
 * 起点リージョンの国 (region-notes.json の country) の外にある推論先は outside: true。
 * 起点の国が分からないときは誰も outside にしない (判断材料が無いため)。
 * 並びは 起点 → 同じ国 → それ以外 を表示名の昇順で。
 */
export function geoPlaces(destinations, { region, regionNotes, lang = "ja" } = {}) {
  const sourceCountry = regionNotes?.[region]?.country ?? null;
  return [...new Set(destinations ?? [])]
    .map((code) => {
      const country = regionNotes?.[code]?.country ?? null;
      return {
        code,
        name: localName(regionNotes, code, lang),
        isSource: code === region,
        outside: sourceCountry != null && country !== sourceCountry,
      };
    })
    .sort(
      (a, b) =>
        placeRank(a) - placeRank(b) ||
        a.name.localeCompare(b.name, lang) ||
        a.code.localeCompare(b.code),
    );
}

/** 起点の国の外にある推論先の件数 (AC-004 の「（国外 N）」)。 */
export function outsideCount(places) {
  return (places ?? []).filter((place) => place.outside).length;
}

// --- 行の並び (TABLE-001 AC-014 / D-011) ----------------------------------

/**
 * 行を プロバイダ → モデル名 の 2 段で並べる純関数 (TABLE-001 AC-014)。
 * table-engine.js の sortRows (列ヘッダでの並べ替え) とは別物なので orderRows と呼ぶ。
 *
 *  - `pinned` (既定): PINNED_PROVIDERS を先頭に固定し、残りをプロバイダ名の昇順
 *  - `alpha`: 全プロバイダを名前の昇順。固定は無い
 *
 * どちらの値でも同じプロバイダの中はモデル名の昇順。行を落としたり増やしたりはしない。
 * REGIONS-001 の行列も同じ関数で並べる (REGIONS-001 AC-003)。
 */
export function orderRows(rows, { sort = DEFAULT_SORT, lang = "ja" } = {}) {
  const list = [...(rows ?? [])];
  const present = new Set(list.map((row) => row.provider ?? ""));
  // データに無い固定プロバイダは飛ばす (空の見出しを作らない)。
  const pinned = sort === SORT_PINNED ? PINNED_PROVIDERS.filter((name) => present.has(name)) : [];
  const rank = (provider) => {
    const index = pinned.indexOf(provider);
    return index >= 0 ? index : pinned.length;
  };
  return list.sort((a, b) => {
    if (sort === SORT_NEWEST) {
      const aDate = Date.parse(a.releasedAt), bDate = Date.parse(b.releasedAt);
      const aKnown = Number.isFinite(aDate), bKnown = Number.isFinite(bDate);
      if (aKnown !== bKnown) return aKnown ? -1 : 1;
      if (aKnown && aDate !== bDate) return bDate - aDate;
    }
    const rankA = rank(a.provider ?? "");
    const rankB = rank(b.provider ?? "");
    if (rankA !== rankB) return rankA - rankB;
    // 固定した同じプロバイダ同士は名前で比べない (同じ文字列なので結果は同じ)。
    const byProvider =
      rankA < pinned.length
        ? 0
        : String(a.provider ?? "").localeCompare(String(b.provider ?? ""), lang);
    return (
      byProvider ||
      String(a.name ?? "").localeCompare(String(b.name ?? ""), lang) ||
      String(a.modelId ?? "").localeCompare(String(b.modelId ?? ""))
    );
  });
}

// --- 価格 (PRICE-001) -----------------------------------------------------

// prices.json の 1 モデル × 1 リージョン分。無ければ null (画面では「—」)。
export function priceFor(prices, modelId, region) {
  const entry = prices?.byModel?.[modelId]?.[region];
  return entry && typeof entry === "object" ? entry : null;
}

// 一覧用の比較価格。起点の価格を優先し、無ければリージョン付きの参考価格。
export function comparisonPrices(prices, modelId, region, globalAvailable = true) {
  const entries = prices?.byModel?.[modelId] ?? {};
  const regions = [region, ...Object.keys(entries).filter((key) => key !== region).sort()];
  for (const source of regions) {
    const rows = (globalAvailable ? ["global", "standard"] : ["standard"]).flatMap((kind) => {
      const value = entries[source]?.[kind];
      return value && [value.input, value.output].some((amount) => formatPrice(amount) !== null)
        ? [{ ...value, kind, region: source, reference: source !== region, ...(entries[source]?.source ? { source: entries[source].source } : {}) }]
        : [];
    });
    const selected = rows.slice(0, 1);
    const scope = selected[0]?.kind ?? (globalAvailable && entries[source]?.metered?.some(rate => rate.scope === "global") ? "global" : "standard");
    for (const rate of entries[source]?.metered ?? []) {
      if ((rate.scope ?? "standard") !== scope) continue;
      selected.push({ ...rate, kind: "metered", region: source, reference: source !== region, ...(entries[source]?.source ? { source: entries[source].source } : {}) });
    }
    if (selected.length) return selected;
  }
  return [];
}

/**
 * 単価の表示 (TABLE-001 v7 AC-013)。
 * $1 以上は小数 2 桁、$1 未満は有効数字 3 桁。値が無ければ null。
 */
export function formatPrice(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value === 0) return "0";
  if (Math.abs(value) >= 1) return value.toFixed(2);
  return value
    .toPrecision(3)
    .replace(/(\.\d*?)0+$/, "$1")
    .replace(/\.$/, "");
}

// fetch-log.json の 1 リージョン分。記録が無いリージョンは "unknown" にする。
export function regionStatus(fetchLog, region) {
  const entry = fetchLog?.regions?.[region];
  if (!entry) return { status: "unknown", cause: null, models: 0, profiles: 0 };
  return {
    status: entry.status,
    // 取得失敗の分類 (DATA-001 D-008)。メンテナ向けの情報で、画面には出さない。
    cause: entry.cause ?? null,
    models: entry.models ?? 0,
    profiles: entry.profiles ?? 0,
  };
}

// 取得できなかったリージョンのコード一覧 (脚注用、昇順)。
export function deniedRegions(fetchLog) {
  return Object.entries(fetchLog?.regions ?? {})
    .filter(([, entry]) => entry?.status === "denied")
    .map(([code]) => code)
    .sort();
}

// 起点リージョンとして選べるコード。region-notes.json のキー全件 (D-004)。
// `_source` はメタデータなので除く。
export function selectableRegions(regionNotes) {
  return Object.keys(regionNotes ?? {})
    .filter((key) => key !== "_source")
    .sort();
}

export function endpointOf(regionNotes, region) {
  return regionNotes?.[region]?.endpoint ?? `bedrock-runtime.${region}.amazonaws.com`;
}

// overrides.json の備考。キーはモデル ID または プロファイル ID。
function noteFor(overrides, id) {
  if (!id || id === "_comment") return null;
  const note = overrides?.[id];
  return note && typeof note === "object" ? note : null;
}

// 起点リージョン R で ListFoundationModels に載っていたモデル = availability[R] を持つモデル。
// 「提供なし」(空の availability) と「そもそも載っていない」は区別せず、
// 載っていたものだけを行にする。
function modelsVisibleFrom(models, region) {
  return Object.entries(models ?? {}).filter(([, model]) =>
    Object.prototype.hasOwnProperty.call(model?.availability ?? {}, region),
  );
}

// 1 行分。table-engine に渡すプレーンオブジェクト。
export function buildRow({ modelId, model, profiles, region, overrides, mantle = null, prices, features = {} }) {
  const geo = judgeGeo(profiles, modelId, region);
  const globalProfile = judgeGlobal(profiles, modelId, region);
  const price = priceFor(prices, modelId, region);
  const comparison = comparisonPrices(prices, modelId, region, Boolean(globalProfile));
  const inRegion = judgeInRegion({ [modelId]: model }, modelId, region);
  return {
    // In-Region / Geo / Global を bedrock-runtime / bedrock-mantle ごとに (表のセルの下段に出す)。
    endpoints: endpointAvailability({ features, mantle, modelId, region, row: { inRegion, geo, global: globalProfile } }),
    // MANTLE-001 AC-003。判定材料が無ければ null (画面では「—」)。
    mantle: judgeMantle(mantle, modelId, region),
    modelId,
    // 起点リージョン。Geo セルが「起点の国の外か」を判断するのに使う (AC-004)。
    sourceRegion: region,
    provider: model.provider ?? "",
    name: model.name ?? "",
    releasedAt: model.releasedAt ?? null,
    input: model.input ?? [],
    output: model.output ?? [],
    streaming: model.streaming === true,
    lifecycle: model.lifecycle ?? "",
    availability: model.availability ?? {},
    inRegion,
    geo,
    global: globalProfile,
    // 一覧は先頭に表示する比較価格で並べ替える。詳細は起点の価格を使う。
    price,
    comparisonPrices: comparison,
    // D-018: 価格未収録のときに案内する docs (モデルカード、無ければ料金ページ)。
    docsUrl: modelDocsUrl(features, modelId),
    // docs のモデルカードと ListInferenceProfiles の Geo / Global の推論 ID の食い違い (無ければ null)。
    inferenceMismatch: inferenceMismatches(features, profiles, modelId),
    priceInput: comparison[0]?.input ?? null,
    priceOutput: comparison[0]?.output ?? null,
    // 備考はモデル ID のものに、そのモデルに紐づくプロファイル ID のものを続ける。
    notes: [
      { id: modelId, note: noteFor(overrides, modelId) },
      ...geo.map((entry) => ({ id: entry.profileId, note: noteFor(overrides, entry.profileId) })),
      ...(globalProfile
        ? [{ id: globalProfile.profileId, note: noteFor(overrides, globalProfile.profileId) }]
        : []),
    ].filter((entry) => entry.note != null),
  };
}

/**
 * 画面 1 枚ぶんのビューモデル。
 * status が "denied" のとき rows は必ず 0 行 (AC-009)。cause はデータモデルに残るが
 * 画面には出さない (D-008)。
 * status が "ok" で rows が 0 行なら「提供なし」(AC-010)。
 */
export function buildViewModel({
  models,
  profiles,
  fetchLog,
  regionNotes,
  overrides = {},
  mantle = null,
  prices = {},
  features = {},
  region,
}) {
  const fetch = regionStatus(fetchLog, region);
  const rows =
    fetch.status === "ok"
      ? modelsVisibleFrom(models, region)
          .map(([modelId, model]) =>
            buildRow({ modelId, model, profiles, region, overrides, mantle, prices, features }),
          )
          // 一覧は プロバイダ → モデル名 の昇順 (TABLE-001 v2 AC-006)。
          // 同名のモデルが複数あるときだけモデル ID で決着させる。
          .sort(
            (a, b) =>
              a.provider.localeCompare(b.provider) ||
              a.name.localeCompare(b.name) ||
              a.modelId.localeCompare(b.modelId),
          )
      : [];

  return {
    region,
    endpoint: endpointOf(regionNotes, region),
    // MANTLE-001 AC-001 / AC-002: 起点リージョンの bedrock-mantle。
    // 提供が無いリージョンでは FQDN を出さない (呼べない宛先を見せないため)。
    mantleRegion: isMantleRegion(mantle, region),
    mantleEndpoint: isMantleRegion(mantle, region) ? mantleEndpointOf(region) : null,
    status: fetch.status,
    cause: fetch.cause,
    rows,
    generatedAt: fetchLog?.generatedAt ?? null,
    accountKind: fetchLog?.accountKind ?? null,
    deniedRegions: deniedRegions(fetchLog),
    // 価格の脚注 (PRICE-001 AC-009)。
    priceGeneratedAt: prices?.generatedAt ?? null,
    pricePublicationDate: prices?.publicationDate ?? null,
    priceSource: prices?.source ?? null,
  };
}
