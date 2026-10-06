// モデル別 Capabilities and Features の画面用の組み立て (FEATURE-001)。純関数。DOM を触らない。
// data/features.json の値は true / false / キーなし の 3 状態。「記載なし」を false に倒さない (D-003 と同じ方針)。

export const DOCS_BASE = "https://docs.aws.amazon.com/bedrock/latest/userguide/";

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
