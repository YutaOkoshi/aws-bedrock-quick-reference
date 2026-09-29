// TABLE-001 v4 の結合テスト (jsdom)。AC-001 / 002 / 004 / 006 / 007 / 008 / 009 / 010 / 011 / 012。
import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { mountTableView, DOC_LINKS, DEFAULT_REGION } from "../src/scripts/table-view.js";
import { initI18n, setLang } from "../src/scripts/i18n.js";
import {
  buildSnapshot,
  buildOverrides,
  regionNotes,
  TOKYO,
  DENIED_REGION,
  EMPTY_REGION,
} from "./fixtures/bedrock-fixture.js";

const snapshot = buildSnapshot();

function mount(overrides = {}) {
  document.body.innerHTML = '<main id="main"></main>';
  localStorage.clear();
  initI18n();
  return mountTableView({
    host: document.getElementById("main"),
    models: snapshot.models,
    profiles: snapshot.profiles,
    fetchLog: snapshot.fetchLog,
    regionNotes,
    overrides,
    ...overrides.mountOverrides,
  });
}

const select = () => document.getElementById("source-region");
const headerTexts = () =>
  [...document.querySelectorAll("thead th")].map((th) => (th.querySelector(".sort-btn") ?? th).textContent.replace(/[▼▲]/g, "").trim());
const bodyRows = () => [...document.querySelectorAll("tbody tr")];
const rowFor = (modelId) => document.querySelector(`tbody tr[data-model-id="${CSS.escape(modelId)}"]`);
const cells = (tr) => [...tr.children];

beforeEach(() => {
  Object.defineProperty(navigator, "language", { value: "ja-JP", configurable: true });
});

// --- AC-001 起点リージョンセレクタの既定値 ---
describe("AC-001 起点リージョンセレクタ", () => {
  it("既定は ap-northeast-1 で、選択肢は region-notes.json のキー全件", () => {
    mount();
    expect(select().value).toBe(DEFAULT_REGION);
    expect(select().value).toBe("ap-northeast-1");
    const expected = Object.keys(regionNotes).filter((key) => key !== "_source").length;
    expect(select().options).toHaveLength(expected);
  });

  it("選択肢はリージョンコードと表示名を併記する", () => {
    mount();
    const option = [...select().options].find((o) => o.value === TOKYO);
    expect(option.textContent).toContain("ap-northeast-1");
    expect(option.textContent).toContain("東京");
  });

  it("未取得のリージョンも選べるが「（未取得）」と印が付く", () => {
    mount();
    const option = [...select().options].find((o) => o.value === DENIED_REGION);
    expect(option.disabled).toBe(false);
    expect(option.dataset.status).toBe("denied");
    expect(option.textContent).toContain("（未取得）");
  });
});

// --- AC-002 エンドポイント表示 ---
describe("AC-002 エンドポイント", () => {
  it("選択中リージョンの bedrock-runtime FQDN を出す", () => {
    mount();
    expect(document.getElementById("endpoint-value").textContent).toBe(
      "bedrock-runtime.ap-northeast-1.amazonaws.com",
    );
  });

  it("起点を切り替えると同じ位置の値も切り替わる", () => {
    const view = mount();
    view.setRegion("eu-west-1");
    expect(document.getElementById("endpoint-value").textContent).toBe(
      "bedrock-runtime.eu-west-1.amazonaws.com",
    );
  });

  it("セレクタの change でも切り替わる", () => {
    mount();
    select().value = "eu-west-1";
    select().dispatchEvent(new Event("change"));
    expect(document.getElementById("endpoint-value").textContent).toBe(
      "bedrock-runtime.eu-west-1.amazonaws.com",
    );
  });

  it("エンドポイントにコピーボタンがある", () => {
    mount();
    expect(document.getElementById("endpoint-copy")).not.toBeNull();
  });
});

