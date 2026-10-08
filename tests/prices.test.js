// @vitest-environment node
// PRICE-001 の単体テスト。ファイルを読むので node 環境で走らせる。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  PRICE_OFFERS,
  axisOf,
  bfmDimension,
  buildNameIndex,
  kindOf,
  checkPriceGuard,
  normalizePrices,
  priceFileUrl,
  readProduct,
  resolveModelIds,
  roundPrice,
  stripEdition,
  toPerMillion,
  usagetypeKey,
} from "../scripts/lib/prices.mjs";
import { okRegions, parsePriceArgs, rawName } from "../scripts/fetch-bedrock-prices.mjs";

import bedrockTokyo from "./fixtures/prices/AmazonBedrock-ap-northeast-1.json";
import foundationTokyo from "./fixtures/prices/AmazonBedrockFoundationModels-ap-northeast-1.json";
import priceModelMap from "../data/price-model-map.json";
import { buildSnapshot } from "./fixtures/bedrock-fixture.js";

const TOKYO = "ap-northeast-1";
const CLAUDE = "anthropic.claude-sonnet-4-5-20250929-v1:0";
const NOVA_LITE = "amazon.nova-lite-v1:0";
const NVIDIA = "nvidia.nemotron-nano-12b-v2";
const EMBED = "cohere.embed-v4:0";
const TITAN = "amazon.titan-embed-text-v1:2:8k";

const read = (relative) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8"));

function build(models = buildSnapshot().models, map = priceModelMap) {
  return normalizePrices({
    files: {
      AmazonBedrock: { [TOKYO]: bedrockTokyo },
      AmazonBedrockFoundationModels: { [TOKYO]: foundationTokyo },
    },
    models,
    map,
    generatedAt: "2026-09-14T09:00:00Z",
  });
}

// --- AC-001 取得対象のリージョン ---
describe("AC-001 取得対象は fetch-log.json の status: ok のリージョン", () => {
  it("okRegions は ok のリージョンだけを昇順で返す", () => {
    const regions = okRegions({
      regions: {
        "us-east-1": { status: "ok" },
        "ap-northeast-1": { status: "ok" },
        "af-south-1": { status: "denied", cause: "not-opted-in" },
      },
    });
    expect(regions).toEqual(["ap-northeast-1", "us-east-1"]);
  });

  it("実データの fetch-log.json では status: ok のリージョンがすべて対象になる", () => {
    const fetchLog = read("../data/fetch-log.json");
    const ok = Object.entries(fetchLog.regions).filter(([, entry]) => entry.status === "ok").map(([region]) => region);
    expect(okRegions(fetchLog)).toEqual(ok.sort());
    expect(ok.length).toBeGreaterThan(0);
  });

  it("--regions で対象を絞れる。省くと既定 (ok のリージョン全件)", () => {
    const defaults = ["ap-northeast-1", "us-east-1"];
    expect(parsePriceArgs(["--regions", "us-west-2"], { defaultRegions: defaults }).regions).toEqual([
      "us-west-2",
    ]);
    expect(parsePriceArgs([], { defaultRegions: defaults }).regions).toEqual(defaults);
  });

  it("--date は YYYY-MM-DD、既定は呼び出し側が渡す今日", () => {
    expect(parsePriceArgs(["--date", "2026-09-14"], { today: "2026-01-01" }).date).toBe("2026-09-14");
    expect(parsePriceArgs([], { today: "2026-01-01" }).date).toBe("2026-01-01");
    expect(() => parsePriceArgs(["--date", "9/14"])).toThrow();
    expect(() => parsePriceArgs(["--x"])).toThrow();
  });

  it("2 つの offer を取る。AmazonBedrockService / AgentCore は対象外", () => {
    expect(PRICE_OFFERS).toEqual(["AmazonBedrock", "AmazonBedrockFoundationModels"]);
  });
});

