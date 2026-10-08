// DETAIL-001 v8 の描画 (jsdom)。共通の見出し行・レーンのタブ・タブパネルの中身。
import { describe, it, expect, beforeEach, vi } from "vitest";
import { mountFixtureApp, rowFor, bodyRows } from "./app-harness.js";
import { panelId } from "../src/scripts/detail-view.js";
import { setLang } from "../src/scripts/i18n.js";
import {
  CLAUDE_45,
  DENIED_REGION,
  EXTRA_PROFILES,
  NO_LANE_MODEL,
  NVIDIA,
  regionNotesWithoutCountry,
} from "./fixtures/bedrock-fixture.js";

const NOVA = "amazon.nova-lite-v1:0";

const panelOf = (modelId) => document.getElementById(panelId(modelId));
const open = (modelId) => {
  rowFor(modelId).querySelector(".detail-toggle").click();
  return panelOf(modelId);
};
const tabsOf = (panel) => [...panel.querySelectorAll('.lane-tabs [role="tab"]')];
const tabFor = (panel, lane) => panel.querySelector(`.lane-tabs [role="tab"][data-lane="${lane}"]`);
const laneOf = (panel, lane) => panel.querySelector(`[role="tabpanel"][data-lane="${lane}"]`);
const visibleLane = (panel) =>
  [...panel.querySelectorAll('[role="tabpanel"]')].find((element) => !element.hidden);

let app;
beforeEach(() => {
  app = mountFixtureApp({ extraProfiles: EXTRA_PROFILES });
});

describe("AC-001 行の展開", () => {
  it("トグルのクリックでパネルが挿入され aria-expanded が切り替わる", () => {
    const toggle = rowFor(NOVA).querySelector(".detail-toggle");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    toggle.click();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(panelOf(NOVA)).not.toBeNull();
    expect(toggle.getAttribute("aria-controls")).toBe(panelId(NOVA));
    toggle.click();
    expect(panelOf(NOVA)).toBeNull();
  });

  it("起点を切り替えても対象モデルが表に残っていれば開いたまま", () => {
    open(NOVA);
    app.view.setRegion("ap-northeast-3");
    expect(panelOf(NOVA)).not.toBeNull();
  });
});

describe("AC-010 共通の見出し行", () => {
  it("モデル ID がコピーボタン付きで出て、コピー文字列が ID と完全一致する", () => {
    const grid = open(CLAUDE_45).querySelector(".head-grid");
    const item = grid.querySelector('[data-item="detail.modelId"]');
    expect(item.querySelector(".id").textContent).toBe(CLAUDE_45);
    expect(item.querySelector(".copy-btn").dataset.copy).toBe(CLAUDE_45);
  });

  it("bedrock-runtime の FQDN が出て、起点に追随する", () => {
    expect(open(CLAUDE_45).querySelector(".detail-endpoint-value").textContent).toBe(
      "bedrock-runtime.ap-northeast-1.amazonaws.com",
    );
    app.view.setRegion("ap-northeast-3");
    expect(panelOf(CLAUDE_45).querySelector(".detail-endpoint-value").textContent).toBe(
      "bedrock-runtime.ap-northeast-3.amazonaws.com",
    );
  });

  it("mantle が無い起点では 3 項目目ごと出さない", () => {
    expect(open(CLAUDE_45).querySelector('[data-item="detail.mantleEndpoint"]')).not.toBeNull();
    app.view.setRegion("ap-northeast-3");
    expect(panelOf(CLAUDE_45).querySelector('[data-item="detail.mantleEndpoint"]')).toBeNull();
    expect(panelOf(CLAUDE_45).textContent).not.toContain(".api.aws");
  });

  it("見出し行はレーンによらず 1 つだけ", () => {
    expect(open(CLAUDE_45).querySelectorAll(".head-grid")).toHaveLength(1);
  });
});

