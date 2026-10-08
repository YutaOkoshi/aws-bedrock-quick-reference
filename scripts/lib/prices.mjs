// AWS Price List Bulk API の生 JSON を data/prices.json の形に直す純関数群 (PRICE-001 / D-009)。
// I/O・時刻・ネットワークを持たない。ファイルの取得と書き出しは
// scripts/fetch-bedrock-prices.mjs が行う。

// 価格表の入口。認証不要で誰でも読める (D-009)。
export const PRICE_INDEX_URL = "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json";

// Bedrock の価格が載る offer code。AmazonBedrockService (予約 TPM) と
// AmazonBedrockAgentCore はトークン単価を持たないので対象外 (PRICE-001 AC-001)。
export const PRICE_OFFERS = Object.freeze(["AmazonBedrock", "AmazonBedrockFoundationModels"]);

export function priceFileUrl(offer, region) {
  return `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${offer}/current/${region}/index.json`;
}

export function regionIndexUrl(offer) {
  return `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/${offer}/current/region_index.json`;
}

// prices.json の source に残す出典。<region> は取得したリージョンコードで置き換わる。
export function sourceUrls() {
  return {
    index: PRICE_INDEX_URL,
    offers: Object.fromEntries(PRICE_OFFERS.map((offer) => [offer, priceFileUrl(offer, "<region>")])),
  };
}

// prices.json が持つ価格の種別 (PRICE-001 AC-004)。
// cacheRead / cacheWrite は入力側にしか単価が無いので output は持たない。
export const PRICE_KINDS = Object.freeze([
  "standard",
  "global",
  "batch",
  "cacheRead",
  "cacheWrite",
  "priority",
  "flex",
  // Global のバッチ・キャッシュ (2026-10-08 から取り込む)。
  "globalBatch",
  "globalCacheRead",
  "globalCacheWrite",
]);

// servicename から外す接尾辞。Anthropic / Cohere / TwelveLabs が付けている。
const EDITION_SUFFIX = /\s*\(Amazon Bedrock Edition\)\s*$/;

export function stripEdition(name) {
  return String(name ?? "").replace(EDITION_SUFFIX, "").trim();
}

// --- 単位の正規化 ---------------------------------------------------------

// すべて USD / 100 万トークンに揃える。1K tokens の単価は 1000 倍する (AC-004)。
export function toPerMillion(usd, unit) {
  const value = Number(usd);
  if (!Number.isFinite(value)) return null;
  // 単位の大文字小文字は揃っていない (Nova 2.5 Sonic は "1k tokens")
  const normalized = String(unit ?? "").toLowerCase();
  if (normalized === "1m tokens") return roundPrice(value);
  if (normalized === "1k tokens") return roundPrice(value * 1000);
  return null; // トークン以外の単位 (image / video / hour / Search Units …) は扱わない
}

// 小数 6 桁までで丸める。末尾の 0 は Number 化で落ちる。
export function roundPrice(value) {
  return Number(Number(value).toFixed(6));
}

// terms.OnDemand[sku][offerTermCode].priceDimensions[*] の最初の 1 件を読む。
export function priceOf(offerFile, sku) {
  const terms = offerFile?.terms?.OnDemand?.[sku];
  if (!terms) return null;
  for (const term of Object.values(terms)) {
    for (const dimension of Object.values(term?.priceDimensions ?? {})) {
      const usd = dimension?.pricePerUnit?.USD;
      if (usd == null) continue;
      return { usd, unit: dimension.unit };
    }
  }
  return null;
}