// --- AC-002 生データの保存と --from-raw ---
describe("AC-002 生データの保存", () => {
  it("ファイル名は prices-<offer>-<region>.json", () => {
    expect(rawName("AmazonBedrock", "ap-northeast-1")).toBe("prices-AmazonBedrock-ap-northeast-1.json");
  });

  it("取得元 URL は offer とリージョンから組み立てる", () => {
    expect(priceFileUrl("AmazonBedrock", TOKYO)).toBe(
      "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/ap-northeast-1/index.json",
    );
  });

  it("data/raw/ は gitignore 対象のまま", () => {
    expect(read.name && readFileSync(fileURLToPath(new URL("../.gitignore", import.meta.url)), "utf8")).toContain(
      "data/raw/",
    );
  });

  it("--from-raw は --regions と併用できない", () => {
    expect(() => parsePriceArgs(["--from-raw", "2026-09-14", "--regions", "us-east-1"])).toThrow();
    expect(parsePriceArgs(["--from-raw", "2026-09-14"]).date).toBe("2026-09-14");
  });
});

// --- AC-004 単位の正規化と価格の種別 ---
describe("AC-004 USD / 100 万トークンに揃える", () => {
  it("1K tokens の単価は 1000 倍する", () => {
    expect(toPerMillion("0.0038400000", "1K tokens")).toBe(3.84);
    expect(toPerMillion("0.0000180000", "1K tokens")).toBe(0.018);
  });

  it("単位の大文字小文字は問わない (Nova 2.5 Sonic は 1k tokens)", () => {
    expect(toPerMillion("0.0003300000", "1k tokens")).toBe(0.33);
    expect(toPerMillion("5.5000000000", "1m tokens")).toBe(5.5);
  });

  it("1M tokens の単価はそのまま", () => {
    expect(toPerMillion("5.5000000000", "1M tokens")).toBe(5.5);
  });

  it("トークン以外の単位は扱わない", () => {
    expect(toPerMillion("0.0400000000", "image")).toBeNull();
    expect(toPerMillion("0.1980000000", "1M TPM Hour")).toBeNull();
  });

  it("小数 6 桁までで丸める", () => {
    expect(roundPrice(0.0000724999)).toBe(0.000072);
    expect(roundPrice(3.8400000000000003)).toBe(3.84);
  });

  it("軸は input / output / cacheRead / cacheWrite。1h キャッシュと画像・音声・動画は範囲外", () => {
    expect(axisOf("Input tokens")).toBe("input");
    expect(axisOf("Output tokens flex")).toBe("output");
    expect(axisOf("Prompt cache read input tokens")).toBe("cacheRead");
    expect(axisOf("Prompt cache write input tokens")).toBe("cacheWrite");
    expect(axisOf("CacheWrite1hInputTokenCount")).toBeNull();
    expect(axisOf("Input Audio Token Count")).toBeNull();
    expect(axisOf("Output Image Token Count")).toBeNull();
    expect(axisOf("Speech Understanding input token")).toBeNull();
    expect(axisOf("")).toBeNull();
  });

  it("種別は standard / global / batch / cacheRead / cacheWrite / priority / flex", () => {
    expect(kindOf("input", {})).toBe("standard");
    expect(kindOf("input", { global: true })).toBe("global");
    expect(kindOf("output", { batch: true })).toBe("batch");
    expect(kindOf("output", { priority: true })).toBe("priority");
    expect(kindOf("input", { flex: true })).toBe("flex");
    expect(kindOf("cacheRead", {})).toBe("cacheRead");
    // Global と batch / flex / priority の組み合わせは v1 の範囲外
    // Global のバッチ・キャッシュは別の種別として持つ。Global と priority / flex の組み合わせは範囲外
    expect(kindOf("input", { global: true, batch: true })).toBe("globalBatch");
    expect(kindOf("cacheRead", { global: true })).toBe("globalCacheRead");
    expect(kindOf("cacheWrite", { global: true })).toBe("globalCacheWrite");
    expect(kindOf("cacheRead", { global: true, batch: true })).toBeNull();
    expect(kindOf("input", { global: true, priority: true })).toBeNull();
    expect(kindOf("input", { global: true, flex: true })).toBeNull();
    expect(kindOf(null, {})).toBeNull();
  });

  it("AmazonBedrock の product から軸と種別を読む", () => {
    const read1 = readProduct("AmazonBedrock", {
      attributes: { usagetype: "APN1-NovaPro-output-tokens", inferenceType: "Output tokens", model: "Nova Pro" },
    });
    expect(read1).toMatchObject({ sourceName: "Nova Pro", axis: "output", kind: "standard" });

    const globalSku = readProduct("AmazonBedrock", {
      attributes: { usagetype: "APN1-Nova2.0Lite-input-tokens-cross-region-global", inferenceType: "Input tokens", model: "Nova 2.0 Lite" },
    });
    expect(globalSku.kind).toBe("global");

    const batchSku = readProduct("AmazonBedrock", {
      attributes: { usagetype: "APN1-NovaPro-input-tokens-batch", inferenceType: "Input tokens", feature: "Batch Inference", model: "Nova Pro" },
    });
    expect(batchSku.kind).toBe("batch");

    // Mantle は同じ単価の別の接続先。価格表には載せない
    const mantle = readProduct("AmazonBedrock", {
      attributes: { usagetype: "APN1-xai.grok-4.6-mantle-input-tokens-standard", service_tier: "standard", model: "Grok 4.6" },
    });
    expect(mantle.mantle).toBe(true);

    // latency optimized は標準と別建てなので範囲外
    const latency = readProduct("AmazonBedrock", {
      attributes: { usagetype: "USE1-NovaPro-output-tokens-latency-optimized", inferenceType: "Output tokens", model: "Nova Pro Latency Optimized" },
    });
    expect(latency.kind).toBeNull();
  });

  it("AmazonBedrockFoundationModels は servicename と usagetype の寸法を読む", () => {
    expect(bfmDimension("APN1-MP:APN1_input_tokens_global_standard-Units")).toBe(
      "input_tokens_global_standard",
    );
    expect(bfmDimension("not-a-usagetype")).toBeNull();
    const row = readProduct("AmazonBedrockFoundationModels", {
      attributes: {
        servicename: "Claude Opus 5 (Amazon Bedrock Edition)",
        usagetype: "APN1-MP:APN1_output_tokens_global_standard-Units",
      },
    });
    expect(row).toMatchObject({ sourceName: "Claude Opus 5", axis: "output", kind: "global" });
    // 長文コンテキスト (long_ctx) は standard / global の longContext として読む。
    // キャッシュの long_ctx は範囲外 (読む順で cache の値に混ざらないように)
    const longOut = readProduct("AmazonBedrockFoundationModels", {
      attributes: { servicename: "OpenAI GPT-6 Astra (Amazon Bedrock Edition)", usagetype: "USE1-MP:USE1_output_tokens_long_ctx_standard-Units" },
    });
    expect(longOut).toMatchObject({ axis: "output", kind: "standard", longContext: true });
    const longGlobal = readProduct("AmazonBedrockFoundationModels", {
      attributes: { servicename: "OpenAI GPT-6 Astra (Amazon Bedrock Edition)", usagetype: "USE1-MP:USE1_input_tokens_long_ctx_global_standard-Units" },
    });
    expect(longGlobal).toMatchObject({ axis: "input", kind: "global", longContext: true });
    for (const dimension of ["cache_read_tokens_long_ctx_standard", "cache_write_tokens_30m_long_ctx_standard"]) {
      const longCache = readProduct("AmazonBedrockFoundationModels", {
        attributes: { servicename: "OpenAI GPT-6 Astra (Amazon Bedrock Edition)", usagetype: `USE1-MP:USE1_${dimension}-Units` },
      });
      expect(longCache.kind, dimension).toBeNull();
    }
    // 旧い Claude は CamelCase の寸法
    expect(
      readProduct("AmazonBedrockFoundationModels", {
        attributes: { servicename: "Claude Sonnet 4.5 (Amazon Bedrock Edition)", usagetype: "APN1-MP:APN1_InputTokenCount_Batch-Units" },
      }).kind,
    ).toBe("batch");
  });
});

