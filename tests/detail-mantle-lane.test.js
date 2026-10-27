// D-021 の続き (2026-10-27): 詳細パネルのタブも、表と同じく Runtime と Mantle をまとめて判定する。
import { describe, it, expect, beforeEach } from "vitest";
import { mountFixtureApp, rowFor } from "./app-harness.js";
import { panelId } from "../src/scripts/detail-view.js";
import { setLang } from "../src/scripts/i18n.js";
import { CLAUDE_45, NO_LANE_MODEL, TOKYO } from "./fixtures/bedrock-fixture.js";

const open = (modelId) => {
  rowFor(modelId).querySelector(".detail-toggle").click();
  return document.getElementById(panelId(modelId));
};
const tabFor = (panel, lane) => panel.querySelector(`.lane-tabs [role="tab"][data-lane="${lane}"]`);
const laneOf = (panel, lane) => panel.querySelector(`[role="tabpanel"][data-lane="${lane}"]`);
const mantleIn = (modelId, lanes) => ({ byModel: { [modelId]: { card: "x.html", runtime: {}, mantle: {},
  endpoints: { "bedrock-runtime": {}, "bedrock-mantle": { modelId: `${modelId}-mantle` } },
  regions: { "bedrock-mantle": { inRegion: lanes.inRegion ?? [], geo: lanes.geo ?? [], global: lanes.global ?? [] } } } } });

beforeEach(() => setLang("ja"));

describe("例 1: Runtime の Geo / Global は使え、In-Region は Mantle だけ", () => {
  it("In-Region のタブは淡色にせず「Mantle のみ」と出し、既定で選ばれる", () => {
    mountFixtureApp({ features: mantleIn(CLAUDE_45, { inRegion: [TOKYO] }) });
    const panel = open(CLAUDE_45);
    const tab = tabFor(panel, "inRegion");
    expect(tab.classList.contains("is-dim")).toBe(false);
    expect(tab.querySelector(".lane-sum").textContent).toBe("Mantle のみ ・ 国内に留まる");
    expect(tab.getAttribute("aria-selected")).toBe("true");
  });

  it("In-Region のパネルは Mantle の注記・呼び出し ID・推論先を出し、Runtime の「提供なし」を出さない", () => {
    mountFixtureApp({ features: mantleIn(CLAUDE_45, { inRegion: [TOKYO] }) });
    const lane = laneOf(open(CLAUDE_45), "inRegion");
    expect(lane.querySelector(".detail-mantle-only").textContent).toContain("bedrock-mantle で提供");
    expect(lane.querySelector(".detail-id").textContent).toContain(`${CLAUDE_45}-mantle`);
    expect(lane.querySelector(".dest-line").textContent).toBe("東京");
    expect(lane.textContent).not.toContain("推論プロファイル経由のみ");
    expect(lane.querySelector("figure.flow")).toBeNull();
  });

  it("Runtime だけで使える Geo / Global のタブには「Runtime のみ」を添える", () => {
    mountFixtureApp({ features: mantleIn(CLAUDE_45, { inRegion: [TOKYO] }) });
    const panel = open(CLAUDE_45);
    expect(tabFor(panel, "geo").querySelector(".lane-sum").textContent).toContain("Runtime のみ");
    expect(tabFor(panel, "global").querySelector(".lane-sum").textContent).toContain("Runtime のみ");
  });

  it("Mantle が記載なしなら今までどおり (「提供なし」の淡色タブ、添え書きなし)", () => {
    mountFixtureApp();
    const panel = open(CLAUDE_45);
    expect(tabFor(panel, "inRegion").classList.contains("is-dim")).toBe(true);
    expect(tabFor(panel, "geo").querySelector(".lane-sum").textContent).not.toContain("Runtime のみ");
  });
});

describe("例 2: Runtime ではどの区分も使えず、Mantle の In-Region だけで使える", () => {
  it("「提供状況を確認してください」を出さず、In-Region のタブだけ淡色を外す", () => {
    mountFixtureApp({ features: mantleIn(NO_LANE_MODEL, { inRegion: [TOKYO] }) });
    const panel = open(NO_LANE_MODEL);
    expect(panel.querySelector(".detail-no-lane")).toBeNull();
    expect(tabFor(panel, "inRegion").classList.contains("is-dim")).toBe(false);
    expect(tabFor(panel, "geo").classList.contains("is-dim")).toBe(true);
    expect(tabFor(panel, "global").classList.contains("is-dim")).toBe(true);
  });

  it("Mantle でも使えなければ今までどおり「提供状況を確認してください」", () => {
    mountFixtureApp({ features: mantleIn(NO_LANE_MODEL, { inRegion: ["us-east-1"] }) });
    expect(open(NO_LANE_MODEL).querySelector(".detail-no-lane")).toBeTruthy();
  });
});
