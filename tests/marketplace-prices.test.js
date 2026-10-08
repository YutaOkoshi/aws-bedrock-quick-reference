// @vitest-environment node
// D-018: Price List に無いモデルの単価を AWS Marketplace の offer (Bedrock の
// ListFoundationModelAgreementOffers が返す rateCard) から取る。正規化の純関数を検証する。
import { describe, expect, it } from "vitest";

import {
  matchImageModel,
  normalizeMarketplaceOffers,
  parseDimension,
} from "../scripts/lib/marketplace-prices.mjs";
import { applyMarketplacePrices, buildPrefixIndex } from "../scripts/lib/prices.mjs";

const offer = (offerId, rows) => ({
  offers: [{ offerId, termDetails: { usageBasedPricingTerm: { rateCard: rows.map(([dimension, price]) => ({ dimension, price: String(price), unit: "Units", description: dimension })) } } }],
});

describe("parseDimension: rateCard の dimension を種別と軸にする", () => {
  it("リージョンの区別が無い標準と Global", () => {
    expect(parseDimension("input_tokens_standard")).toEqual({ prefix: null, kind: "standard", axis: "input" });
    expect(parseDimension("output_tokens_global_standard")).toEqual({ prefix: null, kind: "global", axis: "output" });
  });

  it("サービス階層とキャッシュ (Price List と同じ規則。Global とバッチ等の組み合わせは範囲外)", () => {
    expect(parseDimension("input_tokens_batch")).toMatchObject({ kind: "batch", axis: "input" });
    expect(parseDimension("output_tokens_priority")).toMatchObject({ kind: "priority", axis: "output" });
    expect(parseDimension("input_tokens_flex")).toMatchObject({ kind: "flex", axis: "input" });
    expect(parseDimension("cached_input_tokens_standard")).toMatchObject({ kind: "cacheRead", axis: "input" });
    expect(parseDimension("cache_read_tokens_standard")).toMatchObject({ kind: "cacheRead", axis: "input" });
    expect(parseDimension("cache_writes_tokens_standard")).toMatchObject({ kind: "cacheWrite", axis: "input" });
    expect(parseDimension("cache_write_tokens_30m_standard")).toMatchObject({ kind: "cacheWrite", axis: "input" });
    expect(parseDimension("input_tokens_global_batch")).toMatchObject({ kind: "globalBatch", axis: "input" });
    expect(parseDimension("cached_input_tokens_global_standard")).toMatchObject({ kind: "globalCacheRead", axis: "input" });
    expect(parseDimension("cache_writes_tokens_global_standard")).toMatchObject({ kind: "globalCacheWrite", axis: "input" });
    expect(parseDimension("input_tokens_global_priority")).toBeNull();
    expect(parseDimension("cached_input_tokens_flex")).toBeNull();
  });

  it("長文コンテキストは standard / global の longContext。キャッシュの long_ctx は範囲外", () => {
    expect(parseDimension("input_tokens_long_ctx_standard")).toEqual({ prefix: null, kind: "standard", axis: "input", longContext: true });
    expect(parseDimension("output_tokens_long_ctx_global_standard")).toEqual({ prefix: null, kind: "global", axis: "output", longContext: true });
    expect(parseDimension("cached_input_tokens_long_ctx_standard")).toBeNull();
  });

  it("ultrafast と 1 時間 TTL のキャッシュ書き込みは範囲外", () => {
    expect(parseDimension("input_tokens_ultrafast")).toBeNull();
    expect(parseDimension("cache_write_tokens_1h_standard")).toBeNull();
  });

  it("リージョンの略号が付いたもの (GPT-5.4 は APN1_input_tokens_standard の形)", () => {
    expect(parseDimension("APN1_input_tokens_standard")).toEqual({ prefix: "APN1", kind: "standard", axis: "input" });
  });

  it("画像 1 枚あたりの課金 (Stability)", () => {
    expect(parseDimension("USE1_CreatedImageRemoveBg")).toEqual({ prefix: "USE1", image: "RemoveBg" });
  });

  it("読めない dimension は null", () => {
    expect(parseDimension("something_else")).toBeNull();
  });
});