// --- AC-005 SKU → モデル ID の対応 ---
describe("AC-005 モデル名からモデル ID を引く", () => {
  const models = buildSnapshot().models;
  const nameIndex = buildNameIndex(models);

  it("(Amazon Bedrock Edition) を外してから比べる", () => {
    expect(stripEdition("Claude Opus 5 (Amazon Bedrock Edition)")).toBe("Claude Opus 5");
    expect(stripEdition("Nova Pro")).toBe("Nova Pro");
  });

  it("大文字小文字と記号を無視して models.json の name に一致させる", () => {
    expect(resolveModelIds("Claude Sonnet 4.5", { nameIndex })).toEqual([CLAUDE]);
    expect(resolveModelIds("nova lite", { nameIndex })).toEqual([NOVA_LITE]);
  });

  it("手書きの地図が自動一致より優先される", () => {
    expect(resolveModelIds("NVIDIA Nemotron Nano 2 VL", { nameIndex, map: priceModelMap })).toEqual([
      NVIDIA,
    ]);
    expect(resolveModelIds("Cohere Embed 4 Model", { nameIndex, map: priceModelMap })).toEqual([EMBED]);
  });

  it("同じ name のモデル ID が複数あれば全件に同じ単価を入れる", () => {
    const many = {
      "amazon.nova-pro-v1:0": { name: "Nova Pro" },
      "amazon.nova-pro-v1:0:24k": { name: "Nova Pro" },
    };
    expect(resolveModelIds("Nova Pro", { nameIndex: buildNameIndex(many) })).toEqual([
      "amazon.nova-pro-v1:0",
      "amazon.nova-pro-v1:0:24k",
    ]);
  });

  it("model 属性を持たない SKU は usagetype の鍵で引く", () => {
    expect(usagetypeKey("APN1-TitanEmbeddingsG1-Text-input-tokens")).toBe("TitanEmbeddingsG1-Text");
    expect(usagetypeKey("USE1-TitanTextG1-Express-output-tokens")).toBe("TitanTextG1-Express");
    expect(
      resolveModelIds("usagetype:TitanEmbeddingsG1-Text", { nameIndex, map: priceModelMap }),
    ).toContain("amazon.titan-embed-text-v1");
  });

  it("地図に null と書いたものは「該当なし」で、未マッピングにしない", () => {
    expect(resolveModelIds("Nova Premier", { nameIndex, map: priceModelMap })).toEqual([]);
    expect(resolveModelIds("知らないモデル", { nameIndex, map: priceModelMap })).toBeNull();
  });
});

