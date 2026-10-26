// @vitest-environment node
// fixture や package.json をファイルパスで読むので node 環境で走らせる
// (jsdom 環境だと import.meta.url が file: スキームにならない)。
// AC-009: runtime 依存を増やさない (D-001 の先例の規約)。
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) files.push(...walk(path));
    else files.push(path);
  }
  return files;
}

describe("AC-009 AWS SDK を使わず aws CLI を子プロセスで起動する", () => {
  const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));

  it("package.json の dependencies が空", () => {
    expect(pkg.dependencies ?? {}).toEqual({});
    expect(Object.keys(pkg.devDependencies).sort()).toEqual(["jsdom", "vite", "vite-plugin-singlefile", "vitest"]);
  });

  it("scripts/ 配下に @aws-sdk の import が無い", () => {
    for (const path of walk(join(ROOT, "scripts"))) {
      const source = readFileSync(path, "utf8");
      expect(source, path).not.toContain("@aws-sdk");
      expect(source, path).not.toContain("aws-sdk");
    }
  });

  it("aws を起動するのは scripts/lib/aws-cli.mjs だけ", () => {
    const spawners = walk(join(ROOT, "scripts")).filter((path) =>
      /node:child_process/.test(readFileSync(path, "utf8")),
    );
    expect(spawners.map((path) => path.slice(ROOT.length))).toEqual(["scripts/lib/aws-cli.mjs"]);
  });
});

describe("data/region-notes.json の形", () => {
  const notes = JSON.parse(readFileSync(join(ROOT, "data", "region-notes.json"), "utf8"));

  it("_source に出典 URL と日付がある", () => {
    expect(notes._source.date).toBe("2026-10-26");
    expect(notes._source.urls).toContain("https://docs.aws.amazon.com/general/latest/gr/bedrock.html");
    expect(notes._source.urls).toContain(
      "https://docs.aws.amazon.com/accounts/latest/reference/manage-acct-regions.html",
    );
  });

  it("全リージョンが ja / en / optIn / endpoint / country / geo を持つ", () => {
    // geo の値は接頭辞の固定リストではなく「2 文字以上の小文字コード」か、
    // どの地理圏にも属さない "other"。閉じた一覧は持たない (D-012)。
    const codes = Object.keys(notes).filter((key) => key !== "_source");
    expect(codes.length).toBeGreaterThan(20);
    for (const code of codes) {
      const note = notes[code];
      expect(typeof note.ja, code).toBe("string");
      expect(typeof note.en, code).toBe("string");
      expect(typeof note.optIn, code).toBe("boolean");
      expect(note.endpoint, code).toBe(`bedrock-runtime.${code}.amazonaws.com`);
      expect(note.country, code).toMatch(/^[a-z]{2}$/);
      expect(note.geo, code).toMatch(/^[a-z]{2,6}$/);
    }
  });

  it("geo は推論プロファイルの接頭辞の地理圏と対応する", () => {
    expect(notes["ap-northeast-1"].geo).toBe("jp");
    // DATA-001 AC-014: ca. / in. のプロファイルが実在するので geo も合わせる
    for (const code of ["ca-central-1", "ca-west-1"]) expect(notes[code].geo).toBe("ca");
    for (const code of ["ap-south-1", "ap-south-2"]) expect(notes[code].geo).toBe("in");
    expect(notes["ap-northeast-3"].geo).toBe("jp");
    for (const code of ["ap-southeast-2", "ap-southeast-4", "ap-southeast-6"]) expect(notes[code].geo).toBe("au");
    for (const code of ["us-east-1", "us-east-2", "us-west-1", "us-west-2"]) expect(notes[code].geo).toBe("us");
    expect(notes["eu-central-1"].geo).toBe("eu");
    expect(notes["ap-southeast-1"].geo).toBe("apac");
  });
});

describe("data/overrides.json", () => {
  it("空で、形を説明する _comment だけを持つ", () => {
    const overrides = JSON.parse(readFileSync(join(ROOT, "data", "overrides.json"), "utf8"));
    expect(Object.keys(overrides)).toEqual(["_comment"]);
    expect(overrides._comment).toContain("ja");
    expect(overrides._comment).toContain("en");
  });
});
