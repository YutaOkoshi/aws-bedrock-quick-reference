// FEATURE-001 の結合テスト (jsdom)。表の機能列・列ピッカー・脚注・詳細パネルの機能の節。
import { describe, it, expect, beforeEach } from "vitest";
import { mountFixtureApp, rowFor, cells, $ } from "./app-harness.js";
import { FEATURE_COLUMNS_EVENT } from "../src/scripts/table-view.js";
import { setLang } from "../src/scripts/i18n.js";
import { panelId } from "../src/scripts/detail-view.js";
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

  // 言語切替は先に組み立てた画面も描き直すので、ファイルの先頭近くで 1 回だけ切り替える。
  it("列見出しと詳細パネルの機能名は ja でも en でも docs の英語名のまま", () => {
    const app = mountFixtureApp({ features: sample });
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
    app.detail.openRow(CLAUDE);
    const section = document.querySelector(`#${panelId(CLAUDE)} .detail-feature`);
    expect(section.querySelector("h4").textContent).toBe("Capabilities and Features");
    expect(section.querySelector('tr[data-key="guardrails"] td').textContent).toBe("Guardrails");
    expect(section.querySelector('.detail-caching-table tr[data-field="ttl"] td').textContent).toBe("5 minutes, 1 hour");
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

describe("FEATURE-001 / SHARE-001 cols= の復元と書き戻し", () => {
  it("cols= の指定を表の機能列に復元する", () => {
    const app = mountFixtureApp({ features: sample, search: "?cols=guardrails,streaming" });
    // 並びは features の順に揃える
    expect(app.view.getFeatureColumns()).toEqual(["streaming", "guardrails"]);
    expect(headerKeys().slice(FIRST_FEATURE)).toEqual(["feature:streaming", "feature:guardrails"]);
    expect(pickerBox("streaming").checked).toBe(true);
  });

  it("cols= (空) は機能列なし", () => {
    const app = mountFixtureApp({ features: sample, search: "?cols=" });
    expect(app.view.getFeatureColumns()).toEqual([]);
    expect(headerKeys().some((key) => key.startsWith("feature:"))).toBe(false);
    expect(app.location.search).toBe("?cols=");
  });

  it("既定の列のままなら URL に cols を載せない", () => {
    const app = mountFixtureApp({ features: sample });
    expect(app.location.search).toBe("");
    expect(app.share.currentUrl()).not.toContain("cols");
  });

  it("未知のキーは通知して捨て、URL からも落とす", () => {
    const app = mountFixtureApp({ features: sample, search: "?cols=guardrails,nope" });
    expect(app.view.getFeatureColumns()).toEqual(["guardrails"]);
    expect($("#share-notice").hidden).toBe(false);
    expect($("#share-notice").textContent).toContain("cols=nope");
    expect(app.location.search).toBe("?cols=guardrails");
  });

  it("ピッカーで列を変えると URL が replaceState で書き換わる", () => {
    const app = mountFixtureApp({ features: sample });
    const pushes = app.history.pushState.mock.calls.length;
    toggleBox("guardrails", false);
    expect(app.location.search).toBe(
      `?cols=${encodeURIComponent("explicitPromptCaching,structuredOutputs,clientToolCalling")}`,
    );
    $("#feature-picker-reset").click();
    expect(app.location.search).toBe("");
    expect(app.history.pushState.mock.calls.length).toBe(pushes);
  });
});

describe("FEATURE-001 / DETAIL-001 詳細パネルの機能の節", () => {
  const sectionOf = (app, modelId) => {
    app.detail.openRow(modelId);
    const panel = document.getElementById(panelId(modelId));
    return panel.querySelector(".detail-panel > .detail-feature");
  };

  it("レーンのパネル群の下に 1 回だけ置き、機能 × runtime / mantle の表を features の順で出す", () => {
    const app = mountFixtureApp({ features: sample });
    const section = sectionOf(app, CLAUDE);
    expect(section).not.toBeNull();
    const panel = document.getElementById(panelId(CLAUDE));
    // レーンのパネルごとには繰り返さない (DETAIL-001 AC-023)
    expect(panel.querySelectorAll(".detail-feature")).toHaveLength(1);
    expect(panel.querySelector(".lane-panel .detail-feature")).toBeNull();
    expect(section.previousElementSibling?.classList.contains("lane-panel")).toBe(true);
    // タブを切り替えても同じ節が見えたまま
    panel.querySelector('.lane-tab[data-lane="global"]').click();
    expect(section.isConnected && !section.hidden).toBe(true);
    expect(section.querySelector("h4").textContent).toBe("機能（Capabilities and Features）");
    const head = [...section.querySelectorAll(".detail-feature-table thead th")].map((th) => th.textContent);
    expect(head).toEqual(["機能", "bedrock-runtime", "bedrock-mantle"]);
    const rows = [...section.querySelectorAll(".detail-feature-table tbody tr")];
    expect(rows.map((tr) => tr.dataset.key)).toEqual([
      "streaming",
      "explicitPromptCaching",
      "structuredOutputs",
      "countTokens",
      "guardrails",
    ]);
    const guardrails = rows.find((tr) => tr.dataset.key === "guardrails");
    expect([...guardrails.children].map((td) => td.textContent)).toEqual(["Guardrails", "✓", "✕"]);
  });

  it("mantle の表が無いモデルは mantle 側を「—」(記載なし) にする", () => {
    const app = mountFixtureApp({ features: sample });
    const section = sectionOf(app, NOVA_LITE);
    const guardrails = section.querySelector('.detail-feature-table tr[data-key="guardrails"]');
    expect([...guardrails.children].map((td) => td.textContent)).toEqual(["Guardrails", "✓", "—"]);
    expect(section.querySelector(".detail-caching-table")).toBeNull();
    expect(section.querySelector(".detail-computer-use-table")).toBeNull();
  });

  it("Prompt caching の表は docs の値のまま", () => {
    const app = mountFixtureApp({ features: sample });
    const table = sectionOf(app, CLAUDE).querySelector(".detail-caching-table");
    const pairs = [...table.querySelectorAll(":scope > tbody > tr")].map((tr) => [tr.dataset.field, tr.querySelector("td").textContent]);
    expect(pairs).toEqual([
      ["explicit", "Yes"],
      ["minTokens", "512"],
      ["maxCheckpoints", "4"],
      ["ttl", "5 minutes, 1 hour"],
      ["fields", "system, messages, and tools"],
    ]);
  });

  it("Computer use の表に Tool type / Beta header を出す", () => {
    const app = mountFixtureApp({ features: sample });
    const table = sectionOf(app, CLAUDE).querySelector(".detail-computer-use-table");
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual(["Tool type", "Beta header"]);
    expect([...table.querySelectorAll(":scope > tbody td")].map((td) => td.textContent)).toEqual([
      "computer_20251124",
      "computer-use-2025-11-24",
    ]);
  });

  it("docs のモデルカードへのリンクを出す", () => {
    const app = mountFixtureApp({ features: sample });
    const link = sectionOf(app, CLAUDE).querySelector("a.detail-feature-card");
    expect(link.href).toBe(
      "https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-5-5.html",
    );
    expect(link.target).toBe("_blank");
  });

  it("byModel に無いモデルは記載なしの文言を出す", () => {
    const app = mountFixtureApp({ features: sample });
    const section = sectionOf(app, COHERE);
    expect(section.querySelector(".detail-no-feature").textContent).toBe(
      "公式 docs のモデルカードに機能の記載がありません",
    );
    expect(section.querySelector(".detail-feature-table")).toBeNull();
  });

  it("features が空でも例外にならず、記載なしの文言を出す (FEATURE-001 AC-014)", () => {
    const app = mountFixtureApp({ features: {} });
    expect(() => app.detail.openRow(CLAUDE)).not.toThrow();
    const section = document.querySelector(`#${panelId(CLAUDE)} .detail-feature`);
    expect(section.querySelector(".detail-no-feature").textContent).toBe(
      "公式 docs のモデルカードに機能の記載がありません",
    );
    expect(section.querySelector("a.detail-feature-card")).toBeNull();
    // 価格の節はそのまま出る
    expect(document.querySelector(`#${panelId(CLAUDE)} .detail-price`)).not.toBeNull();
  });

});