// --- AC-004 / AC-006 正規化の結果 ---
describe("AC-004 / AC-006 prices.json の中身", () => {
  const { prices, unmappedList } = build();

  it("すべての単価が USD / 100 万トークンで入る", () => {
    expect(prices.byModel[CLAUDE][TOKYO]).toEqual({
      standard: { input: 3.3, output: 16.5 },
      global: { input: 3, output: 15 },
      batch: { input: 1.65 },
      cacheRead: { input: 0.33 },
    });
    expect(prices.byModel[NOVA_LITE][TOKYO]).toEqual({
      standard: { input: 0.072, output: 0.288 },
      batch: { input: 0.036 },
      cacheRead: { input: 0.018 },
    });
  });

  it("地図で引いたモデルにも単価が入る", () => {
    expect(prices.byModel[NVIDIA][TOKYO].standard).toEqual({ input: 0.24, output: 0.73 });
    expect(prices.byModel[EMBED][TOKYO].standard).toEqual({ input: 0.12 });
    expect(prices.byModel[TITAN][TOKYO].standard).toEqual({ input: 0.2 });
  });

  it("Mantle の SKU は Runtime の単価に混ざらず、mantle の下に別に入る", () => {
    // fixture の Mantle SKU は NVIDIA Nemotron Nano 2 VL の 1 件
    const entry = prices.byModel[NVIDIA][TOKYO];
    expect(entry.standard).toEqual({ input: 0.24, output: 0.73 });
    expect(Object.keys(entry.mantle ?? {}).length).toBeGreaterThan(0);
    expect(prices.outOfScope).toBeGreaterThan(0);
  });

  it("generatedAt / publicationDate / source を持つ", () => {
    expect(prices.generatedAt).toBe("2026-09-14T09:00:00Z");
    expect(prices.publicationDate).toBe(bedrockTokyo.publicationDate > foundationTokyo.publicationDate ? bedrockTokyo.publicationDate : foundationTokyo.publicationDate);
    expect(prices.source.index).toContain("pricing.us-east-1.amazonaws.com");
    expect(Object.keys(prices.source.offers)).toEqual(PRICE_OFFERS);
  });

  it("地図に無い名前は unmapped に数え、一覧を返す", () => {
    const { prices: bare, unmappedList: list } = build(buildSnapshot().models, {});
    expect(bare.unmapped).toBeGreaterThan(0);
    expect(list.map((entry) => entry.name)).toContain("NVIDIA Nemotron Nano 2 VL");
    expect(list[0]).toHaveProperty("count");
    expect(list[0]).toHaveProperty("offer");
  });

  it("地図が揃っていれば unmapped は 0", () => {
    expect(prices.unmapped).toBe(0);
    expect(unmappedList).toEqual([]);
  });

  it("実データの data/prices.json も unmapped 0 で、東京の標準価格を持つ", () => {
    const real = read("../data/prices.json");
    expect(real.unmapped).toBe(0);
    expect(real.byModel["anthropic.claude-opus-5"][TOKYO].standard).toEqual({
      input: 5.5,
      output: 27.5,
    });
    expect(real.byModel["anthropic.claude-opus-5"][TOKYO].global).toEqual({ input: 5, output: 25 });
  });
});

