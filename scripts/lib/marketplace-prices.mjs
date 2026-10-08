// AWS Marketplace の offer の単価表 (D-018) を正規化する純関数。I/O・時刻・ネットワークを持たない。
//
// 入力は Bedrock の ListFoundationModelAgreementOffers のレスポンス
// (`offers[].termDetails.usageBasedPricingTerm.rateCard[]` に { dimension, price, unit })。
// 単位は "Units" としか書かれないが、値は docs のモデルカードの「USD / 100 万トークン」と一致する
// (2026-10-08 に GPT-5.6 Terra / GPT-6 Luna / GPT-6 Astra で確認。docs/price-list-api.md)。

import { kindOf, longContextKind, PRICE_KINDS } from "./prices.mjs";

// [リージョン略号_]<軸>_tokens_[30m_|1h_|5m_][long_ctx_][global_]<階層>
const TOKEN_DIMENSION =
  /^(input|output|cached_input|cache_read|cache_writes|cache_write)_tokens_(?:(30m|1h|5m)_)?(long_ctx_)?(global_)?(standard|priority|flex|batch|ultrafast)$/;
const PREFIX = /^([A-Z]{2,4}\d)_(.+)$/;
const IMAGE_DIMENSION = /^CreatedImage([A-Za-z]+)$/;

const AXIS = {
  input: "input",
  output: "output",
  cached_input: "cacheRead",
  cache_read: "cacheRead",
  cache_writes: "cacheWrite",
  cache_write: "cacheWrite",
};

/**
 * rateCard の dimension 1 つを読む。範囲外 (ultrafast・1 時間 TTL・Global とバッチ等の組み合わせ・
 * キャッシュの long_ctx) と読めないものは null。種別の規則は Price List (kindOf) と同じにする。
 *
 * 戻り値: { prefix, kind, axis[, longContext] } または画像の課金 { prefix, image }
 */
export function parseDimension(dimension) {
  const prefixed = PREFIX.exec(String(dimension ?? ""));
  const prefix = prefixed ? prefixed[1] : null;
  const body = prefixed ? prefixed[2] : String(dimension ?? "");

  const image = IMAGE_DIMENSION.exec(body);
  if (image) return { prefix, image: image[1] };

  const match = TOKEN_DIMENSION.exec(body);
  if (!match) return null;
  const [, axisKey, ttl, longCtx, global, tier] = match;
  if (tier === "ultrafast" || ttl === "1h") return null;

  const axis = AXIS[axisKey];
  const kind = kindOf(axis, {
    global: Boolean(global),
    batch: tier === "batch",
    priority: tier === "priority",
    flex: tier === "flex",
  });
  if (longCtx) {
    const lcKind = longContextKind(kind);
    if (!lcKind || axis === "cacheRead" || axis === "cacheWrite") return null;
    return { prefix, kind: lcKind, axis, longContext: true };
  }
  if (!kind) return null;
  // キャッシュの単価は入力側の値として持つ (prices.json と同じ形)。
  return { prefix, kind, axis: axis === "cacheRead" || axis === "cacheWrite" ? "input" : axis };
}

// "RemoveBg" → ["remove", "bg"]
function camelWords(text) {
  return String(text).replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().split(/\s+/).filter(Boolean);
}

// "bg" は "background" の部分列。略語 (Bg) と語順の違い (UpscaleFast / Fast Upscale) を吸収する。
function isSubsequence(short, long) {
  let at = 0;
  for (const char of long) if (char === short[at]) at += 1;
  return at === short.length;
}

const NAME_STOPWORDS = new Set(["stable", "image", "and"]);

/**
 * 画像の dimension 名 (CreatedImage の後ろ) を、候補のモデル名と語で突き合わせる。
 * dimension の語がすべてモデル名のどれかの語の部分列で、当たる候補が 1 つだけのときに ID を返す。
 * 当たらない・複数当たるときは推測で結び付けず null。
 */
export function matchImageModel(key, candidates) {
  const words = camelWords(key);
  const hits = candidates.filter(({ name }) => {
    const nameWords = camelWords(name).filter((word) => !NAME_STOPWORDS.has(word));
    return words.every((word) => nameWords.some((nameWord) => nameWord.startsWith(word[0]) && isSubsequence(word, nameWord)));
  });
  return hits.length === 1 ? hits[0].id : null;
}

function setValue(bucket, kind, axis, value, longContext) {
  const slot = (bucket[kind] ??= {});
  const target = longContext ? (slot.longContext ??= {}) : slot;
  if (target[axis] == null) target[axis] = value;
}

// 種別の並びを PRICE_KINDS に揃える (差分を読みやすくする)。
function sortKinds(bucket) {
  const sorted = {};
  for (const kind of PRICE_KINDS) if (bucket[kind]) sorted[kind] = bucket[kind];
  if (bucket.metered) sorted.metered = bucket.metered;
  return sorted;
}

/**
 * モデル ID → ListFoundationModelAgreementOffers のレスポンス (無ければ null) から、
 * data/marketplace-prices.json の byModel を作る。
 *
 * byModel[M] = { offerId, kinds, byPrefix: { <略号>: kinds }, outOfScope }
 * kinds はリージョンの区別が無い単価、byPrefix はリージョンの略号付きの単価。
 * 画像の課金は、13 モデルで 1 つの offer を共有する Stability に合わせ、語で結び付いたモデルにだけ入れる。
 */
export function normalizeMarketplaceOffers(rawByModel, models) {
  const byModel = {};
  const unmatchedImages = new Set();
  const candidates = Object.entries(models ?? {}).map(([id, model]) => ({ id, name: model?.name ?? "" }));

  for (const modelId of Object.keys(rawByModel ?? {}).sort()) {
    const offer = rawByModel[modelId]?.offers?.[0];
    const rateCard = offer?.termDetails?.usageBasedPricingTerm?.rateCard;
    if (!Array.isArray(rateCard) || rateCard.length === 0) continue;

    const kinds = {};
    const byPrefix = {};
    let outOfScope = 0;
    for (const rate of rateCard) {
      const value = Number(rate?.price);
      const parsed = Number.isFinite(value) ? parseDimension(rate?.dimension) : null;
      if (!parsed) {
        outOfScope += 1;
        continue;
      }
      if (parsed.image) {
        const owner = matchImageModel(parsed.image, candidates);
        if (owner == null) unmatchedImages.add(parsed.image);
        if (owner !== modelId) continue;
      }
      const bucket = parsed.prefix ? (byPrefix[parsed.prefix] ??= {}) : kinds;
      if (parsed.image) {
        const metered = (bucket.metered ??= []);
        metered.push({ scope: "standard", label: "Image", axis: "output", unit: "image", value });
        continue;
      }
      setValue(bucket, parsed.kind, parsed.axis, value, parsed.longContext);
    }

    const sortedPrefix = {};
    for (const prefix of Object.keys(byPrefix).sort()) sortedPrefix[prefix] = sortKinds(byPrefix[prefix]);
    const entry = { offerId: offer.offerId ?? null, kinds: sortKinds(kinds), byPrefix: sortedPrefix, outOfScope };
    if (Object.keys(entry.kinds).length === 0 && Object.keys(entry.byPrefix).length === 0) continue;
    byModel[modelId] = entry;
  }
  return { byModel, unmatchedImages: [...unmatchedImages].sort() };
}