// トークン以外のオンデマンド推論料金を単位付きで保持する。
export function meteredPriceOf(product, price) {
  if (!price || !Number.isFinite(Number(price.usd)) || Number(price.usd) < 0) return null;
  const a = product.attributes ?? {};
  const usage = a.usagetype ?? "";
  if (/custom|provision|batch|storage|training|DataAutomation|Guardrail/i.test(usage)) return null;
  const dimension = bfmDimension(usage) ?? a.inferenceType ?? usagetypeBody(usage);
  const lower = dimension.toLowerCase();
  let unit, axis, label;
  if (price.unit === "Search Units") {
    unit = "searchUnit"; axis = "input"; label = "Rerank";
  } else if (["Input Images", "Images Processed"].includes(price.unit)) {
    unit = "image"; axis = "input"; label = a.modality || "Image";
  } else if (price.unit === "Text Requests") {
    unit = "request"; axis = "input"; label = "Text";
  } else if (price.unit === "image") {
    unit = "image"; axis = "output";
    label = a.inferenceType ?? "Image";
  } else if (price.unit === "seconds" || (price.unit === "video" && a.model === "Nova Reel")) {
    unit = "second";
    axis = /(^input|-input-)/.test(lower) ? "input" : "output";
    label = lower.includes("audio") ? "Audio" : lower.includes("hdres") || lower.includes("hd resolution")
      ? "Video · HD" : lower.includes("standardres") ? "Video · Standard" : "Video";
  } else return null;
  return { label, axis, unit, value: roundPrice(Number(price.usd)), scope: /global/i.test(usage) ? "global" : "standard" };
}

// --- 価格の軸と種別の判定 -------------------------------------------------

