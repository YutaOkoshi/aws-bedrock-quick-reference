// FEATURE-001 の結合テスト (jsdom)。表の機能列・列ピッカー・脚注・詳細パネルの機能の節。
import { describe, it, expect, beforeEach } from "vitest";
import { mountFixtureApp, rowFor, cells, $ } from "./app-harness.js";
import { FEATURE_COLUMNS_EVENT } from "../src/scripts/table-view.js";
import { setLang } from "../src/scripts/i18n.js";
import sample from "./fixtures/features/features.sample.json";

const CLAUDE = "anthropic.claude-sonnet-4-5-20250929-v1:0";
const NOVA_LITE = "amazon.nova-lite-v1:0";
const COHERE = "cohere.embed-v4:0";

const PRICE_OUTPUT = 7;
const FIRST_FEATURE = 8;

const headers = () => [...document.querySelectorAll("#models-table thead th")];
const headerKeys = () => headers().map((th) => th.dataset.key);
const headerText = (th) => (th.querySelector(".sort-btn") ?? th).textContent.replace(/[▼▲]/g, "").trim();
const featureCellOf = (modelId, key) => {
  const index = headerKeys().indexOf(`feature:${key}`);
  return index < 0 ? null : cells(rowFor(modelId))[index];
};
const pickerBox = (key) => document.querySelector(`#feature-picker input[data-feature-key="${key}"]`);

function toggleBox(key, checked) {
  const box = pickerBox(key);
  box.checked = checked;
  box.dispatchEvent(new Event("change", { bubbles: true }));
}

beforeEach(() => {
  Object.defineProperty(navigator, "language", { value: "ja-JP", configurable: true });
});

describe("FEATURE-001 表の機能列", () => {
  it("既定 4 列が価格 2 列の右に、defaultColumns の順で並ぶ", () => {
    mountFixtureApp({ features: sample });
    const keys = headerKeys();
    expect(keys[PRICE_OUTPUT]).toBe("priceOutput");
    expect(keys.slice(FIRST_FEATURE)).toEqual([
      "feature:explicitPromptCaching",
      "feature:structuredOutputs",
      "feature:clientToolCalling",
      "feature:guardrails",
    ]);
  });

  it("列見出しは ja でも en でも docs の英語名のまま", () => {
    mountFixtureApp({ features: sample });
    expect(headers().slice(FIRST_FEATURE).map(headerText)).toEqual([
      "Explicit Prompt Caching",
      "Structured outputs",
      "Client-side tool calling",
      "Guardrails",
    ]);
    setLang("en");
    expect(headers().slice(FIRST_FEATURE).map(headerText)).toEqual([
      "Explicit Prompt Caching",
      "Structured outputs",
      "Client-side tool calling",
      "Guardrails",
    ]);
    setLang("ja");
  });

  it("セルは runtime と mantle を並べ、3 状態を区別する", () => {
    mountFixtureApp({ features: sample });
    // 対応 / 非対応
    expect(featureCellOf(CLAUDE, "guardrails").textContent).toBe("runtime ✓ / mantle ✕");
    // 片側だけ記載なし (mantle の表が無い)
    expect(featureCellOf(NOVA_LITE, "guardrails").textContent).toBe("runtime ✓ / mantle —");
    // 両方記載なしは「—」1 つ。✕ にしない
    const none = featureCellOf(COHERE, "guardrails");
    expect(none.textContent).toBe("—");
    expect(none.classList.contains("dim")).toBe(true);
    expect(featureCellOf(CLAUDE, "clientToolCalling").textContent).toBe("—");
  });

  it("セルの aria-label に両エンドポイントの状態を言葉で書く", () => {
    mountFixtureApp({ features: sample });
    const mark = featureCellOf(CLAUDE, "guardrails").querySelector(".feature-cell");
    expect(mark.getAttribute("aria-label")).toBe("bedrock-runtime: 対応 / bedrock-mantle: 非対応");
    const half = featureCellOf(NOVA_LITE, "guardrails").querySelector(".feature-cell");
    expect(half.getAttribute("aria-label")).toBe("bedrock-runtime: 対応 / bedrock-mantle: 記載なし");
  });

  it("機能列は並べ替えできる (runtime ✓ > ✕ > 記載なし)", () => {
    mountFixtureApp({ features: sample });
    const th = headers()[headerKeys().indexOf("feature:structuredOutputs")];
    expect(th.classList.contains("sortable")).toBe(true);
    th.querySelector("button.sort-btn").click();
    const order = [...document.querySelectorAll("#models-table tbody tr[data-model-id]")].map((tr) => tr.dataset.modelId);
    // nova-lite (runtime ✓) → claude (runtime ✕) → 記載なし
    expect(order.indexOf(NOVA_LITE)).toBeLessThan(order.indexOf(CLAUDE));
    expect(order.indexOf(CLAUDE)).toBeLessThan(order.indexOf(COHERE));
  });
});