describe("matchImageModel: 画像の dimension 名とモデル名を語で突き合わせる", () => {
  const candidates = [
    ["stability.stable-image-remove-background-v1:0", "Stable Image Remove Background"],
    ["stability.stable-image-search-recolor-v1:0", "Stable Image Search and Recolor"],
    ["stability.stable-image-search-replace-v1:0", "Stable Image Search and Replace"],
    ["stability.stable-image-control-sketch-v1:0", "Stable Image Control Sketch"],
    ["stability.stable-image-control-structure-v1:0", "Stable Image Control Structure"],
    ["stability.stable-image-inpaint-v1:0", "Stable Image Inpaint"],
    ["stability.stable-outpaint-v1:0", "Stable Image Outpaint"],
    ["stability.stable-fast-upscale-v1:0", "Stable Image Fast Upscale"],
    ["stability.stable-conservative-upscale-v1:0", "Stable Image Conservative Upscale"],
  ].map(([id, name]) => ({ id, name }));

  it("略語や語順の違いがあっても 1 つに決まれば結び付ける", () => {
    expect(matchImageModel("RemoveBg", candidates)).toBe("stability.stable-image-remove-background-v1:0");
    expect(matchImageModel("Recolor", candidates)).toBe("stability.stable-image-search-recolor-v1:0");
    expect(matchImageModel("SearchReplace", candidates)).toBe("stability.stable-image-search-replace-v1:0");
    expect(matchImageModel("ControlSketch", candidates)).toBe("stability.stable-image-control-sketch-v1:0");
    expect(matchImageModel("Inpaint", candidates)).toBe("stability.stable-image-inpaint-v1:0");
    expect(matchImageModel("Outpaint", candidates)).toBe("stability.stable-outpaint-v1:0");
    expect(matchImageModel("UpscaleFast", candidates)).toBe("stability.stable-fast-upscale-v1:0");
  });

  it("1 つに決まらないもの・どれにも当たらないものは推測で結び付けない (null)", () => {
    expect(matchImageModel("Control", candidates)).toBeNull();
    expect(matchImageModel("Upscale", candidates)).toBeNull();
    expect(matchImageModel("Unknown", candidates)).toBeNull();
  });
});

describe("normalizeMarketplaceOffers: offer ごとの rateCard を models.json の ID ごとに正規化する", () => {
  const models = {
    "openai.gpt-5.6-terra": { provider: "OpenAI", name: "GPT-5.6 Terra" },
    "openai.gpt-5.4": { provider: "OpenAI", name: "GPT 5.4" },
    "stability.stable-image-inpaint-v1:0": { provider: "Stability AI", name: "Stable Image Inpaint" },
    "stability.stable-outpaint-v1:0": { provider: "Stability AI", name: "Stable Image Outpaint" },
  };

  it("リージョンの区別が無い単価は kinds、略号付きは byPrefix に入る。範囲外は数えて捨てる", () => {
    const raw = {
      "openai.gpt-5.6-terra": offer("offer-terra", [
        ["input_tokens_standard", 2.2], ["output_tokens_standard", 13.2],
        ["input_tokens_global_standard", 2], ["output_tokens_global_standard", 12],
        ["input_tokens_long_ctx_standard", 4.4], ["input_tokens_global_batch", 1], ["input_tokens_ultrafast", 9],
      ]),
      "openai.gpt-5.4": offer("offer-54", [["APN1_input_tokens_standard", 2.75], ["USE1_output_tokens_standard", 16.5]]),
    };
    const { byModel } = normalizeMarketplaceOffers(raw, models);
    expect(byModel["openai.gpt-5.6-terra"]).toEqual({
      offerId: "offer-terra",
      kinds: { standard: { input: 2.2, output: 13.2, longContext: { input: 4.4 } }, global: { input: 2, output: 12 }, globalBatch: { input: 1 } },
      byPrefix: {},
      outOfScope: 1,
    });
    expect(byModel["openai.gpt-5.4"]).toEqual({
      offerId: "offer-54",
      kinds: {},
      byPrefix: { APN1: { standard: { input: 2.75 } }, USE1: { standard: { output: 16.5 } } },
      outOfScope: 0,
    });
  });

  it("画像の課金は、語で結び付いたモデルにだけ metered として入る (13 モデルで 1 つの offer を共有する)", () => {
    const shared = offer("offer-stability", [["USE1_CreatedImageInpaint", 0.07], ["USW2_CreatedImageOutpaint", 0.06], ["USE1_CreatedImageUnknownThing", 1]]);
    const { byModel, unmatchedImages } = normalizeMarketplaceOffers(
      { "stability.stable-image-inpaint-v1:0": shared, "stability.stable-outpaint-v1:0": shared },
      models,
    );
    expect(byModel["stability.stable-image-inpaint-v1:0"].byPrefix).toEqual({
      USE1: { metered: [{ scope: "standard", label: "Image", axis: "output", unit: "image", value: 0.07 }] },
    });
    expect(byModel["stability.stable-outpaint-v1:0"].byPrefix).toEqual({
      USW2: { metered: [{ scope: "standard", label: "Image", axis: "output", unit: "image", value: 0.06 }] },
    });
    expect(unmatchedImages).toEqual(["UnknownThing"]);
  });

  it("offer が無い (Agreement not supported) モデルは載せない", () => {
    expect(normalizeMarketplaceOffers({ "x.y": null }, { "x.y": { name: "Y" } }).byModel).toEqual({});
  });
});

