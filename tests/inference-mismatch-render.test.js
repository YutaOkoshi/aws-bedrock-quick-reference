// docs のモデルカードと ListInferenceProfiles の、Geo / Global の推論 ID の食い違いの注釈 (jsdom)。
import { describe, expect, it, beforeEach } from "vitest";
import { mountFixtureApp, rowFor, cells } from "./app-harness.js";
import { panelId } from "../src/scripts/detail-view.js";
import { setLang } from "../src/scripts/i18n.js";

const CLAUDE = "anthropic.claude-sonnet-4-5-20250929-v1:0";
const GEO = 4;
const GLOBAL = 5;
const panelOf = (modelId) => document.getElementById(panelId(modelId));

// fixture の Claude は API (profiles) に Geo と Global のプロファイルがある。docs 側だけを変えて食い違いを作る。
const docsSays = (runtime) => ({ byModel: { [CLAUDE]: { card: "model-card-anthropic-claude-sonnet-4-5.html", runtime: {}, mantle: {}, endpoints: { "bedrock-runtime": { modelId: CLAUDE, ...runtime } } } } });

beforeEach(() => setLang("ja"));

describe("推論 ID の食い違いの注釈", () => {
  it("docs で Global が Not supported なら、一覧の Global のセルに「docs と相違」が付き、title に両方の ID が出る", () => {
    mountFixtureApp({ features: docsSays({ geo: [], global: [] }) });
    const mark = cells(rowFor(CLAUDE))[GLOBAL].querySelector(".docs-mismatch");
    expect(mark.textContent).toBe("docs と相違");
    expect(mark.title).toContain("global.");
    expect(mark.title).toContain("Not supported");
  });

  it("詳細の Global のタブに、API と docs の ID と、モデルカードへのリンクが出る", () => {
    mountFixtureApp({ features: docsSays({ geo: [], global: [] }) });
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    const note = panelOf(CLAUDE).querySelector('[data-lane="global"] .inference-mismatch');
    expect(note.textContent).toContain("ListInferenceProfiles");
    expect(note.textContent).toContain("global.");
    expect(note.querySelector("a").href).toBe("https://docs.aws.amazon.com/bedrock/latest/userguide/model-card-anthropic-claude-sonnet-4-5.html");
  });

  it("一致していれば注釈は出ない", () => {
    mountFixtureApp();
    expect(document.querySelector(".docs-mismatch")).toBeNull();
    rowFor(CLAUDE).querySelector(".detail-toggle").click();
    expect(panelOf(CLAUDE).querySelector(".inference-mismatch")).toBeNull();
  });

  it("英語表示でも出る", () => {
    mountFixtureApp({ features: docsSays({ geo: [], global: [] }) });
    setLang("en");
    expect(cells(rowFor(CLAUDE))[GLOBAL].querySelector(".docs-mismatch").textContent).toBe("differs from docs");
  });
});