// --- AC-006 表の列構成 ---
describe("AC-006 列構成と 1 行の中身", () => {
  it("列が左から プロバイダ / モデル名 / モダリティ / In-Region / Geo / Global / 入力 / 出力", () => {
    mount();
    expect(headerTexts()).toEqual([
      "プロバイダ",
      "モデル名",
      "モダリティ",
      "In-Region推論",
      "Geo推論",
      "Global推論",
      "入力単価",
      "出力単価",
    ]);
  });

  it("Model ID 列と lifecycle 列は無い", () => {
    mount();
    expect(headerTexts()).not.toContain("Model ID");
    expect(headerTexts()).not.toContain("モデル ID");
    expect(headerTexts()).not.toContain("lifecycle");
    const keys = [...document.querySelectorAll("thead th")].map((th) => th.dataset.key);
    expect(keys).toEqual([
      "provider",
      "name",
      "capability",
      "inRegion",
      "geo",
      "global",
      "priceInput",
      "priceOutput",
    ]);
  });

  it("1 行 = 1 モデル", () => {
    mount();
    expect(bodyRows()).toHaveLength(5);
    expect(new Set(bodyRows().map((tr) => tr.dataset.modelId)).size).toBe(5);
  });

  it("モデル名列には API の modelName が出る", () => {
    mount();
    expect(cells(rowFor("anthropic.claude-sonnet-4-5-20250929-v1:0"))[1].textContent).toBe(
      "Claude Sonnet 4.5",
    );
    expect(cells(rowFor("cohere.embed-v4:0"))[1].textContent).toBe("Embed v4");
  });

  it("行は プロバイダ → モデル名 の 2 段で、既定は Anthropic を先頭に固定する (AC-014)", () => {
    mount();
    expect(bodyRows().map((tr) => [...tr.children][0].textContent)).toEqual([
      "Anthropic",
      "Amazon",
      "Amazon",
      "Cohere",
      "NVIDIA",
    ]);
    expect(bodyRows().slice(1, 3).map((tr) => [...tr.children][1].textContent)).toEqual([
      "Nova Lite",
      "Titan Embeddings G1 - Text",
    ]);
  });

  it("In-Region が可のセルは ✓ と「可」だけでモデル ID を出さない (AC-003)", () => {
    mount();
    const cell = cells(rowFor("nvidia.nemotron-nano-12b-v2"))[3];
    expect(cell.textContent).toContain("可");
    expect(cell.textContent).toContain("✓");
    expect(cell.textContent).not.toContain("nvidia.nemotron-nano-12b-v2");
    expect(cell.querySelector(".copyable")).toBeNull();
  });

  it("In-Region が不可のモデルは「提供なし」 (AC-003)", () => {
    mount();
    const cell = cells(rowFor("anthropic.claude-sonnet-4-5-20250929-v1:0"))[3];
    expect(cell.textContent).toContain("提供なし");
    expect(cell.querySelector(".copyable")).toBeNull();
  });

  it("Geo 列は地理圏の見出しと地名の並びで、プロファイル ID は出ない (AC-004)", () => {
    mount();
    const cell = cells(rowFor("amazon.nova-lite-v1:0"))[4];
    expect(cell.querySelector(".geo-area").textContent).toBe("アジア太平洋");
    expect(cell.textContent).not.toContain("apac.amazon.nova-lite-v1:0");
    expect(cell.querySelector(".copyable")).toBeNull();
    // 判定の根拠となるプロファイル ID は data 属性としては残す (FILTER-001 / DETAIL-001 用)
    expect(cell.querySelector(".geo-entry").dataset.profileId).toBe("apac.amazon.nova-lite-v1:0");
    // 起点 (東京) → 同じ国 (大阪) → 残りは表示名の昇順
    expect([...cell.querySelectorAll(".geo-place")].map((place) => place.textContent)).toEqual([
      "東京",
      "大阪",
      "シドニー",
      "シンガポール",
      "ソウル",
      "ムンバイ",
    ]);
    expect(cell.querySelector(".geo-places").textContent).toContain(" ・ ");
  });

  it("Geo セルにリージョンコードは 1 つも出ない (AC-004)", () => {
    mount();
    for (const tr of bodyRows()) {
      const text = cells(tr)[4].textContent;
      expect(text).not.toMatch(/\b(?:us|eu|ap|ca|sa|af|me|il)-[a-z]+-\d\b/);
    }
    // コードは data 属性としてだけ残る
    const cell = cells(rowFor("amazon.nova-lite-v1:0"))[4];
    expect([...cell.querySelectorAll(".geo-place")].map((place) => place.dataset.region)).toEqual([
      "ap-northeast-1",
      "ap-northeast-3",
      "ap-southeast-2",
      "ap-southeast-1",
      "ap-northeast-2",
      "ap-south-1",
    ]);
  });

  it("起点の国の外の推論先に印が付き、件数が出る (AC-004)", () => {
    mount();
    const cell = cells(rowFor("amazon.nova-lite-v1:0"))[4];
    const outside = [...cell.querySelectorAll(".geo-place.is-outside")];
    expect(outside.map((place) => place.textContent)).toEqual([
      "シドニー",
      "シンガポール",
      "ソウル",
      "ムンバイ",
    ]);
    expect(cell.querySelector(".geo-outside-count").textContent).toBe("（国外 4）");
    // 同じ国 (日本) の推論先には印を付けない
    expect(cell.querySelector('.geo-place[data-region="ap-northeast-3"]').classList).not.toContain(
      "is-outside",
    );
    expect(cell.querySelector('.geo-place[data-region="ap-northeast-1"]').classList).toContain(
      "is-source",
    );
  });

  it("国外の推論先が無いブロックには件数を出さない (AC-004)", () => {
    mount();
    const jp = cells(rowFor("anthropic.claude-sonnet-4-5-20250929-v1:0"))[4].querySelector(
      '.geo-entry[data-prefix="jp"]',
    );
    expect([...jp.querySelectorAll(".geo-place")].map((place) => place.textContent)).toEqual([
      "東京",
      "大阪",
    ]);
    expect(jp.querySelectorAll(".geo-place.is-outside")).toHaveLength(0);
    expect(jp.querySelector(".geo-outside-count")).toBeNull();
  });

  it("英語では地名と区切りと件数が英語になる (AC-004)", () => {
    const view = mount();
    setLang("en");
    view.rerender();
    const cell = cells(rowFor("amazon.nova-lite-v1:0"))[4];
    expect(cell.querySelector(".geo-area").textContent).toBe("Asia Pacific");
    expect([...cell.querySelectorAll(".geo-place")].map((place) => place.textContent)).toEqual([
      "Asia Pacific (Tokyo)",
      "Asia Pacific (Osaka)",
      "Asia Pacific (Mumbai)",
      "Asia Pacific (Seoul)",
      "Asia Pacific (Singapore)",
      "Asia Pacific (Sydney)",
    ]);
    expect(cell.querySelector(".geo-outside-count").textContent).toBe("(4 outside country)");
    setLang("ja");
  });

  it("jp. プロファイルの地理圏は「日本国内」 (AC-004)", () => {
    mount();
    const areas = [
      ...cells(rowFor("anthropic.claude-sonnet-4-5-20250929-v1:0"))[4].querySelectorAll(".geo-area"),
    ].map((node) => node.textContent);
    expect(areas).toContain("日本国内");
  });

  it("Geo が無い行は「提供なし」", () => {
    mount();
    expect(cells(rowFor("nvidia.nemotron-nano-12b-v2"))[4].textContent).toContain("提供なし");
  });

  it("Global 列は ✓ と注記とリンクだけで、プロファイル ID は出ない (AC-005)", () => {
    mount();
    const cell = cells(rowFor("cohere.embed-v4:0"))[5];
    expect(cell.textContent).toContain("✓");
    expect(cell.textContent).not.toContain("global.cohere.embed-v4:0");
    expect(cell.querySelector(".copyable")).toBeNull();
    expect(cell.textContent).toContain("全世界の対応リージョン、増えうる");
    expect(cell.querySelector("a.global-note-link").href).toContain(
      "global-cross-region-inference",
    );
  });

  it("Global 列に \"*\" は決して現れない (AC-005)", () => {
    mount();
    for (const tr of bodyRows()) {
      expect(cells(tr)[5].textContent).not.toContain("*");
      expect(cells(tr)[4].textContent).not.toContain("*");
    }
  });

  it("一覧にMantle・備考列を出さず、備考データを詳細向けに保持する", () => {
    const view = mount(buildOverrides("cohere.embed-v4:0"));
    expect(headerTexts()).not.toContain("備考");
    expect(headerTexts()).not.toContain("Mantle");
    expect(cells(rowFor("cohere.embed-v4:0"))).toHaveLength(8);
    expect(view.getModel().rows.find(row => row.modelId === "cohere.embed-v4:0").notes[0].note.ja).toBe("モデルの備考");
  });
});