// 比較用に記号を落とした小文字。"Prompt cache read input tokens" → "promptcachereadinputtokens"
function flatten(text) {
  return String(text ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * 単価がどの軸のものかを決める。
 * input / output / cacheRead / cacheWrite のいずれでもないもの (1h キャッシュ、
 * 音声・画像・動画のトークン、Speech Understanding) は null を返して範囲外にする。
 */
export function axisOf(signal) {
  const flat = flatten(signal);
  if (!flat) return null;
  // cache 系は "input" を含むので先に判定する。
  // 1h TTL のキャッシュ書き込みは既定 (5 分) と別単価なので v1 では扱わない。
  if (flat.includes("cachewrite")) return flat.includes("1h") ? null : "cacheWrite";
  if (flat.includes("cacheread")) return "cacheRead";
  if (flat.includes("speechunderstanding")) return null;
  if (/(audio|image|video)token/.test(flat)) return null;
  if (flat.includes("input")) return "input";
  if (flat.includes("output")) return "output";
  return null;
}

// 種別を決める旗。global は「世界中で推論する使い方」の単価、
// batch / priority / flex はサービス階層。
function tierFlags({ global, batch, priority, flex }) {
  return { global: global === true, batch: batch === true, priority: priority === true, flex: flex === true };
}

/**
 * 軸と旗から prices.json の種別を決める (AC-004)。
 * Global と batch / priority / flex の組み合わせは v1 の範囲外 (null を返す)。
 */
export function kindOf(axis, flags) {
  if (axis == null) return null;
  const { global, batch, priority, flex } = tierFlags(flags);
  if (axis === "cacheRead" || axis === "cacheWrite") {
    // キャッシュは標準階層の単価だけを載せる。Global のキャッシュは別の種別にする。
    if (batch || priority || flex) return null;
    return global ? (axis === "cacheRead" ? "globalCacheRead" : "globalCacheWrite") : axis;
  }
  // Global のバッチは別の種別。Global と priority / flex の組み合わせは範囲外。
  if (global) return priority || flex ? null : batch ? "globalBatch" : "global";
  if (batch) return "batch";
  if (priority) return "priority";
  if (flex) return "flex";
  return "standard";
}

const WORD = (word) => new RegExp(`(^|[^a-z])${word}([^a-z]|$)`);

// v1 の範囲外の SKU。latency optimized とカスタムモデルは標準の単価と別建てで、
// 表にも詳細パネルにも出さない (AC-004 Notes)。
const OUT_OF_SCOPE_USAGETYPE = /latency-?optimized|custom-model/i;

// 長文コンテキスト (long_ctx) の SKU。standard / global の入出力だけを longContext として読み、
// キャッシュの long_ctx は範囲外にする。境界のトークン数は価格表に無い。
const LONG_CONTEXT_USAGETYPE = /long_ctx/i;

export function longContextKind(kind) {
  return kind === "standard" || kind === "global" ? kind : null;
}

/**
 * AmazonBedrock の product 1 件を読む。
 * 軸は inferenceType (空なら usagetype) から、旗は usagetype / service_tier / feature から取る。
 */
export function readBedrockProduct(product) {
  const attributes = product?.attributes ?? {};
  const usagetype = String(attributes.usagetype ?? "");
  const lower = usagetype.toLowerCase();
  const tier = String(attributes.service_tier ?? "").toLowerCase();
  const feature = String(attributes.feature ?? "").toLowerCase();

  const axis = axisOf(attributes.inferenceType || usagetypeTail(usagetype));
  const flags = {
    global: lower.includes("cross-region-global") || tier.startsWith("global"),
    batch: WORD("batch").test(lower) || tier === "batch" || feature.includes("batch"),
    priority: WORD("priority").test(lower) || tier.endsWith("priority"),
    flex: WORD("flex").test(lower) || tier.endsWith("flex"),
  };

  const longContext = LONG_CONTEXT_USAGETYPE.test(usagetype);
  const kind = OUT_OF_SCOPE_USAGETYPE.test(usagetype) ? null : kindOf(axis, flags);
  return {
    // Mantle の接続先の SKU。Runtime とは別の単価として mantle の下に置く。
    mantle: lower.includes("-mantle-"),
    sourceName: attributes.model ? String(attributes.model) : null,
    // model 属性を持たない SKU (Titan 系) は usagetype から引ける鍵を作る。
    fallbackKey: attributes.model ? null : `usagetype:${usagetypeKey(usagetype)}`,
    axis,
    kind: longContext ? longContextKind(kind) : kind,
    ...(longContext ? { longContext: true } : {}),
  };
}

// model 属性を持たない SKU の鍵。"APN1-TitanEmbeddingV2-Text-input-tokens" → "TitanEmbeddingV2-Text"
export function usagetypeKey(usagetype) {
  return usagetypeBody(usagetype)
    .replace(/-(input|output|cache|speech)[a-z0-9.-]*$/i, "")
    .trim();
}

// リージョン接頭辞 (APN1- / USE1- …) を落とした残り。
function usagetypeBody(usagetype) {
  return String(usagetype ?? "").replace(/^[A-Z0-9]+-/, "");
}

// 軸の判定に使う、usagetype の末尾 (寸法) 部分。
function usagetypeTail(usagetype) {
  const body = usagetypeBody(usagetype);
  const match = /-((?:input|output|cache|text|speech)[a-z0-9.-]*)$/i.exec(body);
  return match ? match[1] : body;
}

// BFM の usagetype は "<LOC>-MP:<LOC>_<dimension>-Units" の形。
export function bfmDimension(usagetype) {
  const match = /^[^-]+-MP:[^_]+_(.+)-Units$/.exec(String(usagetype ?? ""));
  return match ? match[1] : null;
}

/**
 * AmazonBedrockFoundationModels の product 1 件を読む。
 * model 属性が無く、モデル名は servicename、軸と階層は usagetype に入っている。
 */
export function readFoundationProduct(product) {
  const attributes = product?.attributes ?? {};
  const dimension = bfmDimension(attributes.usagetype);
  const lower = String(dimension ?? "").toLowerCase();
  const axis = axisOf(dimension);
  const flags = {
    global: lower.includes("global"),
    batch: lower.includes("batch"),
    priority: lower.includes("priority"),
    flex: lower.includes("flex"),
  };
  const longContext = LONG_CONTEXT_USAGETYPE.test(attributes.usagetype ?? "");
  const kind = OUT_OF_SCOPE_USAGETYPE.test(attributes.usagetype ?? "") ? null : kindOf(axis, flags);
  return {
    mantle: false,
    sourceName: attributes.servicename ? stripEdition(attributes.servicename) : null,
    fallbackKey: null,
    axis,
    kind: longContext ? longContextKind(kind) : kind,
    ...(longContext ? { longContext: true } : {}),
  };
}

export function readProduct(offer, product) {
  return offer === "AmazonBedrockFoundationModels"
    ? readFoundationProduct(product)
    : readBedrockProduct(product);
}

// --- モデル名 → モデル ID の対応 -----------------------------------------

/**
 * models.json の name から引ける索引 (AC-005 の自動一致)。
 * 同じ name のモデル ID が複数あるとき (Nova Pro の文脈長違いなど) は全件返す。
 */
export function buildNameIndex(models) {
  const index = new Map();
  const add = (key, modelId) => {
    if (!key) return;
    if (!index.has(key)) index.set(key, []);
    if (!index.get(key).includes(modelId)) index.get(key).push(modelId);
  };
  for (const [modelId, model] of Object.entries(models ?? {})) {
    add(flatten(model?.name), modelId);
    // 価格表の名前にプロバイダ名が付くもの ("OpenAI GPT-6 Astra") と、
    // model 属性がモデル ID そのもの ("xai.grok-4.6") のものも引けるようにする。
    if (model?.provider && model?.name) add(flatten(`${model.provider} ${model.name}`), modelId);
    add(flatten(modelId), modelId);
  }
  for (const list of index.values()) list.sort();
  return index;
}

/**
 * 価格表のモデル名から models.json のモデル ID を引く (AC-005)。
 * 1. 手書きの data/price-model-map.json を先に見る
 * 2. 無ければ name の大文字小文字と記号を無視した一致
 *
 * 返り値は モデル ID の配列 / `[]` (地図に null と書いた = models.json に該当が無いと
 * 確認済み) / `null` (未マッピング。メンテナが地図に足す対象)。
 */
export function resolveModelIds(sourceKey, { nameIndex, map = {} } = {}) {
  if (!sourceKey) return null;
  if (Object.prototype.hasOwnProperty.call(map, sourceKey)) {
    const mapped = map[sourceKey];
    if (mapped == null) return []; // 該当モデルが models.json に無いと確認済み
    const list = Array.isArray(mapped) ? mapped : [mapped];
    return [...list.filter((id) => typeof id === "string" && id.length > 0)].sort();
  }
  const hit = nameIndex?.get(flatten(sourceKey));
  return hit && hit.length > 0 ? [...hit] : null;
}

// --- 正規化 ---------------------------------------------------------------

function setPrice(bucket, kind, axis, value) {
  const slot = (bucket[kind] ??= {});
  // 同じ種別・同じ軸に 2 つ目の単価が来たら安い方を採らず、先に読んだ方を残す。
  // (価格表の重複は SKU の入れ替え時にだけ起きるため、静かに上書きしない)
  if (slot[axis] == null) slot[axis] = value;
}

// 1 つの接続先 (Runtime / Mantle) の単価を種別ごとに並べ直す。
// long_ctx だけで標準の SKU が無い種別も longContext だけを持つ種別として残す。
function sortKinds(bucket) {
  const kinds = {};
  for (const kind of PRICE_KINDS) {
    const base = bucket[kind];
    const longContext = bucket.longContext?.[kind];
    if (!base && !longContext) continue;
    kinds[kind] = sortObject(base ?? {});
    if (longContext) kinds[kind].longContext = sortObject(longContext);
  }
  if (bucket.metered) kinds.metered = bucket.metered.sort((a, b) => a.axis.localeCompare(b.axis) || a.label.localeCompare(b.label) || a.value - b.value);
  return kinds;
}

// --- AWS Marketplace の offer による補完 (D-018) ---------------------------

// bedrock-runtime の単価の種別。mantle の下は含めない。
const RUNTIME_KINDS = Object.freeze([...PRICE_KINDS, "metered"]);

function hasRuntimePrice(regions) {
  return Object.values(regions ?? {}).some((entry) => RUNTIME_KINDS.some((kind) => entry?.[kind]));
}

// In-Region / Geo の単価 (global 以外) を当てる種別。
const REGIONAL_KINDS = Object.freeze(PRICE_KINDS.filter((kind) => !kind.startsWith("global")));

/**
 * Price List の usagetype の先頭 (APN1- / USE1- / MP:USE1_) と regionCode を対にした索引。
 * Marketplace の rateCard の略号 (APN1_input_tokens_standard) をリージョンに戻すのに使う。
 */
export function buildPrefixIndex(files) {
  const index = {};
  for (const byRegion of Object.values(files ?? {})) {
    for (const file of Object.values(byRegion ?? {})) {
      for (const product of Object.values(file?.products ?? {})) {
        const { usagetype, regionCode } = product?.attributes ?? {};
        const match = /^([A-Z]{2,4}\d)-/.exec(String(usagetype ?? ""));
        if (match && regionCode && !index[match[1]]) index[match[1]] = regionCode;
      }
    }
  }
  return Object.fromEntries(Object.entries(index).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * Price List に bedrock-runtime の単価が 1 つも無いモデルだけ、Marketplace の offer の単価で埋める。
 * Price List に単価があるモデルは触らない (Price List を優先する)。埋めたリージョンには
 * `source: { type: "marketplace", offerId }` を付け、prices.marketplace に対象モデルを記録する。
 *
 * リージョンの区別が無い単価は、そのモデルを使えるリージョンに当てる:
 * global は Global のプロファイルの起点、それ以外は models.json の availability が ON_DEMAND のリージョンか Geo のプロファイルの起点。
 * 略号付きの単価は prefixIndex で引いたリージョンに当てる。どちらも regions (取得対象) に限る。
 */
export function applyMarketplacePrices(prices, { marketplace, models, profiles, regions, prefixIndex }) {
  if (!marketplace?.byModel) return prices;
  const target = new Set(regions ?? []);
  const applied = [];
  prices.byModel ??= {};

  for (const [modelId, offer] of Object.entries(marketplace.byModel)) {
    if (!models?.[modelId] || hasRuntimePrice(prices.byModel[modelId])) continue;

    // In-Region (ON_DEMAND) か Geo のプロファイルの起点だけが、標準系の単価を使えるリージョン。
    // availability の INFERENCE_PROFILE は Global 経由でしか呼べない場合も含むので数えない。
    const regional = new Set(
      Object.entries(models[modelId].availability ?? {})
        .filter(([, types]) => Array.isArray(types) && types.includes("ON_DEMAND"))
        .map(([region]) => region),
    );
    const global = new Set();
    for (const [profileId, profile] of Object.entries(profiles ?? {})) {
      if (profile?.modelId !== modelId) continue;
      for (const region of Object.keys(profile.sources ?? {})) (profileId.startsWith("global.") ? global : regional).add(region);
    }

    const fills = {}; // region -> kinds
    const put = (region, kind, values) => {
      if (!target.has(region) || !values) return;
      const bucket = (fills[region] ??= {});
      bucket[kind] = kind === "metered" ? [...values] : JSON.parse(JSON.stringify(values));
    };
    for (const [kind, values] of Object.entries(offer.kinds ?? {})) {
      const where = kind.startsWith("global") ? global : REGIONAL_KINDS.includes(kind) || kind === "metered" ? regional : new Set();
      for (const region of where) put(region, kind, values);
    }
    for (const [prefix, kinds] of Object.entries(offer.byPrefix ?? {})) {
      const region = prefixIndex?.[prefix];
      if (!region) continue;
      for (const [kind, values] of Object.entries(kinds)) put(region, kind, values);
    }
    if (Object.keys(fills).length === 0) continue;

    const entries = (prices.byModel[modelId] ??= {});
    for (const region of Object.keys(fills).sort()) {
      const entry = (entries[region] ??= {});
      const { mantle } = entry;
      const merged = sortKinds({ ...fills[region] });
      for (const key of Object.keys(entry)) delete entry[key];
      Object.assign(entry, merged);
      if (mantle) entry.mantle = mantle;
      entry.source = { type: "marketplace", offerId: offer.offerId ?? null };
    }
    prices.byModel[modelId] = Object.fromEntries(Object.entries(entries).sort(([a], [b]) => a.localeCompare(b)));
    applied.push(modelId);
  }

  if (applied.length > 0) {
    prices.marketplace = { fetchedAt: marketplace.fetchedAt ?? null, models: applied.sort() };
    prices.byModel = Object.fromEntries(Object.entries(prices.byModel).sort(([a], [b]) => a.localeCompare(b)));
  }
  return prices;
}

/**
 * 安全弁: 価格のあるモデルが前回の半分未満なら、理由の文字列を返す (書き出さない)。
 * 価格表の書式変更でパースが空振りしたときに、価格の消えたページを公開しないため。
 * 前回が無ければ (初回) null。
 */
export function checkPriceGuard(previous, next) {
  const before = Object.keys(previous?.byModel ?? {}).length;
  const after = Object.keys(next?.byModel ?? {}).length;
  if (before === 0 || after * 2 >= before) return null;
  return `models with a price dropped from ${before} to ${after} (less than half). prices.json was not written.`;
}

function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)));
}