describe("FEATURE-001 列ピッカー", () => {
  it("features の全キーをチェックボックスで出し、既定列に印が付く", () => {
    mountFixtureApp({ features: sample });
    const boxes = [...document.querySelectorAll("#feature-picker input[type=checkbox]")];
    expect(boxes.map((box) => box.dataset.featureKey)).toEqual(Object.keys(sample.features));
    expect(boxes.filter((box) => box.checked).map((box) => box.dataset.featureKey)).toEqual(sample.defaultColumns);
    // 未知の機能名も docs の英語名で選べる
    expect(pickerBox("unknown:batch-mode").closest("label").textContent).toContain("Batch mode");
  });

  it("列を足す・外すと表の列が増減し、イベントが出る", () => {
    const app = mountFixtureApp({ features: sample });
    const seen = [];
    document.addEventListener(FEATURE_COLUMNS_EVENT, (event) => seen.push(event.detail.columns));
    toggleBox("countTokens", true);
    expect(headerKeys()).toContain("feature:countTokens");
    expect(featureCellOf(CLAUDE, "countTokens").textContent).toBe("runtime ✕ / mantle ✓");
    toggleBox("guardrails", false);
    expect(headerKeys()).not.toContain("feature:guardrails");
    // 列の並びは features の順に揃える
    expect(app.view.getFeatureColumns()).toEqual([
      "explicitPromptCaching",
      "structuredOutputs",
      "clientToolCalling",
      "countTokens",
    ]);
    expect(seen.length).toBe(2);
  });

  it("「既定に戻す」で defaultColumns に戻る", () => {
    const app = mountFixtureApp({ features: sample });
    toggleBox("guardrails", false);
    toggleBox("streaming", true);
    $("#feature-picker-reset").click();
    expect(app.view.getFeatureColumns()).toEqual(sample.defaultColumns);
    expect(pickerBox("streaming").checked).toBe(false);
    expect(pickerBox("guardrails").checked).toBe(true);
  });

  it("setFeatureColumns は未知キーを捨て、silent ならイベントを出さない", () => {
    const app = mountFixtureApp({ features: sample });
    let fired = 0;
    document.addEventListener(FEATURE_COLUMNS_EVENT, () => fired++);
    app.view.setFeatureColumns(["guardrails", "nope"], { silent: true });
    expect(app.view.getFeatureColumns()).toEqual(["guardrails"]);
    expect(headerKeys().slice(FIRST_FEATURE)).toEqual(["feature:guardrails"]);
    expect(pickerBox("guardrails").checked).toBe(true);
    expect(pickerBox("structuredOutputs").checked).toBe(false);
    expect(fired).toBe(0);
    app.view.setFeatureColumns([]);
    expect(headerKeys().some((key) => key.startsWith("feature:"))).toBe(false);
    expect(fired).toBe(1);
  });
});

describe("FEATURE-001 脚注", () => {
  it("取得日と出典 (docs のモデルカード) を出す", () => {
    mountFixtureApp({ features: sample });
    expect($("#footnote .footnote-feature-generated").textContent).toContain("2026-10-06T00:00:00.000Z");
    const link = $("#footnote a.feature-source-link");
    expect(link.href).toBe("https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html");
  });
});

describe("FEATURE-001 features が空", () => {
  it("機能列・ピッカー・脚注が出ず、例外にならない", () => {
    expect(() => mountFixtureApp({ features: {} })).not.toThrow();
    expect(headerKeys().some((key) => key?.startsWith("feature:"))).toBe(false);
    expect(headers()).toHaveLength(8);
    expect($("#feature-picker")?.hidden ?? true).toBe(true);
    expect($("#footnote .footnote-feature-generated")).toBeNull();
  });

  it("features を渡さなくても従来どおり 8 列", () => {
    mountFixtureApp();
    expect(headers()).toHaveLength(8);
  });
});
