// @vitest-environment node
// DEPLOY-001 AC-009 / AC-010: PR ごとに dist/index.html を artifact として添付するワークフローの定義を検証する。
// Pages は 1 リポジトリに 1 サイトなので PR からは deploy せず、build 結果を artifact に残すだけにする。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./helpers/mini-yaml.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PATH = join(ROOT, ".github", "workflows", "pr-preview.yml");
const source = readFileSync(PATH, "utf8");
const workflow = parseYaml(source);
const steps = workflow.jobs.preview.steps;
const runs = steps.filter((step) => typeof step.run === "string").map((step) => step.run);
const indexOfRun = (command) => steps.findIndex((step) => step.run === command);
const upload = steps.find((step) => step.uses === "actions/upload-artifact@v4");
const summary = steps.find((step) => typeof step.run === "string" && step.run.includes("GITHUB_STEP_SUMMARY"));

describe("DEPLOY-001 PR プレビューワークフロー (pr-preview.yml)", () => {
  it("main 向けの PR で動き、push と schedule では動かない", () => {
    expect(workflow.on.pull_request.branches).toEqual(["main"]);
    expect(workflow.on.push).toBeUndefined();
    expect(workflow.on.schedule).toBeUndefined();
  });

  it("permissions は contents: read だけ (fork の PR の読み取り専用トークンでも動く)", () => {
    expect(workflow.permissions).toEqual({ contents: "read" });
    for (const job of Object.values(workflow.jobs)) expect(job.permissions).toBeUndefined();
  });

  it("Pages に deploy しない", () => {
    expect(source).not.toMatch(/deploy-pages|upload-pages-artifact|pages:/);
    expect(Object.keys(workflow.jobs)).toEqual(["preview"]);
  });

  it("使う action は公式の checkout / setup-node / upload-artifact だけ (Node 22 + npm キャッシュ)", () => {
    const uses = steps.filter((step) => typeof step.uses === "string").map((step) => step.uses);
    expect(uses).toEqual(["actions/checkout@v4", "actions/setup-node@v4", "actions/upload-artifact@v4"]);
    const setup = steps.find((step) => step.uses === "actions/setup-node@v4");
    expect(setup.with["node-version"]).toBe(22);
    expect(setup.with.cache).toBe("npm");
  });

  it("npm ci → npm test → npm run build → upload → summary の順", () => {
    expect(runs.slice(0, 3)).toEqual(["npm ci", "npm test", "npm run build"]);
    expect(indexOfRun("npm ci")).toBeLessThan(indexOfRun("npm test"));
    expect(indexOfRun("npm test")).toBeLessThan(indexOfRun("npm run build"));
    expect(steps.indexOf(upload)).toBeGreaterThan(indexOfRun("npm run build"));
    expect(steps.indexOf(summary)).toBeGreaterThan(steps.indexOf(upload));
  });

  describe("artifact", () => {
    it("dist/index.html の 1 ファイルだけを、PR 番号入りの名前で残す", () => {
      expect(upload.with.path).toBe("dist/index.html");
      expect(upload.with.name).toBe("pr-preview-${{ github.event.pull_request.number }}");
    });

    it("ファイルが無ければ失敗にする", () => {
      expect(upload.with["if-no-files-found"]).toBe("error");
    });

    it("保持期間を 14 日に縮める", () => {
      expect(upload.with["retention-days"]).toBe(14);
    });

    it("job summary に artifact の URL を書く", () => {
      expect(upload.id).toBe("upload");
      expect(summary.env.ARTIFACT_URL).toBe("${{ steps.upload.outputs.artifact-url }}");
      expect(summary.run).toContain("($ARTIFACT_URL)");
      expect(summary.run).toContain('>> "$GITHUB_STEP_SUMMARY"');
    });
  });

  it("失敗を握り潰さない (テストが落ちたら artifact を作らない)", () => {
    expect(source).not.toContain("continue-on-error");
    expect(source).not.toMatch(/always\(\)/);
    for (const step of steps) expect(step.if).toBeUndefined();
  });

  it("同じ PR の古い実行は新しい push で取り消す", () => {
    expect(workflow.concurrency.group).toBe("pr-preview-${{ github.event.pull_request.number }}");
    expect(workflow.concurrency["cancel-in-progress"]).toBe(true);
  });

  it("CI でデータを取得しない (fetch スクリプトも aws CLI も呼ばない)", () => {
    expect(runs.join("\n")).not.toMatch(/fetch-bedrock-|aws\s/);
    expect(source).not.toContain("data/raw");
  });
});