// --- AC-011 「モダリティ」の平易な表記 ---
describe("AC-011 モダリティ列", () => {
  it("列挙子ではなく平易な語で 入力 → 出力 が出る", () => {
    mount();
    const cell = cells(rowFor("amazon.nova-lite-v1:0"))[2];
    expect(cell.querySelector(".modality-in").textContent).toBe("テキスト・画像・動画");
    expect(cell.querySelector(".modality-out").textContent).toBe("テキスト");
    expect(cell.textContent).not.toContain("TEXT");
    expect(cell.textContent).not.toContain("IMAGE");
    expect(cell.textContent).not.toContain("VIDEO");
  });

  it("埋め込みのモデルも平易な語になる", () => {
    mount();
    const cell = cells(rowFor("cohere.embed-v4:0"))[2];
    expect(cell.querySelector(".modality-out").textContent).toBe("埋め込み");
    expect(cell.textContent).not.toContain("EMBEDDING");
  });

  it("英語では英語の語と区切りになる", () => {
    const view = mount();
    setLang("en");
    view.rerender();
    const cell = cells(rowFor("amazon.nova-lite-v1:0"))[2];
    expect(cell.querySelector(".modality-in").textContent).toBe("Text, Image, Video");
    expect(cell.querySelector(".modality-out").textContent).toBe("Text");
    setLang("ja");
  });

  it("SPEECH → SPEECH, TEXT も平易な語になる", () => {
    const speech = structuredClone(snapshot.models);
    speech["amazon.nova-lite-v1:0"].input = ["SPEECH"];
    speech["amazon.nova-lite-v1:0"].output = ["SPEECH", "TEXT"];
    mount({ mountOverrides: { models: speech } });
    const cell = cells(rowFor("amazon.nova-lite-v1:0"))[2];
    expect(cell.textContent).toBe("音声→音声・テキスト");
  });
});