// --- 価格表の書き方の揺れ (2026-10-07 の取得で見つかったもの) ---
describe("AC-004 / AC-005 価格表の揺れを API の値のまま取り込む", () => {
  // 最小の offer ファイルを組み立てる。rows は [sku 属性, USD, 単位]
  const offerFile = (rows) => {
    const products = {};
    const OnDemand = {};
    rows.forEach(([attributes, usd, unit], index) => {
      const sku = `SKU${index}`;
      products[sku] = { sku, attributes };
      OnDemand[sku] = { [`${sku}.T`]: { priceDimensions: { [`${sku}.T.D`]: { pricePerUnit: { USD: usd }, unit } } } };
    });
    return { publicationDate: "2026-10-06T00:00:00Z", products, terms: { OnDemand } };
  };
  const normalize = (files, models) => normalizePrices({ files, models, map: {}, generatedAt: "x" });

  it("long_ctx の SKU は standard / global の longContext に入り、標準の単価を上書きしない", () => {
    const bfm = (dimension) => ({ servicename: "OpenAI GPT-6 Astra (Amazon Bedrock Edition)", usagetype: `USE1-MP:USE1_${dimension}-Units` });
    const rows = [
      [bfm("output_tokens_long_ctx_standard"), "82.5", "1M tokens"],
      [bfm("output_tokens_standard"), "55", "1M tokens"],
      [bfm("input_tokens_long_ctx_standard"), "22", "1M tokens"],
      [bfm("input_tokens_standard"), "11", "1M tokens"],
      [bfm("input_tokens_long_ctx_global_standard"), "20", "1M tokens"],
      [bfm("input_tokens_global_standard"), "10", "1M tokens"],
      [bfm("output_tokens_long_ctx_global_standard"), "75", "1M tokens"],
      [bfm("output_tokens_global_standard"), "50", "1M tokens"],
      [bfm("cache_read_tokens_long_ctx_standard"), "2.2", "1M tokens"],
      [bfm("cache_read_tokens_standard"), "1.1", "1M tokens"],
    ];
    const { prices } = normalize(
      { AmazonBedrockFoundationModels: { "us-east-1": offerFile(rows) } },
      { "openai.gpt-6-astra": { provider: "OpenAI", name: "GPT-6 Astra" } },
    );
    expect(prices.byModel["openai.gpt-6-astra"]["us-east-1"]).toEqual({
      standard: { input: 11, output: 55, longContext: { input: 22, output: 82.5 } },
      global: { input: 10, output: 50, longContext: { input: 20, output: 75 } },
      cacheRead: { input: 1.1 },
    });
    expect(prices.unmapped).toBe(0);
  });

  it("価格表の名前の先頭にプロバイダ名が付いていても自動で引ける", () => {
    const models = { "openai.gpt-6-astra": { provider: "OpenAI", name: "GPT-6 Astra" } };
    expect(resolveModelIds("OpenAI GPT-6 Astra", { nameIndex: buildNameIndex(models) })).toEqual(["openai.gpt-6-astra"]);
  });

  it("model 属性がモデル ID そのもの (xai.grok-4.6) でも引ける", () => {
    const models = { "xai.grok-4.6": { provider: "xAI", name: "Grok 4.6" } };
    expect(resolveModelIds("xai.grok-4.6", { nameIndex: buildNameIndex(models) })).toEqual(["xai.grok-4.6"]);
  });

  it("Runtime と Mantle の単価は別々に持ち、値が違っても混ぜない (Qwen3 Next 80B)", () => {
    const sku = (tail, service_tier) => ({ model: "Qwen3 Next 80B A3B", usagetype: `APS3-${tail}`, service_tier });
    const rows = [
      [sku("qwen.qwen3-next-80b-a3b-input-tokens-standard", "standard"), "0.18", "1M tokens"],
      [sku("qwen.qwen3-next-80b-a3b-output-tokens-standard", "standard"), "1.41", "1M tokens"],
      [sku("qwen.qwen3-next-80b-a3b-mantle-input-tokens-standard", "standard"), "0.168", "1M tokens"],
      [sku("qwen.qwen3-next-80b-a3b-mantle-output-tokens-standard", "standard"), "1.44", "1M tokens"],
      [sku("qwen.qwen3-next-80b-a3b-mantle-input-tokens-batch", "batch"), "0.084", "1M tokens"],
    ];
    const { prices } = normalize(
      { AmazonBedrock: { "ap-south-1": offerFile(rows) } },
      { "qwen.qwen3-next-80b-a3b": { provider: "Qwen", name: "Qwen3 Next 80B A3B" } },
    );
    expect(prices.byModel["qwen.qwen3-next-80b-a3b"]["ap-south-1"]).toEqual({
      standard: { input: 0.18, output: 1.41 },
      mantle: { standard: { input: 0.168, output: 1.44 }, batch: { input: 0.084 } },
    });
  });

  it("Mantle の SKU しか無いモデルは Runtime の単価を持たず、mantle だけを持つ (Grok 4.7)", () => {
    const sku = (tail, service_tier) => ({ model: "Grok 4.7", usagetype: `USE1-xai.grok-4.7-mantle-${tail}`, service_tier });
    const rows = [
      [sku("input-tokens-standard", "standard"), "2.2", "1M tokens"],
      [sku("output-tokens-standard", "standard"), "6.6", "1M tokens"],
      [sku("input-tokens-global-standard", "global-standard"), "2", "1M tokens"],
    ];
    const { prices } = normalize(
      { AmazonBedrock: { "us-east-1": offerFile(rows) } },
      { "xai.grok-4.7": { provider: "xAI", name: "Grok 4.7" } },
    );
    expect(prices.byModel["xai.grok-4.7"]["us-east-1"]).toEqual({
      mantle: { standard: { input: 2.2, output: 6.6 }, global: { input: 2 } },
    });
  });

  it("Mantle の long_ctx も mantle の下の longContext に入る", () => {
    const rows = [
      [{ model: "M", usagetype: "USE1-x.m-mantle-input-tokens-standard", service_tier: "standard" }, "1", "1M tokens"],
      [{ model: "M", usagetype: "USE1-x.m-mantle-input-tokens-long_ctx-standard", service_tier: "standard" }, "2", "1M tokens"],
    ];
    const { prices } = normalize({ AmazonBedrock: { "us-east-1": offerFile(rows) } }, { "x.m": { provider: "X", name: "M" } });
    expect(prices.byModel["x.m"]["us-east-1"]).toEqual({ mantle: { standard: { input: 1, longContext: { input: 2 } } } });
  });

  it("models.json に無いモデルの Mantle の SKU は unmapped に数えない (Mantle 専用モデル)", () => {
    const rows = [[{ model: "xai.grok-4.3", usagetype: "USE1-xai.grok-4.3-mantle-input-tokens-standard", service_tier: "standard" }, "1", "1M tokens"]];
    const { prices } = normalize({ AmazonBedrock: { "us-east-1": offerFile(rows) } }, {});
    expect(prices.unmapped).toBe(0);
    expect(prices.outOfScope).toBe(1);
    expect(prices.byModel).toEqual({});
  });

  it("地図が models.json に無い ID を指していても書き出さない (API から消えたモデル)", () => {
    const rows = [[{ model: "Nova Canvas", usagetype: "USE1-NovaCanvas-input-tokens", inferenceType: "Input tokens" }, "0.001", "1K tokens"]];
    const { prices } = normalizePrices({
      files: { AmazonBedrock: { "us-east-1": offerFile(rows) } },
      models: {},
      map: { "Nova Canvas": ["amazon.nova-canvas-v1:0"] },
      generatedAt: "x",
    });
    expect(prices.byModel).toEqual({});
    expect(prices.ignored).toBe(1);
    expect(prices.unmapped).toBe(0);
  });

  it("long_ctx だけで標準の SKU が無い組も longContext を残す", () => {
    const rows = [[{ servicename: "M (Amazon Bedrock Edition)", usagetype: "USE1-MP:USE1_input_tokens_long_ctx_standard-Units" }, "2", "1M tokens"]];
    const { prices } = normalize({ AmazonBedrockFoundationModels: { "us-east-1": offerFile(rows) } }, { "x.m": { provider: "X", name: "M" } });
    expect(prices.byModel["x.m"]["us-east-1"]).toEqual({ standard: { longContext: { input: 2 } } });
  });

  it("単位が読めない SKU (Units など) は範囲外に数える", () => {
    const rows = [[{ servicename: "M (Amazon Bedrock Edition)", usagetype: "USE1-MP:USE1_cache_write_tokens_long_ctx_standard-Units" }, "1", "Units"]];
    const { prices } = normalize({ AmazonBedrockFoundationModels: { "us-east-1": offerFile(rows) } }, { "x.m": { provider: "X", name: "M" } });
    expect(prices.byModel).toEqual({});
    expect(prices.outOfScope).toBe(1);
  });

  it("単位が小文字の 1k tokens でも単価が入る (Nova 2.5 Sonic)", () => {
    const rows = [
      [{ model: "Nova 2.5 Sonic", usagetype: "USE1-NovaSonic2.5-text-input-tokens", inferenceType: "Text Input Token" }, "0.00033", "1k tokens"],
      [{ model: "Nova 2.5 Sonic", usagetype: "USE1-NovaSonic2.5-speech-input-tokens", inferenceType: "Speech Understanding input token" }, "0.003", "1k tokens"],
    ];
    const { prices } = normalize(
      { AmazonBedrock: { "us-east-1": offerFile(rows) } },
      { "amazon.nova-2-5-sonic": { provider: "Amazon", name: "Nova 2.5 Sonic" } },
    );
    expect(prices.byModel["amazon.nova-2-5-sonic"]["us-east-1"]).toEqual({ standard: { input: 0.33 } });
  });
});

