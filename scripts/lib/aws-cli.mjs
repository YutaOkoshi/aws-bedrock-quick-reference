// `aws` CLI を子プロセスとして起動する唯一のモジュール (AC-009)。
// AWS SDK は import しない。package.json の dependencies は空のまま。
// 実行部分は runner として差し替えられるようにしてあり、テストは偽の runner を渡す。
import { spawnSync } from "node:child_process";

// 引数は必ず配列で渡す。シェル文字列を組み立てない (プロファイル名などがそのまま
// シェルに解釈されるのを避ける)。
export function defaultRunner(args) {
  const result = spawnSync("aws", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  if (result.error) {
    return { status: -1, stdout: "", stderr: String(result.error.message ?? result.error) };
  }
  return { status: result.status ?? -1, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

// ListFoundationModels はページネーションが無い (技術設計 §2.1)。
// 戻り値: { ok, raw, json, stderr }
export function listFoundationModels(runner, { profile, region }) {
  const result = runner([
    "bedrock",
    "list-foundation-models",
    "--profile",
    profile,
    "--region",
    region,
    "--output",
    "json",
  ]);
  if (result.status !== 0) return { ok: false, raw: result.stdout, json: null, stderr: result.stderr };
  try {
    return { ok: true, raw: result.stdout, json: JSON.parse(result.stdout), stderr: result.stderr };
  } catch (error) {
    return { ok: false, raw: result.stdout, json: null, stderr: `JSON parse failed: ${error.message}` };
  }
}

// ListInferenceProfiles は nextToken が無くなるまで繰り返す (AC-007)。
// typeEquals は SYSTEM_DEFINED 固定で、APPLICATION 型は取得しない (スコープ外)。
// 戻り値: { ok, raws, pages, stderr }
export function listInferenceProfiles(runner, { profile, region, maxPages = 100 }) {
  const raws = [];
  const pages = [];
  let nextToken = null;

  for (let page = 0; page < maxPages; page += 1) {
    const args = [
      "bedrock",
      "list-inference-profiles",
      "--profile",
      profile,
      "--region",
      region,
      "--type-equals",
      "SYSTEM_DEFINED",
      "--max-results",
      "1000",
      "--output",
      "json",
    ];
    if (nextToken) args.push("--next-token", nextToken);

    const result = runner(args);
    if (result.status !== 0) return { ok: false, raws, pages, stderr: result.stderr };
    let parsed;
    try {
      parsed = JSON.parse(result.stdout);
    } catch (error) {
      return { ok: false, raws, pages, stderr: `JSON parse failed: ${error.message}` };
    }
    raws.push(result.stdout);
    pages.push(parsed);
    nextToken = parsed.nextToken ?? null;
    if (!nextToken) return { ok: true, raws, pages, stderr: "" };
  }

  return { ok: false, raws, pages, stderr: `nextToken did not terminate after ${maxPages} pages` };
}

// ListFoundationModelAgreementOffers: Marketplace 経由のモデルの offer と単価表 (rateCard) を返す (D-018)。
// Marketplace 経由でないモデルは ValidationException "Agreement not supported for this model" になる。
// これは取得失敗ではなく「offer が無い」なので notSupported として返す。
// 戻り値: { ok, raw, json, notSupported, stderr }
export function listAgreementOffers(runner, { profile, region, modelId }) {
  const result = runner([
    "bedrock",
    "list-foundation-model-agreement-offers",
    "--model-id",
    modelId,
    "--profile",
    profile,
    "--region",
    region,
    "--output",
    "json",
  ]);
  if (result.status !== 0) {
    const notSupported = /Agreement not supported for this model/.test(result.stderr ?? "");
    return { ok: false, raw: result.stdout, json: null, notSupported, stderr: result.stderr };
  }
  try {
    return { ok: true, raw: result.stdout, json: JSON.parse(result.stdout), notSupported: false, stderr: result.stderr };
  } catch (error) {
    return { ok: false, raw: result.stdout, json: null, notSupported: false, stderr: `JSON parse failed: ${error.message}` };
  }
}