describe("AC-014 レーンのタブと常時見える要約", () => {
  it("role=tablist に 3 つのタブが並ぶ", () => {
    const panel = open(CLAUDE_45);
    expect(panel.querySelector(".lane-tabs").getAttribute("role")).toBe("tablist");
    expect(tabsOf(panel).map((tab) => tab.dataset.lane)).toEqual(["inRegion", "geo", "global"]);
  });

  it("要約はタブを開かなくても読める", () => {
    const panel = open(CLAUDE_45);
    const sums = tabsOf(panel).map((tab) => tab.querySelector(".lane-sum").textContent);
    expect(sums).toEqual(["提供なし", "国内 2 ・ 国外 6", "世界の対応リージョン"]);
  });

  it("Geo の見出しは地理圏名を「 ・ 」で連ねる", () => {
    const panel = open(CLAUDE_45);
    expect(tabFor(panel, "geo").querySelector(".lane-title").textContent).toBe(
      "Geo（日本国内 ・ アジア太平洋）",
    );
  });

  it("国外 M ≧ 1 のとき要約が warn 色になる", () => {
    const panel = open(CLAUDE_45);
    expect(tabFor(panel, "geo").querySelector(".lane-sum").classList.contains("is-warn")).toBe(true);
  });

  it("apac. だけのモデルでも国内 / 国外を数える", () => {
    const panel = open(NOVA);
    const sum = tabFor(panel, "geo").querySelector(".lane-sum");
    expect(sum.textContent).toBe("国内 2 ・ 国外 4");
    expect(sum.classList.contains("is-warn")).toBe(true);
  });

  it("In-Region 可のときは「国内に留まる」", () => {
    expect(tabFor(open(NOVA), "inRegion").querySelector(".lane-sum").textContent).toBe(
      "国内に留まる",
    );
  });

  it("起点の country が分からないときは「推論先 K」", () => {
    app = mountFixtureApp({
      extraProfiles: EXTRA_PROFILES,
      regionNotes: regionNotesWithoutCountry(),
    });
    const panel = open(CLAUDE_45);
    expect(tabFor(panel, "geo").querySelector(".lane-sum").textContent).toBe("推論先 8");
  });

  it("英語でも要約が出る", () => {
    app = mountFixtureApp({ extraProfiles: EXTRA_PROFILES, lang: "en-US" });
    setLang("en");
    const panel = open(CLAUDE_45);
    expect(tabsOf(panel).map((tab) => tab.querySelector(".lane-sum").textContent)).toEqual([
      "Not available",
      "In country 2 · Abroad 6",
      "Worldwide supported Regions",
    ]);
  });
});

describe("AC-015 既定で選ばれるレーン", () => {
  it("使えるレーンのうち最も狭いものが aria-selected になる", () => {
    expect(visibleLane(open(NOVA)).dataset.lane).toBe("inRegion");
    expect(tabFor(panelOf(NOVA), "inRegion").getAttribute("aria-selected")).toBe("true");
  });

  it("In-Region 不可なら Geo が開く", () => {
    expect(visibleLane(open(CLAUDE_45)).dataset.lane).toBe("geo");
  });

  it("3 つとも不可なら In-Region が開く", () => {
    expect(visibleLane(open(NO_LANE_MODEL)).dataset.lane).toBe("inRegion");
  });
});

describe("AC-016 使えないレーンも開ける", () => {
  it("淡色になるが disabled にはならない", () => {
    const tab = tabFor(open(CLAUDE_45), "inRegion");
    expect(tab.classList.contains("is-dim")).toBe(true);
    expect(tab.disabled).toBe(false);
    expect(tab.hasAttribute("disabled")).toBe(false);
  });

  it("クリックで開き、「直接提供なし」が出る", () => {
    const panel = open(CLAUDE_45);
    tabFor(panel, "inRegion").click();
    const lane = laneOf(panel, "inRegion");
    expect(lane.hidden).toBe(false);
    expect(lane.textContent).toContain("このモデルは東京で直接提供なし");
  });

  // 2026-10-08 変更: 呼べないレーンに単価の表を出すと「提供なしなのに価格がある」と読めるので出さない。
  // 東京の標準の単価は Geo (jp.) で呼んだときの価格なので、使えるレーンを案内する。
  it("単価があっても表は出さず、呼べない旨と、同じ単価が出ている使えるレーンを案内する", () => {
    const panel = open(CLAUDE_45);
    const price = laneOf(panel, "inRegion").querySelector(".detail-price");
    expect(price.querySelector(".detail-price-table")).toBeNull();
    const note = price.querySelector(".detail-price-unavailable").textContent;
    expect(note).toContain("この使い方では呼べないため、価格は出していません");
    expect(note).toContain("Geo");
  });
});