// --- AC-012 旧版タグ ---
describe("AC-012 旧版タグ", () => {
  it("LEGACY のモデルにだけ「旧版」が付く", () => {
    const legacy = structuredClone(snapshot.models);
    legacy["cohere.embed-v4:0"].lifecycle = "LEGACY";
    mount({ mountOverrides: { models: legacy } });
    const tagged = cells(rowFor("cohere.embed-v4:0"))[1];
    expect(tagged.querySelector(".legacy-tag").textContent).toBe("旧版");
    expect(tagged.querySelector(".legacy-tag").title).toBe("LEGACY");
    expect(cells(rowFor("amazon.nova-lite-v1:0"))[1].querySelector(".legacy-tag")).toBeNull();
  });

  it("英語では Legacy", () => {
    const legacy = structuredClone(snapshot.models);
    legacy["cohere.embed-v4:0"].lifecycle = "LEGACY";
    const view = mount({ mountOverrides: { models: legacy } });
    setLang("en");
    view.rerender();
    expect(cells(rowFor("cohere.embed-v4:0"))[1].querySelector(".legacy-tag").textContent).toBe(
      "Legacy",
    );
    setLang("ja");
  });
});

// --- AC-007 表にコピーボタンを置かない ---
describe("AC-007 表にコピーボタンを置かない", () => {
  it("表の中に ID もコピーボタンも無い", () => {
    mount();
    const table = document.getElementById("models-table");
    expect(table.querySelectorAll(".copy-btn")).toHaveLength(0);
    expect(table.querySelectorAll(".copyable")).toHaveLength(0);
    expect(table.textContent).not.toContain("cohere.embed-v4:0");
    expect(table.textContent).not.toContain("apac.amazon.nova-lite-v1:0");
  });

  it("エンドポイントのコピーボタンは表の外にそのまま残る (AC-002)", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    mount();
    const button = document.getElementById("endpoint-copy");
    expect(document.getElementById("models-table").contains(button)).toBe(false);
    button.click();
    await vi.waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith("bedrock-runtime.ap-northeast-1.amazonaws.com");
  });
});

// --- AC-008 脚注 ---
describe("AC-008 脚注", () => {
  it("generatedAt / accountKind / denied 一覧 / 出典リンクが出る", () => {
    mount();
    const footnote = document.getElementById("footnote");
    expect(footnote.textContent).toContain("2026-09-14T08:10:00Z");
    expect(footnote.textContent).toContain("sandbox");
    const deniedNote = footnote.querySelector(".footnote-denied").textContent;
    expect(deniedNote).toContain("未取得のリージョン");
    expect(deniedNote).toContain(DENIED_REGION);
    expect(deniedNote).not.toContain("組織のポリシー");
    const links = [...footnote.querySelectorAll("a.doc-link")];
    expect(links).toHaveLength(DOC_LINKS.length);
    expect(links).toHaveLength(5);
    expect(links.map((a) => a.href)).toEqual(DOC_LINKS.map((link) => link.href));
  });
});

