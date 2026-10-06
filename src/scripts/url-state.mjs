// URL クエリと画面状態の相互変換 (SHARE-001)。純関数。DOM も history も触らない。
// 言語は URL に載せない (AC-006)。展開中の行も載せない (Spec Notes)。

import {
  DEFAULT_FILTERS,
  MODALITIES,
  NO_LIMIT,
  canonicalLimitValue,
  isCustomLimit,
  normalizeCustomLimit,
} from "./filter-model.mjs";
import { DEFAULT_SORT, SORT_VALUES } from "./bedrock-view-model.mjs";

export const DEFAULT_REGION = "ap-northeast-1";

// 画面ビュー (REGIONS-001 AC-001 / SHARE-001 AC-011)。既定は「起点から」。
export const VIEW_ORIGIN = "origin";
export const VIEW_REGIONS = "regions";
export const VIEW_VALUES = Object.freeze([VIEW_ORIGIN, VIEW_REGIONS]);
export const DEFAULT_VIEW = VIEW_ORIGIN;

// パラメータ名と並び順。URL の見た目を安定させるため配列で持つ。
export const PARAM_ORDER = Object.freeze([
  "view",
  "region",
  "sort",
  "provider",
  "modality",
  "q",
  "callable",
  "limit",
  // FEATURE-001: 表に出す機能列。null (= パラメータなし) は既定列、[] は機能列なし。
  "cols",
]);

export const DEFAULT_STATE = Object.freeze({
  view: DEFAULT_VIEW,
  region: DEFAULT_REGION,
  sort: DEFAULT_SORT,
  ...DEFAULT_FILTERS,
  cols: null,
});

const CALLABLE_ON = "1";

// モダリティの正当値は filter-model.mjs が正。
const MODALITY_VALUES = MODALITIES;

