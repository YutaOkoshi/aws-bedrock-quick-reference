// 絞り込みの純関数群 (FILTER-001 / D-007)。DOM も i18n も知らない。
// 判定のやり直しはしない。TABLE-001 が組み立てた行 (bedrock-view-model.mjs の buildRow)
// をそのまま受け取り、条件で残す / 落とすだけを決める。

import { GLOBAL_PREFIX } from "./bedrock-view-model.mjs";

// モダリティの選択肢 (AC-002)。API から返る値のうち画面に出す 5 種。
export const MODALITIES = Object.freeze(["TEXT", "IMAGE", "SPEECH", "VIDEO", "EMBEDDING"]);

// 推論先の限定が無い状態 (既定)。
export const NO_LIMIT = "none";

// 地理圏コードの一覧は固定リストを持たず、データから導く (D-012 / AC-020)。
// 下の 3 つは「どれを地理圏と見なすか」ではなく**並び順の好み**の定義で、
// ここに無いコードも落とさず末尾に昇順で並べる。
const GEO_ORDER_PREFERENCE = Object.freeze(["jp", "apac", "eu", "us", "au"]);
const COUNTRY_ORDER_PREFERENCE = Object.freeze(["jp", "us", "au"]);
// 推論先の限定セレクタだけは残った地理圏の並びが違う (FILTER-001 AC-018)。
export const LIMIT_GEO_ORDER_PREFERENCE = Object.freeze(["jp", "au", "eu", "apac", "us"]);

// どの地理圏にも属さないリージョンの区分。region-notes.json の geo にしか現れず、
// プロファイルの接頭辞には対応しないので、限定の選択肢には出さず並びの末尾に置く。
export const UNGROUPED_GEO = "other";

// カスタムのリージョン複数選択 (D-007 の B の経路、Issue #1)。
// セレクタの値は集合が空のとき "custom"、選択があるとき "custom:<code>+<code>..." (昇順)。
export const CUSTOM_LIMIT = "custom";
const CUSTOM_PREFIX = "custom:";


export const DEFAULT_FILTERS = Object.freeze({
  provider: [],
  modality: [],
  q: "",
  callable: false,
  limit: NO_LIMIT,
});

function regionCodes(regionNotes) {
  return Object.keys(regionNotes ?? {}).filter((key) => key !== "_source");
}

/** region-notes.json が持つリージョンコードの全件 (昇順)。カスタム経路の母集団。 */
export function allRegionCodes(regionNotes) {
  return regionCodes(regionNotes).sort();
}

/** カスタムの値か (AC-012)。"custom" と "custom:..." の両方。 */
export function isCustomLimit(value) {
  const text = String(value ?? "");
  return text === CUSTOM_LIMIT || text.startsWith(CUSTOM_PREFIX);
}

/**
 * "custom:a+b" からリージョンコードを取り出す。重複を除いて昇順 (AC-016)。
 * URLSearchParams はクエリ中の生の "+" を空白に復号するので、区切りは "+" と空白の
 * どちらも受ける (手で書いた URL も、アプリが書いた %2B もどちらも読める)。
 */
export function customLimitCodes(value) {
  const text = String(value ?? "");
  if (!text.startsWith(CUSTOM_PREFIX)) return [];
  const codes = text
    .slice(CUSTOM_PREFIX.length)
    .split(/[+\s]+/)
    .map((code) => code.trim())
    .filter((code) => code.length > 0);
  return [...new Set(codes)].sort();
}

/** リージョンコードの集合を URL の値にする。空集合は "custom" (= 限定しない、AC-015)。 */
export function customLimitValue(codes) {
  const list = [...new Set((codes ?? []).filter((code) => String(code ?? "").length > 0))].sort();
  return list.length === 0 ? CUSTOM_LIMIT : `${CUSTOM_PREFIX}${list.join("+")}`;
}

/**
 * URL から来たカスタムの値を、既知のリージョンコードだけに揃える (AC-017)。
 * 固定リストの限定集合 (AC-011) と違い、こちらは閲覧者が URL に書いた値なので、
 * region-notes.json に無いコードは落として報告する (黙って限定を緩めない)。
 */
export function normalizeCustomLimit(value, known = []) {
  const codes = customLimitCodes(value);
  const kept = codes.filter((code) => known.includes(code));
  const dropped = codes.filter((code) => !known.includes(code));
  return { value: customLimitValue(kept), codes: kept, dropped };
}

/**
 * 好みの並びを先に、そこに無いコードを昇順で後ろに置く (AC-020)。
 * 一覧は固定しない。並べたいものだけを preference に書く。
 */
