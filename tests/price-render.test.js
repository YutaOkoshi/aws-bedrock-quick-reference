// PRICE-001 の結合テスト (jsdom)。AC-007 / AC-008 / AC-009 / AC-010 / AC-011。
import { describe, it, expect, beforeEach } from "vitest";
import { mountFixtureApp, rowFor, cells, buildPrices } from "./app-harness.js";
import { panelId } from "../src/scripts/detail-view.js";
import { formatPrice } from "../src/scripts/bedrock-view-model.mjs";
import { buildMantlePriceRows, buildPriceRows } from "../src/scripts/detail-model.mjs";
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
    // D-018: 「価格未収録」の後ろに docs へのリンクが付く
    expect(cells(rowFor(CLAUDE))[PRICE_INPUT].querySelector(".dim").textContent).toBe("価格未収録");
    expect(cells(rowFor(CLAUDE))[PRICE_INPUT].querySelector("a.price-docs-link")).not.toBeNull();
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

// Runtime と Mantle は別の接続先で、単価も別に決まる。混ぜずにそれぞれ出す。
describe("Runtime と Mantle の価格を分けて出す", () => {
  const both = { byModel: { [CLAUDE]: { [TOKYO]: {
    standard: { input: 0.18, output: 1.41 },
    mantle: { standard: { input: 0.168, output: 1.44 }, batch: { input: 0.084 } },
  } } } };
  const inRegionPrice = () => panelOf(CLAUDE).querySelector('[data-lane="inRegion"] .detail-price');
  // fixture の Claude は東京で In-Region 不可・Geo 可。呼べるレーン (Geo) の価格の節で確かめる (AC-016)。
  const geoPrice = () => panelOf(CLAUDE).querySelector('[data-lane="geo"] .detail-price');

  it("buildMantlePriceRows は mantle の種別を PRICE_KINDS の順で返し、Runtime の単価を含まない", () => {
    expect(buildMantlePriceRows(CLAUDE, { prices: both, region: TOKYO })).toEqual([
      { kind: "standard", input: 0.168, output: 1.44 },
      { kind: "batch", input: 0.084, output: null },
    ]);
    expect(buildPriceRows(CLAUDE, { prices: both, region: TOKYO })[0]).toEqual({ kind: "standard", input: 0.18, output: 1.41 });
    expect(buildMantlePriceRows(CLAUDE, { prices: { byModel: {} }, region: TOKYO })).toEqual([]);
  });

  it("詳細の価格の節に bedrock-runtime と bedrock-mantle の表が別々に出る", () => {
    mountFixtureApp({ prices: both });
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const section = geoPrice();
    const runtime = section.querySelector(".detail-price-runtime");
    const mantle = section.querySelector(".detail-price-mantle");
    expect(runtime.textContent).toContain("bedrock-runtime");
    expect(runtime.textContent).toContain("$0.18");
    expect(runtime.textContent).not.toContain("$0.168");
    expect(mantle.textContent).toContain("bedrock-mantle");
    expect(mantle.textContent).toContain("$0.168");
    expect(mantle.textContent).toContain("$1.44");
    expect(mantle.textContent).not.toContain("$1.41");
  });

  it("Mantle の単価しか無いモデルは、Runtime は「価格データなし」で Mantle の表だけ出る。一覧の価格列は Runtime のまま", () => {
    mountFixtureApp({ prices: { byModel: { [CLAUDE]: { [TOKYO]: { mantle: { standard: { input: 2.2, output: 6.6 } } } } } } });
    expect(cells(rowFor(CLAUDE))[PRICE_INPUT].textContent).not.toContain("$2.20");
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const section = geoPrice();
    expect(section.querySelector(".detail-price-runtime").textContent).toContain("この起点リージョンの価格データがありません");
    expect(section.querySelector(".detail-price-mantle").textContent).toContain("$2.20");
  });

  it("Mantle の単価が無ければ Mantle の表は出さない", () => {
    mountFixtureApp({ prices: { byModel: { [CLAUDE]: { [TOKYO]: { standard: { input: 3, output: 15 } } } } } });
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    expect(geoPrice().querySelector(".detail-price-table")).not.toBeNull();
    expect(geoPrice().querySelector(".detail-price-mantle")).toBeNull();
  });
});

describe("長文コンテキストの単価 (境界のトークン数が価格表に無いとき)", () => {
  const prices = { byModel: { [CLAUDE]: { [TOKYO]: { global: { input: 10, output: 50, longContext: { input: 20, output: 75 } } } } } };

  it("「長文コンテキスト」の行に単価が出て、トークン数の条件は出ない (ja)", () => {
    mountFixtureApp({ prices });
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const global = panelOf(CLAUDE).querySelector('[data-lane="global"] .detail-price');
    const rows = [...global.querySelectorAll(".detail-price-row")].map((row) => row.textContent);
    expect(rows).toHaveLength(2);
    expect(rows[1]).toContain("長文コンテキスト");
    expect(rows[1]).toContain("$20.00");
    expect(rows[1]).toContain("$75.00");
    expect(global.textContent).not.toContain("tokens 超");
    expect(global.textContent).not.toContain("tokens 以下");
  });

  it("英語では long context と出る (en)", () => {
    mountFixtureApp({ prices });
    setLang("en");
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const global = panelOf(CLAUDE).querySelector('[data-lane="global"] .detail-price');
    expect(global.textContent).toContain("long context");
    expect(global.textContent).not.toContain("Input >");
    expect(global.textContent).not.toContain("Input ≤");
    setLang("ja");
  });
});