// --- 安全弁: 価格表の書式変更などで単価が大量に消えたら書き出さない ---
describe("PRICE-001 安全弁 (checkPriceGuard)", () => {
  const withModels = (n) => ({ byModel: Object.fromEntries(Array.from({ length: n }, (_, i) => [`m${i}`, {}])) });

  it("価格のあるモデルが前回の半分以上なら通す", () => {
    expect(checkPriceGuard(withModels(100), withModels(50))).toBeNull();
    expect(checkPriceGuard(withModels(100), withModels(130))).toBeNull();
  });

  it("前回の半分未満なら理由を返す", () => {
    expect(checkPriceGuard(withModels(100), withModels(49))).toMatch(/100.*49/);
  });

  it("前回が無い (初回) なら通す", () => {
    expect(checkPriceGuard(null, withModels(1))).toBeNull();
  });
});

// --- AC-011 価格が無いとき ---
describe("AC-011 価格が無いモデル / 価格データが無いとき", () => {
  it("prices.json が空でも例外にならず byModel は空", () => {
    const { prices } = normalizePrices({ files: {}, models: {}, map: {}, generatedAt: "x" });
    expect(prices.byModel).toEqual({});
    expect(prices.unmapped).toBe(0);
    expect(prices.publicationDate).toBeNull();
  });
});