describe("AC-016 使えない Geo / Global のレーン", () => {
  // NOVA は Global 不可、NVIDIA を除く In-Region 専用モデルは Geo 不可。
  const NO_GEO = "cohere.embed-v4:0"; // 東京起点で Geo プロファイルが無い

  it("Geo 不可のレーンは「指定する ID」を出さない", () => {
    const lane = laneOf(open(NO_GEO), "geo");
    expect(lane.querySelector(".detail-id")).toBeNull();
    // モデル ID を指定する ID のように見せない。
    expect(lane.querySelector(".lane-block").textContent).not.toContain(NO_GEO);
  });

  it("Geo 不可のレーンの推論先は「提供なし」の 1 行だけ", () => {
    const lines = [...laneOf(open(NO_GEO), "geo").querySelectorAll(".dest-list li")];
    expect(lines.map((line) => line.dataset.kind)).toEqual(["unavailable"]);
    expect(lines[0].textContent).toBe("提供なし");
    // 「国内 0」も出さない。
    expect(laneOf(panelOf(NO_GEO), "geo").textContent).not.toContain("国内 0");
  });

  it("Global 不可のレーンも同じ形になる（範囲の行を出さない）", () => {
    const lane = laneOf(open(NOVA), "global");
    expect(lane.querySelector(".detail-id")).toBeNull();
    const lines = [...lane.querySelectorAll(".dest-list li")];
    expect(lines.map((line) => line.dataset.kind)).toEqual(["unavailable"]);
    // 「範囲: 世界の対応リージョン（AWSが自動選択）」の行を出さない。
    // 図の見出し（「世界の対応リージョン」）は AC-016 の指示どおり残す。
    expect(lane.querySelector(".detail-dest").textContent).not.toContain("全商用リージョン");
  });

  it("使えない Geo / Global の図は内側が淡色で、推論先のチップを描かない", () => {
    for (const [modelId, lane] of [
      [NO_GEO, "geo"],
      [NOVA, "global"],
    ]) {
      const svg = laneOf(open(modelId), lane).querySelector("svg");
      const off = svg.querySelector("g.s-off");
      expect(off, `${modelId}/${lane}`).not.toBeNull();
      // 起点と記録のノードが淡色の中に入っている (g が空でないことの確認)。
      expect(off.querySelector('[data-node="origin"]'), `${modelId}/${lane}`).not.toBeNull();
      expect(off.querySelector('[data-node="record"]'), `${modelId}/${lane}`).not.toBeNull();
      expect(
        svg.querySelectorAll("rect.s-chip-warn, rect.s-chip-accent, rect.s-chip-faint"),
        `${modelId}/${lane}`,
      ).toHaveLength(0);
    }
  });

  it("使える Geo / Global の図は淡色にしない", () => {
    // CLAUDE_45 は Geo も Global も可。.s-off は「呼べない」だけを表す。
    const panel = open(CLAUDE_45);
    for (const lane of ["geo", "global"]) {
      const svg = laneOf(panel, lane).querySelector("svg");
      expect(svg.querySelector("g.s-off"), lane).toBeNull();
    }
    // Global の起点のチップは常に淡いが、それは .s-faint で .s-off ではない。
    const globalSvg = laneOf(panel, "global").querySelector("svg");
    expect(globalSvg.querySelector("g.s-faint")).not.toBeNull();
    expect(globalSvg.querySelectorAll("rect.s-chip-faint").length).toBeGreaterThan(3);
  });

  it("In-Region が不可でも「指定する ID」（モデル ID）は残る", () => {
    const panel = open(CLAUDE_45);
    expect(panel.querySelector(".connection-ids > .copyable .id").textContent).toBe(CLAUDE_45);
    expect(laneOf(panel, "inRegion").querySelector(".detail-id")).toBeNull();
  });
});

