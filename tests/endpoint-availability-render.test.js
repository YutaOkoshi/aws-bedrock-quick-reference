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
