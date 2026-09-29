// PRICE-001 の結合テスト (jsdom)。AC-007 / AC-008 / AC-009 / AC-010 / AC-011。
import { describe, it, expect, beforeEach } from "vitest";
import { mountFixtureApp, rowFor, cells, buildPrices } from "./app-harness.js";
import { panelId } from "../src/scripts/detail-view.js";
import { formatPrice } from "../src/scripts/bedrock-view-model.mjs";
import { buildPriceRows } from "../src/scripts/detail-model.mjs";
import { setLang } from "../src/scripts/i18n.js";
import { TOKYO } from "./fixtures/bedrock-fixture.js";

const CLAUDE = "anthropic.claude-sonnet-4-5-20250929-v1:0";
const NOVA_LITE = "amazon.nova-lite-v1:0";
const NVIDIA = "nvidia.nemotron-nano-12b-v2";

const PRICE_INPUT = 6;
const PRICE_OUTPUT = 7;
const GLOBAL = 5;

const panelOf = (modelId) => document.getElementById(panelId(modelId));
const headerTexts = () =>
  [...document.querySelectorAll("thead th")].map((th) => (th.querySelector(".sort-btn") ?? th).textContent.replace(/[▼▲]/g, "").trim());

beforeEach(() => {
  Object.defineProperty(navigator, "language", { value: "ja-JP", configurable: true });
});

// --- AC-007 価格列 ---
describe("AC-007 入力 / 出力 の価格列", () => {
  it("Global の右に 入力単価 と 出力単価 の 2 列が並ぶ", () => {
    mountFixtureApp();
    const headers = headerTexts();
    expect(headers[GLOBAL]).toBe("Global推論");
    expect(headers[PRICE_INPUT]).toBe("入力単価");
    expect(headers[PRICE_OUTPUT]).toBe("出力単価");
  });

  it("単価は $ 付きで出て、セルは右寄せ (num) になる", () => {
    mountFixtureApp();
    const row = rowFor(CLAUDE);
    expect(cells(row)[PRICE_INPUT].querySelector(".price-value").textContent).toBe("$3.00");
    expect(cells(row)[PRICE_OUTPUT].querySelector(".price-value").textContent).toBe("$15.00");
    expect(cells(row)[PRICE_INPUT].classList.contains("num")).toBe(true);
    expect(cells(row)[PRICE_OUTPUT].classList.contains("num")).toBe(true);
  });

  it("$1 以上は小数 2 桁、$1 未満は有効数字 3 桁", () => {
    expect(formatPrice(3.3)).toBe("3.30");
    expect(formatPrice(16.5)).toBe("16.50");
    expect(formatPrice(5)).toBe("5.00");
    expect(formatPrice(0.288)).toBe("0.288");
    expect(formatPrice(0.072)).toBe("0.072");
    expect(formatPrice(0.018)).toBe("0.018");
    expect(formatPrice(0.0001234)).toBe("0.000123");
    expect(formatPrice(0)).toBe("0");
    expect(formatPrice(null)).toBeNull();
    expect(formatPrice(undefined)).toBeNull();
  });

  it("画面でも $1 未満のモデルは有効数字 3 桁で出る", () => {
    mountFixtureApp();
    expect(cells(rowFor(NOVA_LITE))[PRICE_INPUT].querySelector(".price-value").textContent).toBe("$0.072");
    expect(cells(rowFor(NOVA_LITE))[PRICE_OUTPUT].querySelector(".price-value").textContent).toBe("$0.288");
  });

  it("価格列は並べ替えできる (数値として比べる)", () => {
    mountFixtureApp();
    const th = [...document.querySelectorAll("thead th")][PRICE_INPUT];
    expect(th.dataset.key).toBe("priceInput");
    expect(th.classList.contains("sortable")).toBe(true);
    th.querySelector("button.sort-btn").click();
    const values = [...document.querySelectorAll("tbody tr[data-model-id]")]
      .map((tr) => cells(tr)[PRICE_INPUT].querySelector(".price-value")?.textContent)
      .filter((text) => text && text !== "—")
      .map((text) => Number(text.slice(1)));
    expect(values).toEqual([...values].sort((a, b) => b - a));
  });
});