describe("AC-017 レーンのパネルの中身の順番", () => {
  it("図 → 推論先 → 価格。IDはAPI接続情報に集約", () => {
    const lane = visibleLane(open(CLAUDE_45));
    const order = [...lane.querySelectorAll("figure.flow, section")].map(
      (element) => element.tagName.toLowerCase() + ":" + (element.className || ""),
    );
    expect(order).toEqual([
      "figure:flow",
      "section:detail-dest",
      "figure:flow",
      "section:detail-dest",
      "section:detail-price",
    ]);
  });

  it("In-Region の「指定する ID」はモデル ID", () => {
    const panel = open(NOVA);
    const id = panel.querySelector(".connection-ids > .copyable .id");
    expect(id.textContent).toBe(NOVA);
  });

  it("Global の「指定する ID」はプロファイル ID", () => {
    const panel = open(CLAUDE_45);
    expect([...panel.querySelectorAll(".connection-ids .detail-id .id")].find(node => node.textContent.startsWith("global.")).textContent).toBe(
      `global.${CLAUDE_45}`,
    );
  });
});

describe("AC-018 Geo に複数のプロファイルがあるとき", () => {
  it("狭い順にブロックが積まれ、見出しは地理圏名", () => {
    const lane = laneOf(open(CLAUDE_45), "geo");
    const blocks = [...lane.querySelectorAll(".lane-block")];
    expect(blocks).toHaveLength(2);
    expect(blocks.map((block) => block.querySelector(".lane-block-head").textContent)).toEqual([
      "日本国内",
      "アジア太平洋",
    ]);
    expect(blocks.map((block) => block.dataset.profileId)).toEqual([
      `jp.${CLAUDE_45}`,
      `apac.${CLAUDE_45}`,
    ]);
  });

  it("図が2枚・価格が1つ、全プロファイルIDは接続情報に1回ずつ表示", () => {
    const lane = laneOf(open(CLAUDE_45), "geo");
    expect(lane.querySelectorAll("figure.flow")).toHaveLength(2);
    expect(lane.querySelectorAll(".detail-id")).toHaveLength(0);
    const ids = [...panelOf(CLAUDE_45).querySelectorAll(".connection-ids .detail-id .id")].map(node => node.textContent);
    expect(ids).toEqual([`jp.${CLAUDE_45}`, `apac.${CLAUDE_45}`, `global.${CLAUDE_45}`]);
    expect(lane.querySelectorAll(".detail-price")).toHaveLength(1);
  });
});

describe("AC-019 推論先の表示", () => {
  it("In-Region は起点の地名だけ", () => {
    const dest = laneOf(open(NOVA), "inRegion").querySelector(".detail-dest");
    expect(dest.textContent).toContain("東京");
    expect(dest.textContent).not.toContain("ap-northeast-1");
  });

  it("In-Region 不可のときは文言が出る", () => {
    const dest = laneOf(open(CLAUDE_45), "inRegion").querySelector(".detail-dest");
    expect(dest.querySelector(".state-none").textContent).toBe(
      "提供なし（東京では推論プロファイル経由のみ）",
    );
  });

  it("Geo は 国内 / 国外 の 2 行で、国外が warn", () => {
    const block = [...laneOf(open(CLAUDE_45), "geo").querySelectorAll(".lane-block")][1];
    const lines = [...block.querySelectorAll(".dest-list li")];
    expect(lines.map((line) => line.dataset.kind)).toEqual(["domestic", "foreign"]);
    expect(lines[1].querySelector(".v-warn")).not.toBeNull();
    expect(block.querySelector(".dest-note").textContent).toBe(
      "起点が東京のときの推論先。起点が変わると推論先も変わる",
    );
    expect(block.querySelector(".detail-dest").textContent).not.toContain("ap-southeast");
  });

  it("国外 0 件の Geo は国外の行を出さない", () => {
    // CLAUDE_45 の 1 ブロック目は jp.（東京・大阪 = 国内 2 / 国外 0）。
    const block = [...laneOf(open(CLAUDE_45), "geo").querySelectorAll(".lane-block")][0];
    expect(block.dataset.profileId).toBe(`jp.${CLAUDE_45}`);
    const kinds = [...block.querySelectorAll(".dest-list li")].map((line) => line.dataset.kind);
    expect(kinds).toEqual(["domestic"]);
  });

  it("国外があるプロファイルでは 2 行になる", () => {
    const block = [...laneOf(open(NOVA), "geo").querySelectorAll(".lane-block")][0];
    const kinds = [...block.querySelectorAll(".dest-list li")].map((line) => line.dataset.kind);
    expect(kinds).toEqual(["domestic", "foreign"]);
  });

  it("Global は 1 行だけで個別のリージョンを列挙しない", () => {
    const dest = laneOf(open(CLAUDE_45), "global").querySelector(".detail-dest");
    const lines = [...dest.querySelectorAll(".dest-list li")];
    expect(lines).toHaveLength(1);
    expect(lines[0].querySelector(".v-warn").textContent).toBe(
      "世界の対応リージョン（AWSが自動選択）",
    );
    expect(dest.querySelector(".dest-note").textContent).toContain("例示");
  });

  it("英語でも地名だけが出る", () => {
    app = mountFixtureApp({ extraProfiles: EXTRA_PROFILES, lang: "en-US" });
    setLang("en");
    const block = [...laneOf(open(CLAUDE_45), "geo").querySelectorAll(".lane-block")][1];
    const dest = block.querySelector(".detail-dest");
    expect(dest.textContent).toContain("Asia Pacific (Tokyo)");
    expect(dest.textContent).not.toContain("ap-northeast-1");
  });
});