/**
 * 取得した offer ファイル群から data/prices.json を作る (AC-004)。
 *
 * @param {object} args
 * @param {object} args.files  { "<offer>": { "<region>": <生 JSON> } }
 * @param {object} args.models data/models.json
 * @param {object} args.map    data/price-model-map.json
 * @param {string} args.generatedAt 取得日時 (呼び出し側が渡す。ここは時計を読まない)
 */
export function normalizePrices({ files, models, map = {}, generatedAt }) {
  const nameIndex = buildNameIndex(models);
  const byModel = {};
  const known = new Set(Object.keys(models ?? {}));
  const unmapped = new Map();
  let outOfScope = 0;
  let ignored = 0;
  let publicationDate = null;

  for (const offer of PRICE_OFFERS) {
    for (const [region, file] of Object.entries(files?.[offer] ?? {})) {
      if (file?.publicationDate && (publicationDate == null || file.publicationDate > publicationDate)) {
        publicationDate = file.publicationDate;
      }
      for (const product of Object.values(file?.products ?? {})) {
        const read = readProduct(offer, product);
        const price = priceOf(file, product.sku);
        const perMillion = price ? toPerMillion(price.usd, price.unit) : null;
        const metered = perMillion == null ? meteredPriceOf(product, price) : null;
        if (perMillion == null && !metered) {
          // 単価が読めない単位 (Units / hour など)。表にも詳細にも出さない。
          outOfScope += 1;
          continue;
        }
        if (read.kind == null && !metered) {
          outOfScope += 1;
          continue;
        }

        const sourceKey = read.sourceName ?? read.fallbackKey;
        const resolved = resolveModelIds(sourceKey, { nameIndex, map });
        // 地図が models.json に無い ID (API から消えたモデル) を指していても書き出さない。
        const modelIds = resolved && models ? resolved.filter((id) => known.has(id)) : resolved;
        if (Array.isArray(modelIds) && modelIds.length === 0) {
          // 地図に null と書いてある = models.json に該当モデルが無いと確認済み。
          ignored += 1;
          continue;
        }
        if (!modelIds && read.mantle) {
          // Mantle 専用で models.json (bedrock-runtime) に無いモデル。地図の対象ではない。
          outOfScope += 1;
          continue;
        }
        if (!modelIds) {
          const key = sourceKey ?? `sku:${product.sku}`;
          if (!unmapped.has(key)) {
            unmapped.set(key, { name: key, offer, count: 0, example: product.attributes?.usagetype ?? null });
          }
          unmapped.get(key).count += 1;
          continue;
        }

        const axis = read.axis === "cacheRead" || read.axis === "cacheWrite" ? "input" : read.axis;
        for (const modelId of modelIds) {
          // Runtime と Mantle は別の接続先で、単価も別に決まる (Qwen3 Next 80B は値が違う)。
          // Mantle の SKU は mantle の下に置き、Runtime の単価には混ぜない。
          const regions = (byModel[modelId] ??= {});
          const entry = (regions[region] ??= {});
          const bucket = read.mantle ? (entry.mantle ??= {}) : entry;
          if (read.longContext) {
            setPrice((bucket.longContext ??= {}), read.kind, axis, perMillion);
          } else if (metered) {
            const rates = bucket.metered ??= [];
            if (!rates.some((rate) => JSON.stringify(rate) === JSON.stringify(metered))) rates.push(metered);
          } else setPrice(bucket, read.kind, axis, perMillion);
        }
      }
    }
  }

  // キー順を揃えて差分を読みやすくする。
  const sorted = {};
  for (const modelId of Object.keys(byModel).sort()) {
    const regions = {};
    for (const region of Object.keys(byModel[modelId]).sort()) {
      const bucket = byModel[modelId][region];
      const kinds = sortKinds(bucket);
      if (bucket.mantle) {
        const mantle = sortKinds(bucket.mantle);
        if (Object.keys(mantle).length > 0) kinds.mantle = mantle;
      }
      regions[region] = kinds;
    }
    sorted[modelId] = regions;
  }

  const unmappedList = [...unmapped.values()].sort(
    (a, b) => b.count - a.count || a.name.localeCompare(b.name),
  );

  return {
    prices: {
      generatedAt,
      publicationDate,
      source: sourceUrls(),
      unmapped: unmappedList.length,
      outOfScope,
      ignored,
      byModel: sorted,
    },
    unmappedList,
  };
}