// --- AC-008 Global セルの単価 ---
describe("Global の単価も入力・出力の価格欄に表示する", () => {
  it("Globalが使えるモデルはGlobalの1組だけを表示する", () => {
    mountFixtureApp();
    const globalCell = cells(rowFor(CLAUDE))[GLOBAL];
    expect(globalCell.querySelector(".global-price")).toBeNull();
    expect(cells(rowFor(CLAUDE))[PRICE_INPUT].textContent).toBe("Global$3.00");
    expect(cells(rowFor(CLAUDE))[PRICE_OUTPUT].textContent).toBe("Global$15.00");
    // 判定そのもの (✓ と注記) は変わらない
    expect(globalCell.textContent).toContain("✓");
    expect(globalCell.textContent).toContain("全世界の対応リージョン");
  });

  it("Globalが使えないモデルではGlobal価格が収録されていても採用しない", () => {
    const prices = buildPrices();
    prices.byModel[NOVA_LITE][TOKYO].global = { input: .001, output: .002 };
    mountFixtureApp({ prices });
    const input = cells(rowFor(NOVA_LITE))[PRICE_INPUT];
    expect(input.textContent).toBe("In-Region / Geo$0.072");
    expect(input.querySelectorAll(".price-value")).toHaveLength(1);
    expect(input.querySelector(".price-sort-badge")).toBeNull();
  });

  it("Global 価格が無いモデルの Global セルには単価を出さない", () => {
    mountFixtureApp();
    expect(cells(rowFor(NVIDIA))[GLOBAL].querySelector(".global-price")).toBeNull();
  });
});

// --- AC-009 脚注 ---
describe("AC-009 脚注に価格の取得日と出典を出す", () => {
  it("価格の取得日・価格表の発行日・出典リンクが出る", () => {
    mountFixtureApp();
    const footnote = document.getElementById("footnote");
    expect(footnote.querySelector(".footnote-price-generated").textContent).toContain(
      "価格の取得日: 2026-09-14T09:00:00Z",
    );
    const source = footnote.querySelector(".footnote-price-source");
    expect(source.textContent).toContain("価格表の発行日: 2026-09-11");
    const link = source.querySelector("a.price-source-link");
    expect(link.href).toContain("pricing.us-east-1.amazonaws.com");
    expect(link.textContent).toBe("AWS Price List Bulk API");
  });

  it("価格データが無ければ価格の脚注は出ない", () => {
    mountFixtureApp({ prices: {} });
    expect(document.querySelector(".footnote-price-generated")).toBeNull();
    expect(document.querySelector(".footnote-price-source")).toBeNull();
  });
});

// --- AC-010 詳細パネルの価格 (DETAIL-001 v8 AC-013: レーンごと) ---
describe("AC-010 詳細パネルの価格", () => {
  const laneOf = (modelId, lane) =>
    panelOf(modelId).querySelector(`[role="tabpanel"][data-lane="${lane}"]`);

  it("種別 × 入力 / 出力 の表が起点リージョンの単価で出る", () => {
    mountFixtureApp();
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const section = laneOf(CLAUDE, "geo").querySelector(".detail-price");
    expect(section.querySelector("h4").textContent).toBe("価格");
    expect(
      [...section.querySelectorAll(".detail-price-table thead th")].map((th) => th.textContent),
    ).toEqual(["種別", "入力", "出力"]);
    const rows = [...section.querySelectorAll(".detail-price-table tbody tr")].map((tr) => [
      tr.dataset.kind,
      ...[...tr.children].map((td) => td.textContent),
    ]);
    // Geo のレーンは標準系だけ。Global の単価は Global のレーンに出る (AC-013)。
    expect(rows).toEqual([
      ["standard", "標準", "$3.30", "$16.50"],
      ["batch", "バッチ", "$1.65", "—"],
      ["cacheRead", "キャッシュ読み", "$0.33", "—"],
    ]);
    expect(section.querySelector(".detail-price-unit").textContent).toContain("100 万トークン");
  });

  it("Global のレーンには global の行だけが出る", () => {
    mountFixtureApp();
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const rows = [
      ...laneOf(CLAUDE, "global").querySelectorAll(".detail-price-table tbody tr"),
    ].map((tr) => [tr.dataset.kind, ...[...tr.children].map((td) => td.textContent)]);
    expect(rows).toEqual([["global", "Global", "$3.00", "$15.00"]]);
  });

  it("buildPriceRows はレーンごとに種別を絞る", () => {
    const prices = buildPrices();
    expect(
      buildPriceRows(NOVA_LITE, { prices, region: TOKYO, lane: "inRegion" }).map((row) => row.kind),
    ).toEqual(["standard", "batch", "cacheRead"]);
    expect(
      buildPriceRows(NOVA_LITE, { prices, region: TOKYO, lane: "global" }).map((row) => row.kind),
    ).toEqual([]);
    expect(buildPriceRows("no-such-model", { prices, region: TOKYO, lane: "geo" })).toEqual([]);
  });

  it("英語でも同じ表が出る", () => {
    mountFixtureApp({ lang: "en-US" });
    setLang("en");
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const section = laneOf(CLAUDE, "geo").querySelector(".detail-price");
    expect(section.querySelector("h4").textContent).toBe("Pricing");
    expect(section.querySelector('tr[data-kind="standard"] td').textContent).toBe("Standard");
  });
});