describe("AC-013 レーンごとの価格", () => {
  it("In-Region / Geo は標準系、Global は global の行だけ", () => {
    const panel = open(CLAUDE_45);
    const kinds = (lane) =>
      [...laneOf(panel, lane).querySelectorAll(".detail-price-table tbody tr")].map(
        (tr) => tr.dataset.kind,
      );
    expect(kinds("geo")).toEqual(["standard", "batch", "cacheRead"]);
    expect(kinds("global")).toEqual(["global"]);
  });

  it("3 列の小表で、出力の無い種別は「—」", () => {
    const table = laneOf(open(CLAUDE_45), "geo").querySelector(".detail-price-table");
    expect([...table.querySelectorAll("thead th")].map((th) => th.textContent)).toEqual([
      "種別",
      "入力",
      "出力",
    ]);
    const cacheRead = table.querySelector('tr[data-kind="cacheRead"]');
    expect([...cacheRead.children].map((td) => td.textContent)).toEqual([
      "キャッシュ読み",
      "$0.33",
      "—",
    ]);
  });

  it("単位の注記に起点の地名が入る", () => {
    const unit = laneOf(open(CLAUDE_45), "geo").querySelector(".detail-price-unit").textContent;
    expect(unit).toContain("USD / 100 万トークン（東京）");
    expect(unit).toContain("割引・契約価格・無料枠は含まない");
  });

  it("Geo には「標準価格と同じ」の注記が付く", () => {
    expect(laneOf(open(CLAUDE_45), "geo").querySelector(".detail-price-unit").textContent).toContain(
      "Geo の推論プロファイルは標準価格と同じ",
    );
  });

  it("単価が無いレーンは説明文を出す", () => {
    const price = laneOf(open(NOVA), "global").querySelector(".detail-price");
    expect(price.querySelector(".detail-price-table")).toBeNull();
    expect(price.querySelector(".detail-no-price").textContent).toBe(
      "この起点リージョンの価格データがありません",
    );
  });

  it("SKU・usagetype・offer code は出さない", () => {
    const panel = open(CLAUDE_45);
    expect(panel.textContent).not.toMatch(/usagetype|AmazonBedrock(FoundationModels)?\b/i);
  });
});