// --- AC-009 denied リージョン ---
describe("AC-009 denied リージョンを選んだとき", () => {
  it("バナーが出て「まだ取得できていません」とだけ伝え、表は 0 行になる", () => {
    const view = mount();
    view.setRegion(DENIED_REGION);
    const banner = document.getElementById("denied-banner");
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain("このリージョンのデータはまだ取得できていません");
    expect(banner.textContent).toContain("提供がないという意味ではありません");
    expect(bodyRows()).toHaveLength(0);
  });

  it("取得できなかった理由は画面に出さない (D-008)", () => {
    const view = mount();
    view.setRegion(DENIED_REGION);
    expect(document.getElementById("denied-cause")).toBeNull();
    const text = document.body.textContent;
    for (const sentence of [
      "組織のポリシーで取得できませんでした",
      "権限が足りず取得できませんでした",
      "このアカウントで有効化されていないリージョンです",
      "接続できませんでした",
    ]) {
      expect(text).not.toContain(sentence);
    }
    expect(text).not.toContain("cause.");
  });

  it("エラー原文は画面のどこにも出さない (D-008)", () => {
    const view = mount();
    view.setRegion(DENIED_REGION);
    const text = document.body.textContent;
    expect(text).not.toContain("AccessDenied");
    expect(text).not.toContain("service control policy");
    expect(text).not.toContain("arn:aws");
    expect(text).not.toContain("AWSReservedSSO");
  });

  it("「提供なし」の空状態は出さない (データなしと区別する)", () => {
    const view = mount();
    view.setRegion(DENIED_REGION);
    expect(document.getElementById("empty-state").hidden).toBe(true);
  });

  it("ok のリージョンに戻すとバナーは消える", () => {
    const view = mount();
    view.setRegion(DENIED_REGION);
    view.setRegion(TOKYO);
    expect(document.getElementById("denied-banner").hidden).toBe(true);
    expect(bodyRows()).toHaveLength(5);
  });
});

// --- AC-010 取得済みだがモデル 0 件 ---
describe("AC-010 取得済みでモデルが 0 件のとき", () => {
  it("「提供なし」を出し、データなしバナーは出さない", () => {
    const view = mount();
    view.setRegion(EMPTY_REGION);
    expect(bodyRows()).toHaveLength(0);
    const empty = document.getElementById("empty-state");
    expect(empty.hidden).toBe(false);
    expect(empty.textContent).toBe("このリージョンでは提供なし");
    expect(document.getElementById("denied-banner").hidden).toBe(true);
  });
});

// --- 後続 spec 用のフック ---
describe("FILTER-001 / DETAIL-001 / SHARE-001 のためのフック", () => {
  it("絞り込みと詳細の入れ物が用意されている", () => {
    mount();
    expect(document.getElementById("filter-bar").dataset.hook).toBe("FILTER-001");
    expect(document.getElementById("detail-host").dataset.hook).toBe("DETAIL-001");
  });

  it("起点リージョンの変更がイベントで外に出る", () => {
    const view = mount();
    const seen = [];
    document.addEventListener("source-region-changed", (event) => seen.push(event.detail));
    view.setRegion(EMPTY_REGION);
    expect(seen).toHaveLength(1);
    expect(seen[0].region).toBe(EMPTY_REGION);
    expect(seen[0].rows).toEqual([]);
  });
});

afterEach(() => {
  setLang("ja");
});

// --- 言語切替と表 (I18N-001 AC-003 / AC-004 の表側) ---
describe("言語を切り替えても表のデータ値は変わらない", () => {
  it("列ヘッダは英語になり、モデル名 / リージョンコード / provider は不変", () => {
    const view = mount();
    const before = {
      name: cells(rowFor("cohere.embed-v4:0"))[1].textContent,
      provider: cells(rowFor("cohere.embed-v4:0"))[0].textContent,
      // 地名は翻訳されるが、その裏にあるリージョンコードは不変
      regions: [...cells(rowFor("amazon.nova-lite-v1:0"))[4].querySelectorAll(".geo-place")]
        .map((place) => place.dataset.region)
        .sort(),
    };

    setLang("en");
    view.rerender();

    expect(headerTexts()[2]).toBe("Modalities");
    expect(cells(rowFor("cohere.embed-v4:0"))[1].textContent).toBe(before.name);
    expect(cells(rowFor("cohere.embed-v4:0"))[0].textContent).toBe(before.provider);
    expect(
      [...cells(rowFor("amazon.nova-lite-v1:0"))[4].querySelectorAll(".geo-place")]
        .map((place) => place.dataset.region)
        .sort(),
    ).toEqual(before.regions);
  });

  it("未取得バナーの文言は翻訳する", () => {
    const view = mount();
    view.setRegion(DENIED_REGION);
    const banner = () => document.getElementById("denied-banner").textContent;
    expect(banner()).toContain("このリージョンのデータはまだ取得できていません");
    setLang("en");
    view.rerender();
    expect(banner()).toContain("Data for this Region has not been fetched yet");
    expect(banner()).toContain("This does not mean the models are not offered here");
  });
});
