// @vitest-environment node
// FEATURE-001 の CLI (scripts/fetch-bedrock-features.mjs) のテスト。ネットワークは使わない。
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { buildFromRaw, parseFeatureArgs, rawCardName } from "../scripts/fetch-bedrock-features.mjs";

const fixtureDir = fileURLToPath(new URL("./fixtures/features/", import.meta.url));
const namesPath = fileURLToPath(new URL("../data/feature-names.json", import.meta.url));

const CARDS = [
  "model-card-amazon-nova-2-lite.html",
  "model-card-amazon-titan-text-embeddings-v2.html",
  "model-card-anthropic-claude-haiku-4-5.html",
  "model-card-anthropic-claude-sonnet-5-5.html",
  "model-card-openai-gpt-6-luna.html",
];

const MODELS = {
  "anthropic.claude-sonnet-5-5": {},
  "anthropic.claude-haiku-4-5-20251001-v1:0": {},
  "amazon.nova-2-lite-v1:0": {},
  "amazon.nova-2-lite-v1:0:256k": {},
  "amazon.titan-embed-text-v2:0": {},
  "openai.gpt-6-luna": {},
};

const json = (value) => `${JSON.stringify(value, null, 2)}\n`;
const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const silent = () => {};

let work;
let rawDir;
let dataDir;

beforeEach(() => {
  work = mkdtempSync(join(tmpdir(), "bqr-features-"));
  rawDir = join(work, "raw", "2026-10-06", "features");
  dataDir = join(work, "data");
  mkdirSync(rawDir, { recursive: true });
  mkdirSync(dataDir, { recursive: true });
  // toc は 5 本だけに絞ったものを置く (fixture の toc は 134 本で、残りは生データが無い)。
  writeFileSync(
    join(rawDir, "toc-contents.json"),
    json({ contents: [{ title: "Model cards", contents: CARDS.map((href) => ({ title: href, href })) }] }),
  );
  for (const card of CARDS) copyFileSync(join(fixtureDir, rawCardName(card)), join(rawDir, rawCardName(card)));
  writeFileSync(join(dataDir, "models.json"), json(MODELS));
  copyFileSync(namesPath, join(dataDir, "feature-names.json"));
  writeFileSync(join(dataDir, "feature-model-map.json"), json({ _note: "test" }));
});

afterEach(() => {
  rmSync(work, { recursive: true, force: true });
});

describe("CLI の引数解析", () => {
  it("既定は今日の日付で取得する", () => {
    expect(parseFeatureArgs([], { today: "2026-10-06" })).toEqual({
      date: "2026-10-06",
      dryRun: false,
      fromRaw: null,
    });
  });

  it("--date と --dry-run", () => {
    expect(parseFeatureArgs(["--date", "2026-10-01", "--dry-run"], { today: "2026-10-06" })).toEqual({
      date: "2026-10-01",
      dryRun: true,
      fromRaw: null,
    });
  });

  it("--from-raw は日付が --date の代わりになる", () => {
    expect(parseFeatureArgs(["--from-raw", "2026-10-02"], { today: "2026-10-06" })).toEqual({
      date: "2026-10-02",
      dryRun: false,
      fromRaw: "2026-10-02",
    });
  });

  it("日付の形式・値の欠落・不明な引数・併用は例外", () => {
    expect(() => parseFeatureArgs(["--date", "2026/10/01"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseFeatureArgs(["--from-raw", "yesterday"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseFeatureArgs(["--date"])).toThrow(/値が必要/);
    expect(() => parseFeatureArgs(["--regions", "us-east-1"])).toThrow(/不明な引数/);
    expect(() => parseFeatureArgs(["--from-raw", "2026-10-02", "--date", "2026-10-01"])).toThrow(
      /同時に指定できません/,
    );
  });

  it("生データのファイル名は <カード名>.md", () => {
    expect(rawCardName("model-card-x.html")).toBe("model-card-x.md");
  });
});

describe("AC-002 生データからの再正規化 (--from-raw)", () => {
  it("raw の toc と .md から data/features.json と summary.md を書く", () => {
    const result = buildFromRaw({ rawDir, dataDir, generatedAt: "2026-10-06T00:00:00.000Z", log: silent });
    expect(result.guardTripped).toBe(false);

    const written = readJson(join(dataDir, "features.json"));
    expect(written.cards).toBe(5);
    expect(written.cardsWithFeatures).toBe(4);
    expect(written.generatedAt).toBe("2026-10-06T00:00:00.000Z");
    expect(written.byModel["anthropic.claude-sonnet-5-5"].runtime.guardrails).toBe(true);
    expect(readFileSync(join(dataDir, "features.json"), "utf8").endsWith("}\n")).toBe(true);
    expect(readFileSync(join(rawDir, "summary.md"), "utf8")).toMatch(/^## Feature changes/);
  });

  it("2 回目は内容が同じなので generatedAt を据え置く", () => {
    buildFromRaw({ rawDir, dataDir, generatedAt: "2026-10-06T00:00:00.000Z", log: silent });
    buildFromRaw({ rawDir, dataDir, generatedAt: "2026-10-07T00:00:00.000Z", log: silent });
    expect(readJson(join(dataDir, "features.json")).generatedAt).toBe("2026-10-06T00:00:00.000Z");
    expect(readFileSync(join(rawDir, "summary.md"), "utf8")).toContain("No changes.");
  });

  it("toc にあって .md が無いカードは failedCards に数える", () => {
    rmSync(join(rawDir, rawCardName(CARDS[0])));
    buildFromRaw({ rawDir, dataDir, generatedAt: "2026-10-06T00:00:00.000Z", log: silent });
    expect(readJson(join(dataDir, "features.json")).failedCards).toBe(1);
  });

  it("--dry-run では data/features.json を書かず summary.md だけ書く", () => {
    buildFromRaw({ rawDir, dataDir, generatedAt: "2026-10-06T00:00:00.000Z", dryRun: true, log: silent });
    expect(existsSync(join(dataDir, "features.json"))).toBe(false);
    expect(existsSync(join(rawDir, "summary.md"))).toBe(true);
  });

  it("AC-008 安全弁が働いたら書き出さない", () => {
    const previous = { cardsWithFeatures: 100, byModel: {}, features: {} };
    writeFileSync(join(dataDir, "features.json"), json(previous));
    const result = buildFromRaw({ rawDir, dataDir, generatedAt: "2026-10-06T00:00:00.000Z", log: silent });
    expect(result.guardTripped).toBe(true);
    expect(readJson(join(dataDir, "features.json"))).toEqual(previous);
    expect(existsSync(join(rawDir, "summary.md"))).toBe(true);
  });

  it("生データのディレクトリが無ければ失敗する", () => {
    expect(() =>
      buildFromRaw({ rawDir: join(work, "missing"), dataDir, generatedAt: "x", log: silent }),
    ).toThrow(/生データ/);
  });
});
