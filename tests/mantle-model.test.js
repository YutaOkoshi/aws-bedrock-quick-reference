// @vitest-environment node
// MANTLE-001 の純関数と、手書きデータ data/mantle.json の形。
// data/mantle.json をファイルパスで読むので node 環境で走らせる。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MANTLE_APIS,
  isMantleRegion,
  judgeMantle,
  mantleEndpointOf,
} from "../src/scripts/mantle-model.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const mantle = JSON.parse(readFileSync(join(ROOT, "data", "mantle.json"), "utf8"));
const models = JSON.parse(readFileSync(join(ROOT, "data", "models.json"), "utf8"));

// docs の「Supported Regions and Endpoints」を転記した 14 リージョン (D-010)。
const DOCS_REGIONS = [
  "us-east-1",
  "us-east-2",
  "us-west-2",
  "ap-northeast-1",
  "ap-south-1",
  "ap-southeast-2",
  "ap-southeast-3",
  "eu-central-1",
  "eu-west-1",
  "eu-west-2",
  "eu-south-1",
  "eu-north-1",
  "sa-east-1",
  "us-gov-west-1",
];

describe("data/mantle.json の形 (D-010)", () => {
  it("_source に転記元の URL 3 本と日付がある", () => {
    expect(mantle._source.date).toBe("2026-09-14");
    expect(mantle._source.urls).toHaveLength(3);
    expect(mantle._source.urls).toContain(
      "https://docs.aws.amazon.com/bedrock/latest/userguide/endpoints.html",
    );
    expect(mantle._source.urls).toContain(
      "https://docs.aws.amazon.com/bedrock/latest/userguide/bedrock-mantle.html",
    );
    expect(mantle._source.urls).toContain(
      "https://docs.aws.amazon.com/bedrock/latest/userguide/models-endpoint-availability.html",
    );
  });

  it("regions が docs の 14 リージョンと過不足なく一致する", () => {
    expect([...mantle.regions].sort()).toEqual([...DOCS_REGIONS].sort());
  });

  // mantle.json は docs の転記、models.json は API のスナップショットで、更新の時期が違う。
  // API から消えたモデル (2026-10-07 の Nova Canvas) のキーが残っても表には出ないので、
  // 件数を固定せず、残ったキーが少数でモデル ID の形をしていることを確かめ、一覧をログに出す。
  it("models のキーの大半が models.json に実在し、実在しないキーは一覧に出す", () => {
    const keys = Object.keys(mantle.models);
    const stale = keys.filter((modelId) => !(modelId in models));
    if (stale.length > 0) console.info(`mantle.json のキーで models.json に無いもの: ${stale.join(", ")}`);
    expect(keys.length).toBeGreaterThan(0);
    // 消えたモデルは少数に留まる。大量に外れたら転記かスナップショットの取り違え
    expect(stale.length).toBeLessThanOrEqual(Math.ceil(keys.length * 0.1));
    // 書き間違いを拾う: 残ったキーもモデル ID の形で、models.json にある接頭辞 (amazon. など) を持つ
    const prefixes = new Set(Object.keys(models).map((id) => id.split(".")[0]));
    for (const modelId of stale) {
      expect(modelId, modelId).toMatch(/^[a-z0-9-]+\.[a-z0-9.:-]+$/);
      expect(prefixes.has(modelId.split(".")[0]), modelId).toBe(true);
    }
  });

  it("models の各エントリが runtime / mantle の真偽値を持つ", () => {
    for (const [modelId, entry] of Object.entries(mantle.models)) {
      expect(typeof entry.runtime, modelId).toBe("boolean");
      expect(typeof entry.mantle, modelId).toBe("boolean");
      if ("mantleModelId" in entry) expect(typeof entry.mantleModelId, modelId).toBe("string");
    }
  });

  it("_unmatched に、models.json のモデル名と突き合わなかった docs のモデル名が残る", () => {
    expect(Array.isArray(mantle._unmatched)).toBe(true);
    // オーナーが見て手当てできるように名前をそのまま残す。空でも良いが、今は残っている。
    for (const name of mantle._unmatched) expect(typeof name).toBe("string");
    // 突き合った名前は _unmatched に入らない。
    const mappedNames = new Set(
      Object.keys(mantle.models).map((id) => String(models[id]?.name ?? "").toLowerCase()),
    );
    for (const name of mantle._unmatched) {
      expect(mappedNames.has(name.toLowerCase()), name).toBe(false);
    }
  });

  it("mantleOnly は models.json に無い mantle 専用モデルだけ", () => {
    const namesInModels = new Set(
      Object.values(models).map((model) => String(model.name ?? "").toLowerCase()),
    );
    for (const [name, entry] of Object.entries(mantle.mantleOnly)) {
      expect(entry.mantle, name).toBe(true);
      expect(namesInModels.has(name.toLowerCase()), name).toBe(false);
    }
  });
});

