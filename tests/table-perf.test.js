// TABLE-001 AC-NFR-002: 起点リージョンを切り替えたときの再描画が 200ms 未満。
// spike 相当の規模 (68 モデル × 34 プロファイル) が要件なので、fixture ではなく
// 実データ data/models.json / profiles.json をそのまま使う。
import { describe, it, expect } from "vitest";
import models from "../data/models.json";
import profiles from "../data/profiles.json";
import fetchLog from "../data/fetch-log.json";
import regionNotes from "../data/region-notes.json";
import overrides from "../data/overrides.json";
import { mountTableView } from "../src/scripts/table-view.js";
import { buildViewModel } from "../src/scripts/bedrock-view-model.mjs";
import { initI18n } from "../src/scripts/i18n.js";

const TOKYO = "ap-northeast-1";
// 切り替え先。denied なので 0 行になるが、切り替えごとに必ず東京へ戻して
// 68 行の再描画を計測する。
const OTHER = "us-east-1";

const median = (values) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

describe("AC-NFR-002 再描画性能", () => {
  it("実データ全件の再描画の中央値が 200ms 未満", () => {
    // 件数はスナップショットの取り直しで変わるので固定しない。空でないことだけ確かめる
    expect(Object.keys(models).length).toBeGreaterThan(0);
    expect(Object.keys(profiles).length).toBeGreaterThan(0);

    document.body.innerHTML = '<main id="main"></main>';
    localStorage.clear();
    initI18n();
    const view = mountTableView({
      host: document.getElementById("main"),
      models,
      profiles,
      fetchLog,
      regionNotes,
      overrides,
    });

    const samples = [];
    for (let i = 0; i < 5; i++) {
      view.setRegion(OTHER);
      const start = performance.now();
      view.setRegion(TOKYO);
      samples.push(performance.now() - start);
    }

    const rows = document.querySelectorAll("tbody tr").length;
    const value = median(samples);
    // 数字を残す: どのくらい余裕があるかは読み手が判断する。
    console.log(
      `AC-NFR-002: ${rows} 行の再描画 中央値 ${value.toFixed(1)}ms ` +
        `(全 5 回: ${samples.map((s) => s.toFixed(1)).join(", ")}ms, jsdom)`,
    );

    // 行数はスナップショットの取り直しで変わるので固定しない。描いた行がビューモデルの行と同数で、
    // spec の規模 (68 モデル) 以上あること
    const expected = buildViewModel({ models, profiles, fetchLog, regionNotes, overrides, region: TOKYO }).rows.length;
    expect(rows).toBe(expected);
    expect(rows).toBeGreaterThanOrEqual(68);
    expect(value).toBeLessThan(200);
  });
});