function splitList(value) {
  return String(value)
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

/**
 * location.search を状態に変換する (AC-002 / AC-004 / AC-007 / AC-008)。
 * 例外は投げない。解釈できない値だけを落として ignored に積み、残りは適用する。
 * region が未知のときは既定にフォールバックし、ignored に fallback: true で載せる。
 * limit は FILTER-001 の選択肢 (buildLimitOptions の返り値) で検査する。集合が同じで
 * 畳まれた値 (`geo:jp` など) は残った選択肢の値に直して適用する (FILTER-001 AC-019)。
 */
export function parseState(
  search,
  { regions = [], providers = [], limitOptions = [], featureKeys = [] } = {},
) {
  const params = new URLSearchParams(String(search ?? "").replace(/^\?/, ""));
  const state = { ...DEFAULT_STATE, provider: [], modality: [] };
  const ignored = [];

  // ビューと並び順 (AC-011 / AC-013)。値は 2 つずつで、それ以外は既定に倒して報告する。
  const view = params.get("view");
  if (view != null) {
    if (VIEW_VALUES.includes(view)) state.view = view;
    else ignored.push({ param: "view", value: view, fallback: true });
  }

  const sort = params.get("sort");
  if (sort != null) {
    if (SORT_VALUES.includes(sort)) state.sort = sort;
    else ignored.push({ param: "sort", value: sort, fallback: true });
  }

  const region = params.get("region");
  if (region != null) {
    if (regions.includes(region)) {
      state.region = region;
    } else {
      ignored.push({ param: "region", value: region, fallback: true });
    }
  }

  const provider = params.get("provider");
  if (provider != null) {
    const wanted = splitList(provider);
    state.provider = wanted.filter((entry) => providers.includes(entry));
    for (const entry of wanted) {
      if (!providers.includes(entry)) ignored.push({ param: "provider", value: entry });
    }
  }

  const modality = params.get("modality");
  if (modality != null) {
    const wanted = splitList(modality).map((entry) => entry.toUpperCase());
    state.modality = wanted.filter((entry) => MODALITY_VALUES.includes(entry));
    for (const entry of wanted) {
      if (!MODALITY_VALUES.includes(entry)) ignored.push({ param: "modality", value: entry });
    }
  }

  const q = params.get("q");
  if (q != null && q.trim() !== "") state.q = q;

  const callable = params.get("callable");
  if (callable != null) {
    if (callable === CALLABLE_ON || callable === "0") {
      state.callable = callable === CALLABLE_ON;
    } else {
      ignored.push({ param: "callable", value: callable });
    }
  }

  const limit = params.get("limit");
  if (limit != null) {
    if (isCustomLimit(limit)) {
      // custom:<code>+<code>... は固定リストに無いので、コードを 1 件ずつ検査する
      // (SHARE-001 AC-010)。region-notes.json に無いコードだけを落として報告する。
      const { value, dropped } = normalizeCustomLimit(limit, regions);
      state.limit = value;
      for (const code of dropped) ignored.push({ param: "limit", value: code });
    } else {
      const canonical = canonicalLimitValue(limitOptions, limit);
      if (canonical != null) state.limit = canonical;
      else ignored.push({ param: "limit", value: limit });
    }
  }

  // FEATURE-001: 機能列。features.json に無いキーは落として報告する (AC-008 と同じ)。
  const cols = params.get("cols");
  if (cols != null) {
    const wanted = splitList(cols);
    state.cols = wanted.filter((entry) => featureKeys.includes(entry));
    for (const entry of wanted) {
      if (!featureKeys.includes(entry)) ignored.push({ param: "cols", value: entry });
    }
  }

  return { state, ignored };
}

function sameList(a, b) {
  return a.length === b.length && a.every((entry, index) => entry === b[index]);
}

/**
 * 状態をクエリ文字列にする (AC-003 / AC-006)。既定値と同じ項目は省く。
 * 返り値は "?" を含まない。既定状態なら空文字列。
 */
export function serializeState(state = {}, { defaultCols = [] } = {}) {
  const merged = { ...DEFAULT_STATE, ...state };
  const params = new URLSearchParams();
  for (const name of PARAM_ORDER) {
    if (name === "view") {
      if (merged.view && merged.view !== DEFAULT_STATE.view) params.set("view", merged.view);
      continue;
    }
    if (name === "sort") {
      if (merged.sort && merged.sort !== DEFAULT_STATE.sort) params.set("sort", merged.sort);
      continue;
    }
    if (name === "region") {
      if (merged.region && merged.region !== DEFAULT_STATE.region) params.set("region", merged.region);
      continue;
    }
    if (name === "provider" || name === "modality") {
      const list = merged[name] ?? [];
      if (list.length > 0) params.set(name, [...list].join(","));
      continue;
    }
    if (name === "q") {
      if ((merged.q ?? "").trim() !== "") params.set("q", merged.q);
      continue;
    }
    if (name === "callable") {
      if (merged.callable === true) params.set("callable", CALLABLE_ON);
      continue;
    }
    if (name === "limit") {
      if (merged.limit && merged.limit !== NO_LIMIT) params.set("limit", merged.limit);
      continue;
    }
    if (name === "cols") {
      // null と既定と同じ並びは省く。[] は「機能列なし」なので cols= (空) で載せる。
      if (Array.isArray(merged.cols) && !sameList(merged.cols, defaultCols)) {
        params.set("cols", merged.cols.join(","));
      }
    }
  }
  return params.toString();
}

/**
 * 現在の URL にクエリだけを差し替えた絶対 URL (AC-005)。
 * GitHub Pages のサブパス配下で動くよう、パスは href のものをそのまま使い、
 * 先頭スラッシュの絶対パスを組み立てない (Spec Notes)。
 */
export function shareUrl(state, href, options) {
  const url = new URL(String(href));
  const query = serializeState(state, options);
  url.search = query === "" ? "" : `?${query}`;
  url.hash = "";
  return url.toString();
}

/** history に積むためのパス + クエリ。相対のまま返す。 */
export function searchString(state, options) {
  const query = serializeState(state, options);
  return query === "" ? "" : `?${query}`;
}