describe("AC-001 / AC-002 起点リージョンの bedrock-mantle", () => {
  it("提供リージョンなら true、それ以外は false", () => {
    expect(isMantleRegion(mantle, "ap-northeast-1")).toBe(true);
    expect(isMantleRegion(mantle, "eu-west-1")).toBe(true);
    expect(isMantleRegion(mantle, "ap-northeast-3")).toBe(false);
    expect(isMantleRegion(mantle, "eu-west-3")).toBe(false);
  });

  it("データが無くても落ちない", () => {
    expect(isMantleRegion(null, "ap-northeast-1")).toBe(false);
    expect(isMantleRegion({}, "ap-northeast-1")).toBe(false);
  });

  it("FQDN は bedrock-mantle.<region>.api.aws", () => {
    expect(mantleEndpointOf("ap-northeast-1")).toBe("bedrock-mantle.ap-northeast-1.api.aws");
    expect(mantleEndpointOf("us-east-1")).toBe("bedrock-mantle.us-east-1.api.aws");
  });
});

describe("AC-003 モデル × 起点リージョンの判定", () => {
  const MANTLE_MODEL = "nvidia.nemotron-nano-12b-v2"; // docs で mantle 対応
  const RUNTIME_ONLY = "anthropic.claude-sonnet-4-5-20250929-v1:0"; // docs で mantle 非対応

  it("mantle 対応モデル × 提供リージョン → available", () => {
    const judged = judgeMantle(mantle, MANTLE_MODEL, "ap-northeast-1");
    expect(judged.available).toBe(true);
    expect(judged.modelSupported).toBe(true);
    expect(judged.regionSupported).toBe(true);
  });

  it("mantle 対応モデルでも提供外リージョンなら available にならない", () => {
    const judged = judgeMantle(mantle, MANTLE_MODEL, "ap-northeast-3");
    expect(judged.available).toBe(false);
    expect(judged.modelSupported).toBe(true);
    expect(judged.regionSupported).toBe(false);
  });

  it("mantle 非対応モデルは提供リージョンでも available にならない", () => {
    const judged = judgeMantle(mantle, RUNTIME_ONLY, "ap-northeast-1");
    expect(judged.available).toBe(false);
    expect(judged.modelSupported).toBe(false);
  });

  it("指定するモデル ID は接頭辞の付かない素のモデル ID", () => {
    const judged = judgeMantle(mantle, MANTLE_MODEL, "ap-northeast-1");
    expect(judged.mantleModelId).toBe(MANTLE_MODEL);
    expect(judged.mantleModelId).not.toMatch(/^(us|eu|apac|au|jp|global)\./);
  });

  it("docs が明示しているときはその mantle モデル ID を使う", () => {
    const judged = judgeMantle(mantle, "openai.gpt-oss-120b-1:0", "us-east-1");
    expect(judged.mantleModelId).toBe("openai.gpt-oss-120b");
  });

  it("docs の対応表に無いモデルは null (「対応していない」とは区別する)", () => {
    expect(judgeMantle(mantle, "luma.ray-v2:0", "ap-northeast-1")).toBeNull();
    expect(judgeMantle(mantle, "does.not.exist", "ap-northeast-1")).toBeNull();
  });

  it("mantle データそのものが無くても落ちない (AC-007)", () => {
    expect(judgeMantle(null, "anything", "ap-northeast-1")).toBeNull();
    expect(judgeMantle({}, "anything", "ap-northeast-1")).toBeNull();
  });
});

describe("AC-005 bedrock-mantle が提供する API", () => {
  it("OpenAI Responses / Chat Completions と Anthropic Messages の 3 本", () => {
    expect(MANTLE_APIS).toEqual([
      "OpenAI Responses",
      "OpenAI Chat Completions",
      "Anthropic Messages",
    ]);
  });
});