describe("詳細の価格: レビュー (2026-10-08) で見つかった表示の問題", () => {
  it("Runtime に priority / flex しか無くても標準系のレーンに表を出す (Qwen3 Next 80B の東京)", () => {
    const prices = { byModel: { [CLAUDE]: { [TOKYO]: { priority: { input: 0.32, output: 2.54 }, flex: { input: 0.09, output: 0.72 } } } } };
    expect(buildPriceRows(CLAUDE, { prices, region: TOKYO }).map((row) => row.kind)).toEqual(["priority", "flex"]);
    mountFixtureApp({ prices });
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const section = panelOf(CLAUDE).querySelector('[data-lane="geo"] .detail-price');
    expect(section.textContent).toContain("優先");
    expect(section.textContent).toContain("$0.32");
    expect(section.textContent).not.toContain("この起点リージョンの価格データがありません");
  });

  it("Mantle の表があるとき、Global のバッチ・キャッシュ未収録の注記は bedrock-runtime に限った文言にする", () => {
    const prices = { byModel: { [CLAUDE]: { [TOKYO]: { mantle: { global: { input: 2, output: 6 }, batch: { input: 1.1 } } } } } };
    mountFixtureApp({ prices });
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const global = panelOf(CLAUDE).querySelector('[data-lane="global"] .detail-price');
    const notes = global.querySelector(".detail-price-unit").textContent;
    expect(notes).toContain("bedrock-runtime の Global 用のバッチ・キャッシュ価格は未収録");
    expect(notes.split("Global 用のバッチ・キャッシュ価格は未収録")).toHaveLength(2);
  });
});

// D-018: Price List に無いモデルは AWS Marketplace の offer の単価を出し、出典を書く。
// それでも単価が無いモデルは、docs のモデルカードへのリンクを出す。
describe("Marketplace の単価の出典と、価格未収録のときの docs リンク", () => {
  const marketplace = { byModel: { [CLAUDE]: { [TOKYO]: {
    standard: { input: 2.2, output: 13.2 }, global: { input: 2, output: 12 },
    source: { type: "marketplace", offerId: "offer-3dvyrx3okd4lq" },
  } } } };

  it("一覧の価格に「出典: Marketplace」が添えられる", () => {
    mountFixtureApp({ prices: marketplace });
    const cell = cells(rowFor(CLAUDE))[PRICE_INPUT];
    expect(cell.querySelector(".price-value").textContent).toBe("$2.00");
    expect(cell.querySelector(".price-source").textContent).toBe("出典: Marketplace");
  });

  it("Price List の単価には出典の注記を付けない", () => {
    mountFixtureApp();
    expect(cells(rowFor(CLAUDE))[PRICE_INPUT].querySelector(".price-source")).toBeNull();
  });

  it("詳細の価格の節に、offer ID 付きの出典が出る", () => {
    mountFixtureApp({ prices: marketplace });
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const source = panelOf(CLAUDE).querySelector('[data-lane="geo"] .detail-price .detail-price-source');
    expect(source.textContent).toContain("AWS Marketplace");
    expect(source.textContent).toContain("offer-3dvyrx3okd4lq");
    expect(source.textContent).toContain("Price List");
  });

  it("価格未収録のモデルは、一覧と詳細に docs のモデルカードへのリンクが出る", () => {
    const features = { byModel: { [CLAUDE]: { card: "model-card-xai-grok-4-7.html", runtime: {}, mantle: {} } } };
    mountFixtureApp({ prices: { byModel: {} }, features });
    const link = cells(rowFor(CLAUDE))[PRICE_INPUT].querySelector("a.price-docs-link");
    expect(link.href).toBe("https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html");
    expect(cells(rowFor(CLAUDE))[PRICE_INPUT].textContent).toContain("価格未収録");
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const detailLink = panelOf(CLAUDE).querySelector('[data-lane="inRegion"] .detail-price a.price-docs-link');
    expect(detailLink.href).toBe("https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-xai-grok-4-7.html");
  });

  it("モデルカードが分からないモデルは、Bedrock の料金ページへのリンクにする", () => {
    mountFixtureApp({ prices: { byModel: {} } });
    const link = cells(rowFor(CLAUDE))[PRICE_INPUT].querySelector("a.price-docs-link");
    expect(link.href).toBe("https://aws.amazon.com/bedrock/pricing/");
  });
});

describe("Global のバッチ・キャッシュ (2026-10-08 から取り込む)", () => {
  const prices = { byModel: { [CLAUDE]: { [TOKYO]: {
    global: { input: 5, output: 25 },
    globalBatch: { input: 2.5, output: 12.5 },
    globalCacheRead: { input: 0.5 },
    globalCacheWrite: { input: 6.25 },
  } } } };

  it("buildPriceRows の Global のレーンに、Global のバッチ・キャッシュの行が並ぶ", () => {
    expect(buildPriceRows(CLAUDE, { prices, region: TOKYO, lane: "global" }).map((row) => row.kind)).toEqual([
      "global", "globalBatch", "globalCacheRead", "globalCacheWrite",
    ]);
  });

  it("詳細の Global のタブに出て、「未収録」の注記は出ない", () => {
    mountFixtureApp({ prices });
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const global = panelOf(CLAUDE).querySelector('[data-lane="global"] .detail-price');
    expect(global.textContent).toContain("Global バッチ");
    expect(global.textContent).toContain("$12.50");
    expect(global.textContent).toContain("Global キャッシュ読み");
    expect(global.textContent).toContain("Global キャッシュ書き");
    expect(global.textContent).not.toContain("バッチ・キャッシュ価格は未収録");
  });

  it("In-Region のタブには Global の行を出さない", () => {
    expect(buildPriceRows(CLAUDE, { prices, region: TOKYO, lane: "inRegion" })).toEqual([]);
  });
});
