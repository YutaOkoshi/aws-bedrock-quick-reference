// @vitest-environment node
// TABLE-001 AC-NFR-001 の構造側。
// 実際の 375px の見た目は Playwright のスクリーンショットで目視確認する
// (Test Strategy の e2e)。ここでは「ページ本体は横に伸びず、横スクロールを
// 持つのは表の枠だけ」「モデル名列が sticky」という CSS の取り決めが
// 消えていないことを固定する。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (path) => readFileSync(fileURLToPath(new URL(`../src/${path}`, import.meta.url)), "utf8");

const base = read("styles/base.css");
const table = read("styles/table.css");
const tokens = read("styles/tokens.css");

describe("AC-NFR-001 スマートフォン幅", () => {
  it("ページ本体は横スクロールしない", () => {
    expect(base).toMatch(/html,\s*body\s*\{[^}]*overflow-x:\s*clip/);
    expect(base).toMatch(/html,\s*body\s*\{[^}]*max-width:\s*100%/);
  });

  it("横スクロールを持つのは表の枠", () => {
    expect(table).toMatch(/\.table-frame\s*\{[^}]*overflow-x:\s*auto/);
    expect(table).toMatch(/\.table-frame\s*\{[^}]*max-width:\s*100%/);
  });

  it("モデル名列が左端に固定される (TABLE-001 v2 AC-NFR-001)", () => {
    expect(table).toContain("position: sticky");
    expect(table).toMatch(/\.sticky-name[\s\S]*?left:\s*var\(--col-provider-w\)/);
    expect(table).not.toContain("sticky-modelId");
    expect(table).toMatch(/\.sticky-provider[\s\S]*?left:\s*0/);
    expect(tokens).toContain("--col-provider-w");
  });

  it("768px 以下では固定列の幅を詰め、モデル名を折り返す", () => {
    const mobile = base.slice(base.indexOf("@media (max-width: 768px)"));
    expect(mobile).toContain("--col-provider-w");
    expect(mobile).toMatch(/sticky-name[\s\S]*?white-space:\s*normal/);
  });

  it("詳細パネルの価格の小表も枠内で横スクロールする (DETAIL-001 v8 AC-013)", () => {
    const detail = read("styles/detail.css");
    const mobile = detail.slice(detail.indexOf("@media (max-width: 768px)"));
    expect(mobile).toMatch(/\.price-wrap\s*\{[^}]*overflow-x:\s*auto/);
    // 見出し行は 375px で 1 列に積む (DETAIL-001 v8 AC-010)。
    expect(mobile).toMatch(/\.head-grid\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\)/);
  });
});

// FLOW-001 AC-NFR-001 / AC-NFR-002。図そのものの CSS はここで固定する。
describe("FLOW-001 データの流れ図", () => {
  const flow = read("styles/flow.css");

  it("横スクロールするのは図の入れ物だけ", () => {
    expect(flow).toMatch(/\.flow-scroll\s*\{[^}]*overflow-x:\s*auto/);
  });

  it("svg は幅 820px・min-width 780px・高さ auto (AC-NFR-001)", () => {
    const rule = flow.slice(flow.indexOf(".flow-scroll > svg"));
    expect(rule).toMatch(/width:\s*820px/);
    expect(rule).toMatch(/min-width:\s*780px/);
    expect(rule).toMatch(/height:\s*auto/);
  });

  it("prefers-reduced-motion: reduce でタブパネルのフェードを止める (AC-NFR-002)", () => {
    const reduced = flow.slice(flow.indexOf("@media (prefers-reduced-motion: reduce)"));
    expect(reduced).toContain('[role="tabpanel"]');
    expect(reduced).toMatch(/animation:\s*none/);
  });

  it("SVG の色は tokens.css の変数から取り、テーマ分岐を持たない (AC-001)", () => {
    expect(flow).toContain("var(--yes-line)");
    expect(flow).toContain("var(--warn-line)");
    expect(flow).toContain("var(--accent)");
    expect(flow).not.toContain("data-theme");
  });
});

describe("REGIONS-001 AC-NFR-001 行列の横スクロール", () => {
  const regions = read("styles/regions.css");

  it("横スクロールを持つのは行列の入れ物だけ", () => {
    expect(regions).toMatch(/\.matrix-scroll\s*\{[^}]*overflow-x:\s*auto/);
    expect(regions).toMatch(/\.matrix-scroll\s*\{[^}]*max-width:\s*100%/);
    // 他に overflow-x を持つ規則を増やさない。
    expect(regions.match(/overflow-x:\s*auto/g)).toHaveLength(1);
  });

  it("左 2 列が position: sticky で固定される", () => {
    expect(regions).toMatch(/\.sticky-1[\s\S]{0,120}position:\s*sticky/);
    expect(regions).toMatch(/table\.matrix \.sticky-1\s*\{[^}]*left:\s*0/);
    expect(regions).toMatch(/table\.matrix \.sticky-2\s*\{[^}]*left:\s*var\(--col-provider-w\)/);
  });

  it("色はトークンから取り、テーマ分岐を書かない", () => {
    expect(regions).not.toContain("data-theme");
    expect(regions).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
  });
});

describe("テーマ", () => {
  it("ダークが既定で、ライトはトークンの再定義だけ", () => {
    expect(tokens).toContain("color-scheme: dark");
    expect(tokens).toMatch(/\[data-theme="light"\][\s\S]*color-scheme: light/);
  });

  it("コンポーネント CSS にテーマ分岐を書かない", () => {
    expect(table).not.toContain("data-theme");
    expect(base).not.toContain("data-theme");
  });
});