// --- AC-011 価格が無いとき ---
describe("AC-011 価格が無いモデル", () => {
  it("価格が未収録なら一覧に明示し、詳細パネルは「価格データなし」", () => {
    // 価格を持たない (空の) prices を渡すと全モデルが「—」
    mountFixtureApp({ prices: {} });
    expect(cells(rowFor(CLAUDE))[PRICE_INPUT].textContent).toBe("価格未収録");
    expect(cells(rowFor(CLAUDE))[PRICE_INPUT].querySelector(".dim")).not.toBeNull();

    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const section = panelOf(CLAUDE).querySelector(".detail-price");
    expect(section.querySelector(".detail-price-table")).toBeNull();
    expect(section.querySelector(".detail-no-price").textContent).toBe(
      "この起点リージョンの価格データがありません",
    );
  });

  it("Global だけのモデルも共通の価格欄で比較できる", () => {
    const prices = { byModel: { [CLAUDE]: { [TOKYO]: { global: { input: 3, output: 15 } } } } };
    mountFixtureApp({ prices });
    expect(cells(rowFor(CLAUDE))[PRICE_INPUT].textContent).toBe("Global$3.00");
    expect(cells(rowFor(CLAUDE))[PRICE_OUTPUT].textContent).toBe("Global$15.00");
  });

  it("起点に価格がない場合は参考リージョンを明示し、詳細には混ぜない", () => {
    const prices = { byModel: { [CLAUDE]: { "us-east-1": { standard: { input: 2, output: 10 } } } } };
    mountFixtureApp({ prices });
    expect(cells(rowFor(CLAUDE))[PRICE_INPUT].textContent).toBe("In-Region / Geo$2.00参考: us-east-1");
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    expect(panelOf(CLAUDE).querySelector(".detail-no-price")).not.toBeNull();
  });

  it("価格が無くても表そのものは描画される (行数は変わらない)", () => {
    mountFixtureApp({ prices: {} });
    expect(document.querySelectorAll("tbody tr[data-model-id]")).toHaveLength(5);
  });
});

describe("単位付き料金と長文条件の表示", () => {
  it("画像・秒料金は一覧と詳細に単位付きで出る", () => {
    mountFixtureApp({ prices: { byModel: { [CLAUDE]: { [TOKYO]: { metered: [
      { scope: 'standard', label: 'Image', axis: 'output', unit: 'image', value: .04 },
      { scope: 'global', label: 'Video', axis: 'input', unit: 'second', value: .00049 },
    ] } } } } });
    expect(cells(rowFor(CLAUDE))[PRICE_INPUT].textContent).toContain('Global$0.00049 / 秒');
    expect(cells(rowFor(CLAUDE))[PRICE_OUTPUT].textContent).toBe('—');
    rowFor(CLAUDE).querySelector('.detail-toggle').click();
    const global = panelOf(CLAUDE).querySelector('[data-lane="global"] .detail-price');
    expect(global.textContent).toContain('$0.00049 / 秒');
    expect(global.textContent).not.toContain('$0.04 / 画像');
  });
  it("一覧は短文条件、詳細は短文と長文の両方を表示する", () => {
    mountFixtureApp({ prices: { byModel: { [CLAUDE]: { [TOKYO]: { global: {
      input: 10, output: 50, maxInputTokens: 272000, longContext: { input: 20, output: 75 },
    } } } } } });
    expect(cells(rowFor(CLAUDE))[PRICE_INPUT].textContent).toContain('入力 272,000 tokens 以下');
    rowFor(CLAUDE).querySelector('.detail-toggle').click();
    const global = panelOf(CLAUDE).querySelector('[data-lane="global"] .detail-price');
    expect(global.textContent).toContain('入力 272,000 tokens 超');
    expect(global.textContent).toContain('$20.00');
    expect(global.textContent).toContain('$75.00');
  });
});