function orderByPreference(codes, preference, { last = [] } = {}) {
  const rank = (code) => {
    if (last.includes(code)) return 2;
    return preference.includes(code) ? 0 : 1;
  };
  return [...new Set(codes ?? [])].sort((a, b) => {
    const rankA = rank(a);
    const rankB = rank(b);
    if (rankA !== rankB) return rankA - rankB;
    if (rankA === 0) return preference.indexOf(a) - preference.indexOf(b);
    return a.localeCompare(b);
  });
}

/**
 * 地理圏コードの表示順 (REGIONS-001 AC-004 / カスタムのピッカー)。
 * jp → apac → eu → us → au → 残りを昇順 → other。
 */
export function orderGeoCodes(codes) {
  return orderByPreference(codes, GEO_ORDER_PREFERENCE, { last: [UNGROUPED_GEO] });
}

/** 国コードの表示順 (FILTER-001 UI Description)。jp → us → au → 残りを昇順。 */
function orderCountryCodes(codes) {
  return orderByPreference(codes, COUNTRY_ORDER_PREFERENCE);
}

/**
 * 地理圏コードの一覧 (D-012 / AC-020)。固定リストを持たず、2 つのデータ源の和集合から作る。
 *  1. profiles.json の接頭辞のうち `global` 以外 (ca / in など新しい接頭辞も自動で入る)
 *  2. region-notes.json の geo の実値 (プロファイルが 1 件も取れていない地理圏を拾う)
 * どの地理圏にも属さない `other` は地理圏ではないので含めない。
 */
export function geoCodes({ regionNotes, profiles } = {}) {
  const codes = new Set();
  for (const profile of Object.values(profiles ?? {})) {
    const prefix = profile?.prefix;
    if (typeof prefix !== "string" || prefix.length === 0) continue;
    if (prefix === GLOBAL_PREFIX) continue;
    codes.add(prefix);
  }
  for (const code of allRegionCodes(regionNotes)) {
    const geo = regionNotes?.[code]?.geo;
    if (typeof geo !== "string" || geo.length === 0 || geo === UNGROUPED_GEO) continue;
    codes.add(geo);
  }
  return orderGeoCodes([...codes]);
}

/**
 * 推論先の限定に国の選択肢を出す国コード (AC-018 / UI Description)。
 * 地理圏コードは国コードと同じ綴りで名乗る (`jp` / `us` / `au` / `ca` / `in`) ので、
 * 「地理圏として存在し、かつ region-notes.json に country として現れる」コードを国の候補にする。
 * 固定リストは持たないので、新しい地理圏が増えれば国の選択肢も自動で増える。
 */
export function countryCodes({ regionNotes, profiles } = {}) {
  const countries = new Set(
    allRegionCodes(regionNotes)
      .map((code) => regionNotes?.[code]?.country)
      .filter((country) => typeof country === "string" && country.length > 0),
  );
  return orderCountryCodes(
    geoCodes({ regionNotes, profiles }).filter((code) => countries.has(code)),
  );
}

/**
 * カスタムのピッカーに並べる地理圏ごとのリージョン (AC-012 / AC-013)。
 * 区分は region-notes.json の geo の実値。固定表は持たず、データのキーから作る。
 * 並びは orderGeoCodes (other が末尾)。
 */
export function customRegionGroups(regionNotes) {
  const byGeo = new Map();
  for (const code of allRegionCodes(regionNotes)) {
    const geo = regionNotes?.[code]?.geo ?? UNGROUPED_GEO;
    if (!byGeo.has(geo)) byGeo.set(geo, []);
    byGeo.get(geo).push(code);
  }
  return orderGeoCodes([...byGeo.keys()]).map((geo) => ({ geo, regions: byGeo.get(geo) }));
}