describe("AC-020 選んだレーンはセッション内で覚える", () => {
  it("別の行を開いても同じレーンが選ばれる", () => {
    const panel = open(CLAUDE_45);
    tabFor(panel, "global").click();
    expect(visibleLane(panel).dataset.lane).toBe("global");
    expect(visibleLane(open("cohere.embed-v4:0")).dataset.lane).toBe("global");
  });

  it("そのレーンが使えない行では既定に戻る", () => {
    tabFor(open(CLAUDE_45), "global").click();
    expect(visibleLane(open(NOVA)).dataset.lane).toBe("inRegion");
  });

  it("URL にも localStorage にも保存しない", () => {
    const before = app.location.search;
    const keys = Object.keys(localStorage).sort();
    tabFor(open(CLAUDE_45), "global").click();
    expect(app.location.search).toBe(before);
    expect(Object.keys(localStorage).sort()).toEqual(keys);
    expect(JSON.stringify(localStorage)).not.toContain("global");
  });
});

describe("AC-021 どのレーンも使えない", () => {
  it("3 タブとも淡色で、説明文が出る", () => {
    const panel = open(NO_LANE_MODEL);
    expect(tabsOf(panel).every((tab) => tab.classList.contains("is-dim"))).toBe(true);
    expect(visibleLane(panel).querySelector(".detail-no-lane").textContent).toBe(
      "この起点リージョンでの提供状況を確認してください",
    );
  });

  it("説明文は開く In-Region のパネルにだけ置く（3 枚に重複させない）", () => {
    const panel = open(NO_LANE_MODEL);
    expect(panel.querySelectorAll(".detail-no-lane")).toHaveLength(1);
    expect(laneOf(panel, "inRegion").querySelector(".detail-no-lane")).not.toBeNull();
    for (const lane of ["geo", "global"]) {
      expect(laneOf(panel, lane).querySelector(".detail-no-lane"), lane).toBeNull();
    }
  });
});

describe("AC-022 起点が未取得のリージョン", () => {
  it("表が 0 行になり、パネルは 1 つも開かない", () => {
    app.view.setRegion(DENIED_REGION);
    expect(bodyRows()).toHaveLength(0);
    expect(document.querySelectorAll("tr.detail-row")).toHaveLength(0);
  });

  // パネルのコードに `cause` の参照が無いことの検査は tests/flow-model.test.js
  // (node 環境。ファイルを読むため) が持つ。
});

describe("a11y", () => {
  it("タブは roving tabindex で、矢印キーで移動できる", () => {
    const panel = open(CLAUDE_45);
    const tabs = tabsOf(panel);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1]);
    tabs[1].focus();
    panel
      .querySelector(".lane-tabs")
      .dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    expect(document.activeElement.dataset.lane).toBe("global");
    expect(visibleLane(panel).dataset.lane).toBe("global");
  });

  it("タブパネルは aria-labelledby で対応するタブを指す", () => {
    const panel = open(CLAUDE_45);
    for (const lane of ["inRegion", "geo", "global"]) {
      expect(laneOf(panel, lane).getAttribute("aria-labelledby")).toBe(
        tabFor(panel, lane).id,
      );
      expect(tabFor(panel, lane).getAttribute("aria-controls")).toBe(laneOf(panel, lane).id);
    }
  });
});

describe("コピーは ID の文字列だけ", () => {
  it("クリップボードにはモデル ID だけが入る", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const button = open(NVIDIA).querySelector('[data-item="detail.modelId"] .copy-btn');
    button.click();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith(NVIDIA);
  });
});


describe("詳細パネルの備考", () => {
  it("モデルとプロファイルの備考を保持し、言語切替で更新する", () => {
    const profileId = `global.${CLAUDE_45}`;
    mountFixtureApp({ overrides: {
      [CLAUDE_45]: { ja: "モデルの注意事項", en: "Model note" },
      [profileId]: { ja: "Globalの注意事項", en: "Global note" },
    } });
    let panel = open(CLAUDE_45);
    expect(panel.querySelector('td').colSpan).toBe(8);
    expect(panel.querySelector('.detail-notes').textContent).toContain('モデルの注意事項');
    expect(panel.querySelector('.detail-notes').textContent).toContain('Globalの注意事項');
    setLang('en');
    panel = panelOf(CLAUDE_45);
    expect(panel.querySelector('.detail-notes').textContent).toContain('Model note');
    expect(panel.querySelector('.detail-note-profile').textContent).toBe(profileId);
  });
  it("備考がないモデルに空の備考欄を作らない", () => {
    expect(open(NOVA).querySelector('.detail-notes')).toBeNull();
  });
});
