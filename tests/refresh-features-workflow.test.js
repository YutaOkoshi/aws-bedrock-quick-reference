// @vitest-environment node
// FEATURE-001 / D-016: docs の機能表を毎日取り直して PR を作るワークフローの定義を検証する。
// AWS の認証要素を持たないこと (D-002) と、権限が PR 作成に要る 2 つだけであることを固定する。
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseYaml } from "./helpers/mini-yaml.js";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const PATH = join(ROOT, ".github", "workflows", "refresh-features.yml");
const source = readFileSync(PATH, "utf8");
const workflow = parseYaml(source);
const steps = workflow.jobs.refresh.steps;
const runs = steps.map((step) => (typeof step.run === "string" ? step.run : ""));
const indexOfRun = (pattern) => runs.findIndex((run) => pattern.test(run));
const prStep = steps.find((step) => typeof step.run === "string" && step.run.includes("gh pr create"));

describe("mini-yaml のブロックスカラー", () => {
  it("`key: |` を相対インデントを残した複数行の文字列として読む", () => {
    const parsed = parseYaml(["steps:", "  - run: |", "      if a; then", "        b", "      fi", "  - run: c"].join("\n"));
    expect(parsed.steps).toEqual([{ run: "if a; then\n  b\nfi" }, { run: "c" }]);
  });
});

describe("FEATURE-001 定期取得ワークフロー (refresh-features.yml)", () => {
  it("毎日 UTC 21:00 (JST 06:00) と手動実行で動く", () => {
    expect(workflow.on.schedule[0].cron).toBe("0 21 * * *");
    expect(workflow.on).toHaveProperty("workflow_dispatch");
  });

  it("permissions は contents: write と pull-requests: write だけ", () => {
    expect(workflow.permissions).toEqual({ contents: "write", "pull-requests": "write" });
    for (const job of Object.values(workflow.jobs)) expect(job.permissions).toBeUndefined();
  });

  it("使う action は checkout と setup-node だけ (Node 22 + npm キャッシュ)", () => {
    const uses = steps.filter((step) => typeof step.uses === "string").map((step) => step.uses);
    expect(uses).toEqual(["actions/checkout@v4", "actions/setup-node@v4"]);
    const setup = steps.find((step) => step.uses === "actions/setup-node@v4");
    expect(setup.with["node-version"]).toBe(22);
    expect(setup.with.cache).toBe("npm");
  });

  it("npm ci → 取得 → npm test → PR の順", () => {
    const ci = indexOfRun(/^npm ci$/);
    const fetch = indexOfRun(/node scripts\/fetch-bedrock-features\.mjs/);
    const test = indexOfRun(/^npm test$/);
    const pr = steps.indexOf(prStep);
    expect(ci).toBeGreaterThanOrEqual(0);
    expect(fetch).toBeGreaterThan(ci);
    expect(test).toBeGreaterThan(fetch);
    expect(pr).toBeGreaterThan(test);
  });

  it("取得と PR 本文の日付を JST で揃える", () => {
    const fetchRun = runs[indexOfRun(/node scripts\/fetch-bedrock-features\.mjs/)];
    expect(fetchRun).toContain("TZ=Asia/Tokyo date +%F");
    expect(fetchRun).toMatch(/fetch-bedrock-features\.mjs --date "\$DATE"/);
    expect(fetchRun).toContain('>> "$GITHUB_ENV"');
  });

  describe("PR の作り方", () => {
    it("トークンは github.token を GH_TOKEN で渡す (secrets 参照を持たない)", () => {
      expect(prStep.env.GH_TOKEN).toBe("${{ github.token }}");
      expect(source).not.toMatch(/secrets\./);
    });

    it("固定ブランチ bot/refresh-features に data/features.json だけを commit して force push する", () => {
      expect(prStep.env.BRANCH).toBe("bot/refresh-features");
      expect(prStep.run).toContain("git status --porcelain -- data/features.json");
      expect(prStep.run).toContain("git add -- data/features.json");
      expect(prStep.run).not.toMatch(/git add (-A|\.|--all)\b/);
      expect(prStep.run).toContain('git push --force origin "$BRANCH"');
    });

    it("差分が無ければ PR を作らずに成功で終わる", () => {
      const run = prStep.run;
      expect(run.indexOf('echo "no changes"')).toBeLessThan(run.indexOf("git commit"));
      expect(run).toMatch(/echo "no changes"\n\s*exit 0/);
    });

    it("本文は summary.md、無ければ代わりの本文を使う", () => {
      expect(prStep.run).toContain('BODY="data/raw/$DATE/features/summary.md"');
      expect(prStep.run).toContain('if [ ! -f "$BODY" ]; then');
      expect(prStep.run).toContain("$RUNNER_TEMP");
    });

    it("開いている PR があれば edit、無ければ create (base は main)", () => {
      expect(prStep.run).toContain('gh pr list --head "$BRANCH" --base main --state open');
      expect(prStep.run).toMatch(/gh pr edit "\$PR" .*--body-file "\$BODY"/);
      expect(prStep.run).toMatch(/gh pr create --head "\$BRANCH" --base main .*--body-file "\$BODY"/);
    });
  });

  it("失敗を握り潰さない (取得の guard で落ちたら PR を作らない)", () => {
    expect(source).not.toContain("continue-on-error");
    expect(source).not.toMatch(/always\(\)/);
    for (const step of steps) expect(step.if).toBeUndefined();
  });

  it("concurrency で同時実行を避け、進行中の実行を切らない", () => {
    expect(workflow.concurrency.group).toBe("refresh-features");
    expect(workflow.concurrency["cancel-in-progress"]).toBe(false);
  });

  it("AWS の認証要素を持たない (D-002)", () => {
    for (const step of steps) {
      if (typeof step.uses === "string") expect(step.uses).not.toMatch(/^aws-/);
      expect(step.with?.["role-to-assume"]).toBeUndefined();
      for (const key of Object.keys(step.env ?? {})) expect(key).not.toMatch(/^AWS_/);
    }
    expect(source).not.toMatch(/\bAWS_[A-Z_]+\b|role-to-assume|aws-actions\/|aws sso/);
  });
});
