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

// 列の見出しは 2 段ヘッダの下段 (1 段のときはその行)。
const headers = () => [...document.querySelectorAll("#models-table thead tr:last-child th")];
const headerKeys = () => headers().map((th) => th.dataset.key);
const headerText = (th) => (th.querySelector(".sort-btn") ?? th).textContent.replace(/[▼▲]/g, "").trim();
// 表に出ている機能キー (子列 2 つで 1 機能)。
const shownFeatures = () => [
  ...new Set(
    headerKeys()
      .filter((key) => key?.startsWith("feature:"))
      .map((key) => key.replace(/^feature:/, "").replace(/:(runtime|mantle)$/, "")),
  ),
];
const groupLabels = () =>
  [...document.querySelectorAll("#models-table thead tr.column-groups th.feature-group")].map((th) => th.textContent);
const featureCellOf = (modelId, key, side) => {
  const index = headerKeys().indexOf(`feature:${key}:${side}`);
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
  it("価格 2 列の右に、機能ごとの子列 Runtime / Mantle が defaultColumns の順で並ぶ", () => {
    mountFixtureApp({ features: sample });
    const keys = headerKeys();
    expect(keys[PRICE_OUTPUT]).toBe("priceOutput");
    expect(keys.slice(FIRST_FEATURE)).toEqual(
      sample.defaultColumns.flatMap((key) => [`feature:${key}:runtime`, `feature:${key}:mantle`]),
    );
    expect(headers().slice(FIRST_FEATURE).map(headerText)).toEqual(
      sample.defaultColumns.flatMap(() => ["Runtime", "Mantle"]),
    );
  });

  it("1 段目は モデル / 推論が実行される場所 / 価格 と、機能名の親見出し (colspan 2)", () => {
    mountFixtureApp({ features: sample });
    const top = [...document.querySelectorAll("#models-table thead tr.column-groups th")];
    expect(top.map((th) => [th.textContent, th.colSpan])).toEqual([
      ["モデル", 3],
      ["推論が実行される場所", 3],
      ["価格 · USD", 2],
      ["Explicit Prompt Caching", 2],
      ["Structured outputs", 2],
      ["Client-side tool calling", 2],
      ["Guardrails", 2],
    ]);
    expect(document.querySelectorAll("#models-table thead tr")).toHaveLength(2);
  });

  // 言語切替は先に組み立てた画面も描き直すので、ファイルの先頭近くで 1 回だけ切り替える。
  it("親見出しと詳細パネルの機能名は ja でも en でも docs の英語名のまま", () => {
    const app = mountFixtureApp({ features: sample });
    const names = ["Explicit Prompt Caching", "Structured outputs", "Client-side tool calling", "Guardrails"];
    expect(groupLabels()).toEqual(names);
    setLang("en");
    expect(groupLabels()).toEqual(names);
    expect(headers().slice(FIRST_FEATURE, FIRST_FEATURE + 2).map(headerText)).toEqual(["Runtime", "Mantle"]);
    app.detail.openRow(CLAUDE);
    const section = document.querySelector(`#${panelId(CLAUDE)} .detail-feature`);
    expect(section.querySelector("h4").textContent).toBe("Capabilities and Features");
    expect(section.querySelector('tr[data-key="guardrails"] td').textContent).toBe("Guardrails");
    expect(section.querySelector('.detail-caching-table tr[data-field="ttl"] td').textContent).toBe("5 minutes, 1 hour");
    setLang("ja");
  });

  it("セルは子列ごとに 1 記号で、3 状態を区別する", () => {
    mountFixtureApp({ features: sample });
    // 対応 / 非対応
    expect(featureCellOf(CLAUDE, "guardrails", "runtime").textContent).toBe("✓");
    expect(featureCellOf(CLAUDE, "guardrails", "mantle").textContent).toBe("✕");
    // 片側だけ記載なし (mantle の表が無い)。もう片方は値どおり
    expect(featureCellOf(NOVA_LITE, "guardrails", "runtime").textContent).toBe("✓");
    expect(featureCellOf(NOVA_LITE, "guardrails", "mantle").textContent).toBe("—");
    // 両方記載なしは両子列とも「—」。✕ にしない
    for (const side of ["runtime", "mantle"]) {
      const none = featureCellOf(COHERE, "guardrails", side);
      expect(none.textContent).toBe("—");
      expect(none.classList.contains("dim")).toBe(true);
    }
  });

  it("セルの aria-label に接続先と対応可否を言葉で書く", () => {
    mountFixtureApp({ features: sample });
    const label = (modelId, side) =>
      featureCellOf(modelId, "guardrails", side).querySelector(".feature-mark").getAttribute("aria-label");
    expect(label(CLAUDE, "runtime")).toBe("bedrock-runtime: 対応");
    expect(label(CLAUDE, "mantle")).toBe("bedrock-mantle: 非対応");
    expect(label(NOVA_LITE, "mantle")).toBe("bedrock-mantle: 記載なし");
  });

  it("子列ごとに並べ替えできる (✓ > ✕ > 記載なし)", () => {
    mountFixtureApp({ features: sample });
    const order = () =>
      [...document.querySelectorAll("#models-table tbody tr[data-model-id]")].map((tr) => tr.dataset.modelId);
    const sortBy = (key) => {
      const th = headers()[headerKeys().indexOf(key)];
      expect(th.classList.contains("sortable")).toBe(true);
      th.querySelector("button.sort-btn").click();
    };
    // Runtime: nova-lite (✓) → claude (✕) → 記載なし
    sortBy("feature:structuredOutputs:runtime");
    expect(order().indexOf(NOVA_LITE)).toBeLessThan(order().indexOf(CLAUDE));
    expect(order().indexOf(CLAUDE)).toBeLessThan(order().indexOf(COHERE));
    // Mantle: claude (✕) → nova-lite (記載なし)
    sortBy("feature:structuredOutputs:mantle");
    expect(order().indexOf(CLAUDE)).toBeLessThan(order().indexOf(NOVA_LITE));
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
    expect(shownFeatures()).toContain("countTokens");
    // 1 機能で Runtime / Mantle の 2 子列がそろって出る
    expect(featureCellOf(CLAUDE, "countTokens", "runtime").textContent).toBe("✕");
    expect(featureCellOf(CLAUDE, "countTokens", "mantle").textContent).toBe("✓");
    toggleBox("guardrails", false);
    expect(headerKeys().filter((key) => key?.startsWith("feature:guardrails"))).toEqual([]);
    // 列の並びは features の順に揃える
    expect(app.view.getFeatureColumns()).toEqual([
      "explicitPromptCaching",
      "structuredOutputs",
      "clientToolCalling",
      "countTokens",
    ]);
    expect(seen.length).toBe(2);
  });

  it("並べ替え中の機能を外すと、その子列での並べ替えも外れる", () => {
    mountFixtureApp({ features: sample });
    headers()[headerKeys().indexOf("feature:guardrails:mantle")].querySelector("button.sort-btn").click();
    expect(document.querySelector("#models-table thead th.sorted")?.dataset.key).toBe("feature:guardrails:mantle");
    toggleBox("guardrails", false);
    expect(document.querySelector("#models-table thead th.sorted")).toBeNull();
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
    expect(headerKeys().slice(FIRST_FEATURE)).toEqual(["feature:guardrails:runtime", "feature:guardrails:mantle"]);
    expect(pickerBox("guardrails").checked).toBe(true);
    expect(pickerBox("structuredOutputs").checked).toBe(false);
    expect(fired).toBe(0);
    app.view.setFeatureColumns([]);
    expect(shownFeatures()).toEqual([]);
    // 機能列が無くなれば 1 段ヘッダに戻る
    expect(document.querySelectorAll("#models-table thead tr")).toHaveLength(1);
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
    expect(shownFeatures()).toEqual([]);
    expect(headers()).toHaveLength(8);
    expect(document.querySelectorAll("#models-table thead tr")).toHaveLength(1);
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
    expect(shownFeatures()).toEqual(["streaming", "guardrails"]);
    expect(pickerBox("streaming").checked).toBe(true);
  });

  it("cols= (空) は機能列なし", () => {
    const app = mountFixtureApp({ features: sample, search: "?cols=" });
    expect(app.view.getFeatureColumns()).toEqual([]);
    expect(shownFeatures()).toEqual([]);
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

// 仕様変更 (2026-10-06): 既定の機能列は全機能。data/features.json の defaultColumns が全キーになる。
describe("FEATURE-001 既定が全機能のとき", () => {
  const allKeys = Object.keys(sample.features);
  const everything = { ...sample, defaultColumns: allKeys };

  it("全機能の列が features の順で価格の右に並ぶ", () => {
    mountFixtureApp({ features: everything });
    expect(shownFeatures()).toEqual(allKeys);
    expect(headerKeys().slice(FIRST_FEATURE)).toHaveLength(allKeys.length * 2);
    expect(groupLabels()).toEqual(allKeys.map((key) => sample.features[key].label));
  });

  it("ピッカーは全部チェック済みで始まり、外せる", () => {
    const app = mountFixtureApp({ features: everything });
    const boxes = [...document.querySelectorAll("#feature-picker input[type=checkbox]")];
    expect(boxes.every((box) => box.checked)).toBe(true);
    toggleBox("guardrails", false);
    expect(shownFeatures()).not.toContain("guardrails");
    expect(app.view.getFeatureColumns()).toEqual(allKeys.filter((key) => key !== "guardrails"));
    expect(new URLSearchParams(app.location.search).get("cols")).toBe(
      allKeys.filter((key) => key !== "guardrails").join(","),
    );
  });

  it("既定 (全機能) のままなら URL に cols を載せず、戻せば消える", () => {
    const app = mountFixtureApp({ features: everything });
    expect(app.location.search).toBe("");
    toggleBox("streaming", false);
    expect(app.location.search).toContain("cols=");
    toggleBox("streaming", true);
    expect(app.location.search).toBe("");
  });

  it("実データの defaultColumns も features のキーだけを指す", async () => {
    const real = (await import("../data/features.json")).default;
    const known = Object.keys(real.features);
    expect(real.defaultColumns.every((key) => known.includes(key))).toBe(true);
  });
});
