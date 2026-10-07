// FEATURE-001 の純関数 (feature-model.mjs)。3 状態・並べ替え値・既定列・選択肢の順。
import { describe, it, expect } from "vitest";
import {
  FEATURE_STATES,
  buildFeatureRows,
  defaultFeatureColumns,
  featureCell,
  featureOptions,
  featureSortValue,
} from "../src/scripts/feature-model.mjs";
import sample from "./fixtures/features/features.sample.json";

const CLAUDE = "anthropic.claude-sonnet-4-5-20250929-v1:0";
const NOVA_LITE = "amazon.nova-lite-v1:0";
const COHERE = "cohere.embed-v4:0";

describe("featureOptions", () => {
  it("features の順に key と docs の英語名を返す", () => {
    expect(featureOptions(sample).map((o) => o.key)).toEqual(Object.keys(sample.features));
    expect(featureOptions(sample)[0]).toEqual({ key: "streaming", label: "Response streaming" });
  });
  it("空・未定義でも空配列", () => {
    expect(featureOptions({})).toEqual([]);
    expect(featureOptions(undefined)).toEqual([]);
  });
});

describe("defaultFeatureColumns", () => {
  it("defaultColumns のうち features に在るものだけ", () => {
    expect(defaultFeatureColumns(sample)).toEqual([
      "explicitPromptCaching",
      "structuredOutputs",
      "clientToolCalling",
      "guardrails",
    ]);
    expect(defaultFeatureColumns({ ...sample, defaultColumns: ["guardrails", "nope"] })).toEqual(["guardrails"]);
    expect(defaultFeatureColumns({})).toEqual([]);
  });
});

describe("featureCell は 3 状態を区別する", () => {
  it("true → yes / false → no / キーなし → none", () => {
    expect(featureCell(sample, CLAUDE, "guardrails")).toEqual({ runtime: "yes", mantle: "no" });
    expect(featureCell(sample, CLAUDE, "structuredOutputs")).toEqual({ runtime: "no", mantle: "no" });
    expect(featureCell(sample, CLAUDE, "clientToolCalling")).toEqual({ runtime: "none", mantle: "none" });
  });
  it("mantle の表が無い (null) なら mantle は none", () => {
    expect(featureCell(sample, NOVA_LITE, "guardrails")).toEqual({ runtime: "yes", mantle: "none" });
  });
  it("byModel に無いモデル・features 空は両方 none (記載なしを ✕ にしない)", () => {
    expect(featureCell(sample, COHERE, "guardrails")).toEqual({ runtime: FEATURE_STATES.NONE, mantle: FEATURE_STATES.NONE });
    expect(featureCell({}, CLAUDE, "guardrails")).toEqual({ runtime: "none", mantle: "none" });
  });
});

describe("featureSortValue", () => {
  it("runtime を優先し、同順なら mantle (yes > no > none)", () => {
    const v = (runtime, mantle) => featureSortValue({ runtime, mantle });
    expect(v("yes", "none")).toBeGreaterThan(v("no", "yes"));
    expect(v("no", "none")).toBeGreaterThan(v("none", "yes"));
    expect(v("yes", "yes")).toBeGreaterThan(v("yes", "no"));
    expect(v("yes", "no")).toBeGreaterThan(v("yes", "none"));
    expect(v("none", "none")).toBe(0);
    expect(v("yes", "yes")).toBe(8);
  });
});

describe("buildFeatureRows", () => {
  it("features の順で、どちらかが記載ありの行だけ", () => {
    const rows = buildFeatureRows(sample, CLAUDE);
    expect(rows.map((r) => r.key)).toEqual([
      "streaming",
      "explicitPromptCaching",
      "structuredOutputs",
      "countTokens",
      "guardrails",
    ]);
    expect(rows.find((r) => r.key === "guardrails")).toEqual({
      key: "guardrails",
      label: "Guardrails",
      runtime: "yes",
      mantle: "no",
    });
  });
  it("記載なしのモデルは空配列", () => {
    expect(buildFeatureRows(sample, COHERE)).toEqual([]);
    expect(buildFeatureRows({}, CLAUDE)).toEqual([]);
  });
});