/** 表示中のデータに実際に現れる providerName の一覧 (AC-001)。固定表は持たない。 */
export function providerOptions(rows) {
  return [...new Set((rows ?? []).map((row) => row.provider).filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );
}

/** 国コード (region-notes.json の country) に属するリージョン。昇順。 */
export function regionsByCountry(regionNotes, country) {
  return regionCodes(regionNotes)
    .filter((code) => regionNotes[code]?.country === country)
    .sort();
}

/**
 * 地理圏グループ (AC-006)。ハードコードした固定表は持たず、2 つのデータ源の和集合を取る。
 *  1. profiles.json の同じ接頭辞を持つプロファイルの destination 全件
 *  2. region-notes.json で geo がその接頭辞のリージョン
 * 1 だけだと未取得の起点のプロファイルが欠けて集合が狭くなり、2 だけだと
 * `apac.` の destination に含まれる ap-northeast-1/3 (geo は jp) が落ちる。
 * region-notes.json に無いリージョンコードも落とさずそのまま残す (AC-011)。
 */
export function geoGroupRegions(regionNotes, profiles, geo) {
  const set = new Set(regionCodes(regionNotes).filter((code) => regionNotes[code]?.geo === geo));
  for (const profile of Object.values(profiles ?? {})) {
    if (profile?.prefix !== geo) continue;
    for (const destinations of Object.values(profile.sources ?? {})) {
      for (const destination of destinations ?? []) {
        // Global の "*" は集合に入れない (限定集合はリージョンの集合であるべき)。
        if (destination !== "*") set.add(destination);
      }
    }
  }
  return [...set].sort();
}

/** 2 つの限定集合が同じリージョンの集合か (順序は問わない)。 */
function sameRegions(a, b) {
  const left = [...new Set(a ?? [])].sort();
  const right = [...new Set(b ?? [])].sort();
  return left.length === right.length && left.every((code, index) => code === right[index]);
}

/**
 * セレクタの選択肢 (AC-005 / AC-006 / AC-018)。1 つの平坦なリストで、
 * 「制限なし」→ 国 (jp / us / au) → 国と集合が重ならない地理圏 → 「カスタム…」の順。
 *
 * 国と地理圏は同じリージョンの集合になることがある (日本・米国など)。集合が同じ選択肢は
 * 閲覧者から区別できないので、後から来た地理圏を落として国の選択肢に畳む。落とした値は
 * 残った選択肢の `aliases` に持ち、URL の `limit=geo:jp` のような既存のリンクが
 * 同じ集合で開けるようにする (AC-019)。
 *
 * value は SHARE-001 の `limit` パラメータの値そのもの。
 */
export function buildLimitOptions({ regionNotes, profiles } = {}) {
  const candidates = [
    ...countryCodes({ regionNotes, profiles }).map((code) => ({
      value: `country:${code}`,
      kind: "country",
      code,
      labelKey: `filter.country.${code}`,
      regions: regionsByCountry(regionNotes, code),
    })),
    ...orderByPreference(
      geoCodes({ regionNotes, profiles }),
      LIMIT_GEO_ORDER_PREFERENCE,
    ).map((code) => ({
      value: `geo:${code}`,
      kind: "geo",
      code,
      labelKey: `filter.geo.${code}`,
      regions: geoGroupRegions(regionNotes, profiles, code),
    })),
  ];

  const kept = [];
  for (const candidate of candidates) {
    const twin = kept.find((option) => sameRegions(option.regions, candidate.regions));
    // 同じ集合なら先に入った方 (= 国) のラベルを残し、値だけ別名として引き継ぐ。
    if (twin) twin.aliases.push(candidate.value);
    else kept.push({ ...candidate, aliases: [] });
  }

  return [
    {
      value: NO_LIMIT,
      kind: "none",
      code: null,
      labelKey: "filter.limitNone",
      regions: null,
      aliases: [],
    },
    ...kept,
    // 末尾がカスタム (AC-012)。集合は選択のたびに値そのものへ書き込むので、
    // ここでは空にしておく。
    {
      value: CUSTOM_LIMIT,
      kind: "custom",
      code: null,
      labelKey: "filter.limitCustom",
      regions: [],
      aliases: [],
    },
  ];
}

/** 値から選択肢を引く。畳まれた値 (`geo:jp` など) は残った選択肢に解決する (AC-019)。 */
export function limitOption(options, value) {
  return (
    (options ?? []).find(
      (option) => option.value === value || (option.aliases ?? []).includes(value),
    ) ?? null
  );
}

/** 畳まれた値を残った選択肢の値に直す。選択肢に無い値は null (AC-019)。 */
export function canonicalLimitValue(options, value) {
  if (isCustomLimit(value)) return String(value);
  return limitOption(options, value)?.value ?? null;
}

export function isValidLimit(options, value) {
  return isCustomLimit(value) || limitOption(options, value) != null;
}

/** 限定集合 L。制限なし / 空のカスタム集合 / 未知の値は null (= 限定しない)。 */
export function limitRegionSet(options, value) {
  // カスタムは集合を値そのものが持つ (AC-012)。空集合は限定しない (AC-015)。
  if (isCustomLimit(value)) {
    const codes = customLimitCodes(value);
    return codes.length === 0 ? null : new Set(codes);
  }
  const option = limitOption(options, value);
  if (!option || option.kind === "none") return null;
  return new Set(option.regions);
}

/**
 * destination の集合が限定集合 L に収まるか (AC-005 / AC-006 / AC-008)。
 * `["*"]` (Global) は「全対応リージョン、今後増えうる」なのでどの L でも満たさない。
 * 判定はプロファイルの接頭辞ではなく destination の包含で行う。
 */
export function satisfiesLimit(destinations, limitRegions) {
  if (!limitRegions) return true;
  const list = destinations ?? [];
  if (list.length === 0) return false;
  if (list.includes("*")) return false;
  return list.every((destination) => limitRegions.has(destination));
}

/** In-Region の推論先は起点 R 自身だけ。R ∈ L なら満たす (AC-007)。 */
function inRegionSatisfiesLimit(region, limitRegions) {
  if (!limitRegions) return true;
  return limitRegions.has(region);
}

/** 3 区分のいずれかが「可」か (AC-004)。bedrock-mantle だけで呼べる場合も数える (D-021)。 */
export function isCallable(row) {
  const mantle = ["inRegion", "geo", "global"].some((lane) => row.endpoints?.[lane]?.mantle === true);
  return row.inRegion === true || (row.geo?.length ?? 0) > 0 || row.global != null || mantle;
}

function matchesModality(row, modalities) {
  const all = [...(row.input ?? []), ...(row.output ?? [])];
  return modalities.some((modality) => all.includes(modality));
}

function matchesQuery(row, query) {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;
  return (
    String(row.modelId ?? "").toLowerCase().includes(needle) ||
    String(row.name ?? "").toLowerCase().includes(needle)
  );
}

/**
 * 行にセルごとの「限定を満たすか」の印を付ける。行は書き換えず浅いコピーを返す。
 * 限定が無いときは active: false で、すべて満たす扱いにする (印を出さない)。
 */
export function annotateRow(row, { region, limitRegions = null } = {}) {
  const active = limitRegions != null;
  const geo = Object.fromEntries(
    (row.geo ?? []).map((entry) => [
      entry.profileId,
      active ? satisfiesLimit(entry.destinations, limitRegions) : true,
    ]),
  );
  // bedrock-mantle の In-Region も推論先は起点だけなので、同じ規則で数える (D-021)。
  const inRegionAvailable = row.inRegion === true || row.endpoints?.inRegion?.mantle === true;
  const inRegion = inRegionAvailable && inRegionSatisfiesLimit(region, limitRegions);
  // Global は destination が ["*"] なので、限定があるときは常に満たさない (AC-008)。
  const global = row.global != null && !active;
  const any = active
    ? inRegion || Object.values(geo).some(Boolean)
    : true;
  return { ...row, limit: { active, inRegion, geo, global, any } };
}

/**
 * 全条件の AND (AC-009)。返り値の rows は annotateRow 済み。
 * total は絞り込み前の行数で、件数表示「n 件 / 全 m 件」に使う。
 */
export function applyFilters(rows, filters = {}, { region, limitRegions = null } = {}) {
  const active = { ...DEFAULT_FILTERS, ...filters };
  const kept = [];
  for (const row of rows ?? []) {
    if (active.provider.length > 0 && !active.provider.includes(row.provider)) continue;
    if (active.modality.length > 0 && !matchesModality(row, active.modality)) continue;
    if (!matchesQuery(row, active.q ?? "")) continue;
    if (active.callable && !isCallable(row)) continue;
    const annotated = annotateRow(row, { region, limitRegions });
    // 限定が付いているとき、どの使い方でも満たせない行は落とす (AC-005)。
    if (limitRegions && !annotated.limit.any) continue;
    kept.push(annotated);
  }
  return { rows: kept, shown: kept.length, total: (rows ?? []).length };
}

/** 設定中の条件をチップ 1 個ずつに展開する (UI Description)。 */
export function activeConditions(filters = {}) {
  const active = { ...DEFAULT_FILTERS, ...filters };
  const chips = [];
  for (const provider of active.provider) chips.push({ param: "provider", value: provider });
  for (const modality of active.modality) chips.push({ param: "modality", value: modality });
  if ((active.q ?? "").trim() !== "") chips.push({ param: "q", value: active.q });
  if (active.callable) chips.push({ param: "callable", value: true });
  // 空のカスタム集合は「制限なし」と同じ意味なので条件に数えない (AC-015)。
  const emptyCustom = isCustomLimit(active.limit) && customLimitCodes(active.limit).length === 0;
  if (active.limit !== NO_LIMIT && !emptyCustom) {
    chips.push({ param: "limit", value: active.limit });
  }
  return chips;
}

/** チップの × で 1 条件だけを外した新しい状態を返す。 */
export function removeCondition(filters, { param, value }) {
  const active = { ...DEFAULT_FILTERS, ...filters };
  if (param === "provider" || param === "modality") {
    return { ...active, [param]: active[param].filter((entry) => entry !== value) };
  }
  if (param === "q") return { ...active, q: "" };
  if (param === "callable") return { ...active, callable: false };
  if (param === "limit") return { ...active, limit: NO_LIMIT };
  return active;
}
