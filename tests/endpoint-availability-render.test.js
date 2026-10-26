// In-Region / Geo / Global のセルに Runtime / Mantle を出す (jsdom)。
import { describe, expect, it, beforeEach } from "vitest";
import { mountFixtureApp, rowFor, cells } from "./app-harness.js";
import { setLang } from "../src/scripts/i18n.js";
import { TOKYO } from "./fixtures/bedrock-fixture.js";

const CLAUDE = "anthropic.claude-sonnet-4-5-20250929-v1:0";
const IN_REGION = 3;
const GEO = 4;
const GLOBAL = 5;
const marks = (cell) => [...cell.querySelectorAll(".endpoint-mark")].map((mark) => mark.textContent.replace(/\s+/g, " ").trim());

beforeEach(() => setLang("ja"));

describe("判定のセルの Runtime / Mantle", () => {
  const features = { byModel: { [CLAUDE]: { card: "x.html", runtime: {}, mantle: {},
    endpoints: { "bedrock-runtime": {}, "bedrock-mantle": {} },
    regions: { "bedrock-mantle": { inRegion: [TOKYO], geo: [], global: [] } } } } };

  it("各セルに Runtime と Mantle の 2 つの印が並ぶ", () => {
    mountFixtureApp({ features });
    const row = rowFor(CLAUDE);
    expect(marks(cells(row)[IN_REGION])).toEqual(["Runtime ✕", "Mantle ✓"]);
    expect(marks(cells(row)[GEO])).toEqual(["Runtime ✓", "Mantle ✕"]);
    expect(marks(cells(row)[GLOBAL])).toEqual(["Runtime ✓", "Mantle ✕"]);
  });

  it("docs に記載が無いと Mantle は「—」", () => {
    mountFixtureApp();
    expect(marks(cells(rowFor(CLAUDE))[GEO])).toEqual(["Runtime ✓", "Mantle —"]);
  });
});

// D-021: 上段の判定は Runtime と Mantle をまとめる。片方だけなら「Runtime のみ / Mantle のみ」と添える。
describe("上段の判定 (接続先をまとめる)", () => {
  const features = { byModel: { [CLAUDE]: { card: "x.html", runtime: {}, mantle: {},
    endpoints: { "bedrock-runtime": {}, "bedrock-mantle": {} },
    regions: { "bedrock-mantle": { inRegion: [TOKYO], geo: [], global: [] } } } } };
  const verdict = (cell) => cell.querySelector(".flag-yes, .flag-no")?.textContent.replace(/\s+/g, "");
  const only = (cell) => [...cell.querySelectorAll(".lane-only")].map((node) => node.textContent);

  it("Runtime では不可でも Mantle で使えれば「✓ Mantle のみ」", () => {
    mountFixtureApp({ features });
    const cell = cells(rowFor(CLAUDE))[IN_REGION];
    expect(verdict(cell)).toBe("✓Mantleのみ");
    expect(cell.querySelector(".flag-yes").classList.contains("is-partial")).toBe(true);
  });

  it("Runtime だけで使えるなら Geo / Global に「Runtime のみ」", () => {
    mountFixtureApp({ features });
    const row = rowFor(CLAUDE);
    expect(only(cells(row)[GEO])).toEqual(["Runtime のみ"]);
    expect(verdict(cells(row)[GLOBAL])).toBe("✓Runtimeのみ");
  });

  it("Mantle が記載なしなら添えない (今までどおり「可」)", () => {
    mountFixtureApp();
    const row = rowFor(CLAUDE);
    expect(only(cells(row)[GEO])).toEqual([]);
    expect(verdict(cells(row)[GLOBAL])).toBe("✓可");
  });

  it("In-Region の列の並べ替えは、まとめた判定で比べる", () => {
    mountFixtureApp({ features });
    const column = document.querySelector('#models-table thead th[data-key="inRegion"] .sort-btn')
      ?? document.querySelector('#models-table thead th[data-key="inRegion"]');
    column.click();
    const first = document.querySelector("#models-table tbody tr[data-model-id]");
    const values = [...document.querySelectorAll("#models-table tbody tr[data-model-id]")]
      .map((tr) => verdict(cells(tr)[IN_REGION]).startsWith("✓"));
    expect(first).toBeTruthy();
    // 昇順でも降順でも、可と不可がそれぞれ固まる (CLAUDE は Mantle だけで「可」の側に入る)。
    const flips = values.slice(1).filter((value, index) => value !== values[index]).length;
    expect(flips).toBeLessThanOrEqual(1);
    const claudeIndex = [...document.querySelectorAll("#models-table tbody tr[data-model-id]")]
      .findIndex((tr) => tr.dataset.modelId === CLAUDE);
    expect(values[claudeIndex]).toBe(true);
  });
});