describe("applyMarketplacePrices: Price List に Runtime の単価が無いモデルだけ Marketplace の単価で埋める", () => {
  const models = {
    "openai.gpt-5.6-terra": { name: "GPT-5.6 Terra", availability: { "us-east-2": ["INFERENCE_PROFILE"] } },
    "openai.gpt-5.4": { name: "GPT 5.4", availability: {} },
    "anthropic.claude-sonnet-5": { name: "Claude Sonnet 5", availability: { "us-east-1": ["ON_DEMAND"] } },
  };
  const profiles = {
    "us.openai.gpt-5.6-terra": { modelId: "openai.gpt-5.6-terra", sources: { "us-east-2": ["us-east-1"] } },
    "global.openai.gpt-5.6-terra": { modelId: "openai.gpt-5.6-terra", sources: { "us-east-2": ["*"], "ap-northeast-1": ["*"] } },
  };
  const marketplace = {
    fetchedAt: "2026-10-08T00:00:00Z",
    byModel: {
      "openai.gpt-5.6-terra": { offerId: "offer-terra", kinds: { standard: { input: 2.2, output: 13.2 }, global: { input: 2, output: 12 } }, byPrefix: {} },
      "openai.gpt-5.4": { offerId: "offer-54", kinds: {}, byPrefix: { APN1: { standard: { input: 2.75 } }, EUC1: { standard: { input: 2.75 } } } },
      "anthropic.claude-sonnet-5": { offerId: "offer-s5", kinds: { standard: { input: 99, output: 99 } }, byPrefix: {} },
    },
  };
  const base = () => ({ byModel: { "anthropic.claude-sonnet-5": { "us-east-1": { standard: { input: 3.3, output: 16.5 } } } } });
  const regions = ["ap-northeast-1", "us-east-1", "us-east-2"];
  const prefixIndex = { APN1: "ap-northeast-1", USE1: "us-east-1", USE2: "us-east-2", EUC1: "eu-central-1" };

  it("標準は In-Region / Geo で使えるリージョン、Global は Global のプロファイルがあるリージョンに入り、出典を持つ", () => {
    const prices = applyMarketplacePrices(base(), { marketplace, models, profiles, regions, prefixIndex });
    const terra = prices.byModel["openai.gpt-5.6-terra"];
    expect(terra["us-east-2"]).toEqual({
      standard: { input: 2.2, output: 13.2 },
      global: { input: 2, output: 12 },
      source: { type: "marketplace", offerId: "offer-terra" },
    });
    expect(terra["ap-northeast-1"]).toEqual({ global: { input: 2, output: 12 }, source: { type: "marketplace", offerId: "offer-terra" } });
    expect(prices.marketplace).toEqual({ fetchedAt: "2026-10-08T00:00:00Z", models: ["openai.gpt-5.4", "openai.gpt-5.6-terra"] });
  });

  it("略号付きの単価はそのリージョンにだけ入る。取得対象外のリージョン (eu-central-1) には入れない", () => {
    const prices = applyMarketplacePrices(base(), { marketplace, models, profiles, regions, prefixIndex });
    expect(Object.keys(prices.byModel["openai.gpt-5.4"])).toEqual(["ap-northeast-1"]);
  });

  it("Price List に Runtime の単価があるモデルは上書きしない (Price List を優先する)", () => {
    const prices = applyMarketplacePrices(base(), { marketplace, models, profiles, regions, prefixIndex });
    expect(prices.byModel["anthropic.claude-sonnet-5"]).toEqual({ "us-east-1": { standard: { input: 3.3, output: 16.5 } } });
  });

  it("Mantle の単価しか無いモデルは Runtime の単価が無いので埋める対象。mantle はそのまま残す", () => {
    const prices = { byModel: { "openai.gpt-5.6-terra": { "us-east-2": { mantle: { standard: { input: 2.2 } } } } } };
    applyMarketplacePrices(prices, { marketplace, models, profiles, regions, prefixIndex });
    expect(prices.byModel["openai.gpt-5.6-terra"]["us-east-2"].mantle).toEqual({ standard: { input: 2.2 } });
    expect(prices.byModel["openai.gpt-5.6-terra"]["us-east-2"].standard).toEqual({ input: 2.2, output: 13.2 });
  });

  it("availability が INFERENCE_PROFILE だけで Global のプロファイルしか無いリージョンには、標準の単価を入れない", () => {
    const luna = {
      models: { "openai.gpt-6-luna": { name: "GPT-6 Luna", availability: { "ap-northeast-1": ["INFERENCE_PROFILE"], "us-east-1": ["INFERENCE_PROFILE"] } } },
      profiles: {
        "global.openai.gpt-6-luna": { modelId: "openai.gpt-6-luna", sources: { "ap-northeast-1": ["*"], "us-east-1": ["*"] } },
        "us.openai.gpt-6-luna": { modelId: "openai.gpt-6-luna", sources: { "us-east-1": ["us-east-1", "us-east-2"] } },
      },
    };
    const marketplaceLuna = { byModel: { "openai.gpt-6-luna": { offerId: "o", kinds: { standard: { input: 0.11 }, global: { input: 0.1 } }, byPrefix: {} } } };
    const prices = applyMarketplacePrices({ byModel: {} }, { marketplace: marketplaceLuna, ...luna, regions, prefixIndex });
    expect(prices.byModel["openai.gpt-6-luna"]["ap-northeast-1"]).toEqual({ global: { input: 0.1 }, source: { type: "marketplace", offerId: "o" } });
    expect(prices.byModel["openai.gpt-6-luna"]["us-east-1"].standard).toEqual({ input: 0.11 });
  });

  it("marketplace が無ければ何もしない", () => {
    const prices = applyMarketplacePrices(base(), { marketplace: null, models, profiles, regions, prefixIndex });
    expect(prices).toEqual(base());
  });
});

describe("buildPrefixIndex: Price List の usagetype の略号からリージョンを引く", () => {
  it("products の usagetype の先頭と regionCode を対にする", () => {
    const file = { products: { a: { attributes: { usagetype: "APN1-NovaPro-input-tokens", regionCode: "ap-northeast-1" } }, b: { attributes: { usagetype: "USE1-MP:USE1_x-Units", regionCode: "us-east-1" } } } };
    expect(buildPrefixIndex({ AmazonBedrock: { "ap-northeast-1": file } })).toEqual({ APN1: "ap-northeast-1", USE1: "us-east-1" });
  });
});