// 起点で 3 区分とも使えない接続先の機能セルは薄くする。値は変えない (D-021)。
describe("機能列: 起点で使えない接続先を薄く", () => {
  const featuresWith = (mantleRegions) => ({
    features: { streaming: { label: "Response streaming" } },
    defaultColumns: ["streaming"],
    byModel: { [CLAUDE]: { card: "x.html", runtime: { streaming: true }, mantle: { streaming: true },
      endpoints: { "bedrock-runtime": {}, "bedrock-mantle": {} },
      regions: { "bedrock-mantle": { inRegion: mantleRegions, geo: [], global: [] } } } },
  });
  const featureCell = (side) => {
    const keys = [...document.querySelectorAll("#models-table thead tr:last-child th")].map((th) => th.dataset.key);
    return cells(rowFor(CLAUDE))[keys.indexOf(`feature:streaming:${side}`)];
  };

  it("起点で Mantle が使えないと Mantle の機能セルに印が付き、値はそのまま", () => {
    mountFixtureApp({ features: featuresWith(["us-east-1"]) });
    const mantle = featureCell("mantle");
    expect(mantle.querySelector(".feature-mark").classList.contains("endpoint-off")).toBe(true);
    expect(mantle.textContent).toContain("対応");
    expect(mantle.querySelector(".feature-mark").title).toContain("bedrock-mantle");
    expect(featureCell("runtime").querySelector(".feature-mark").classList.contains("endpoint-off")).toBe(false);
  });

  it("起点で Mantle が使えるなら薄くしない", () => {
    mountFixtureApp({ features: featuresWith([TOKYO]) });
    expect(featureCell("mantle").querySelector(".feature-mark").classList.contains("endpoint-off")).toBe(false);
  });
});

describe("機能列の注記", () => {
  it("薄くしたセルには、セルの下に出す短い注記を持たせる", () => {
    mountFixtureApp({ features: {
      features: { streaming: { label: "Response streaming" } }, defaultColumns: ["streaming"],
      byModel: { [CLAUDE]: { card: "x.html", runtime: { streaming: true }, mantle: { streaming: true },
        endpoints: { "bedrock-runtime": {}, "bedrock-mantle": {} },
        regions: { "bedrock-mantle": { inRegion: ["us-east-1"], geo: [], global: [] } } } } } });
    const keys = [...document.querySelectorAll("#models-table thead tr:last-child th")].map((th) => th.dataset.key);
    const mark = cells(rowFor(CLAUDE))[keys.indexOf("feature:streaming:mantle")].querySelector(".feature-mark");
    expect(mark.dataset.offNote).toBe("この起点では Mantle 不可");
  });
});

// レビューの指摘 (2026-10-26): Mantle の Geo は宛先が分からないので、限定が付けば Global と同じく満たさない。
describe("Mantle だけの Geo と推論先の限定", () => {
  const TITAN = "amazon.titan-embed-text-v1:2:8k"; // 東京で Runtime の In-Region / Geo / Global がすべて不可
  const features = { byModel: { [TITAN]: { card: "x.html", runtime: {}, mantle: {},
    endpoints: { "bedrock-runtime": {}, "bedrock-mantle": {} },
    regions: { "bedrock-mantle": { inRegion: [TOKYO], geo: [TOKYO], global: [] } } } } };

  it("限定が無ければ「✓ Mantle のみ」だけ", () => {
    mountFixtureApp({ features });
    const geo = cells(rowFor(TITAN))[GEO];
    expect(geo.textContent).toContain("Mantle のみ");
    expect(geo.querySelector(".out-of-limit")).toBeNull();
  });

  it("限定が付くと Geo は限定外の印が付き、In-Region (推論先は起点) は満たす", () => {
    mountFixtureApp({ features, search: "?limit=geo:jp" });
    const row = cells(rowFor(TITAN));
    expect(row[GEO].querySelector(".out-of-limit")).toBeTruthy();
    expect(row[IN_REGION].querySelector(".out-of-limit")).toBeNull();
  });
});
