// @vitest-environment node
// D-018: Marketplace の offer を取る CLI の引数と、aws の呼び方。
import { describe, expect, it } from "vitest";
import { parseMarketplaceArgs, rawName } from "../scripts/fetch-bedrock-marketplace-prices.mjs";
import { listAgreementOffers } from "../scripts/lib/aws-cli.mjs";

describe("parseMarketplaceArgs", () => {
  it("--profile が必須。--region の既定は us-east-1、--date の既定は呼び出し側の今日", () => {
    expect(parseMarketplaceArgs(["--profile", "p"], { today: "2026-10-08" })).toEqual({ profile: "p", region: "us-east-1", date: "2026-10-08", fromRaw: null });
    expect(() => parseMarketplaceArgs([], { today: "2026-10-08" })).toThrow(/--profile/);
  });

  it("--from-raw では --profile は要らず、日付はその日になる", () => {
    expect(parseMarketplaceArgs(["--from-raw", "2026-10-08"])).toMatchObject({ profile: null, date: "2026-10-08", fromRaw: "2026-10-08" });
  });

  it("日付の形と不明な引数を弾く", () => {
    expect(() => parseMarketplaceArgs(["--from-raw", "20261008"])).toThrow(/YYYY-MM-DD/);
    expect(() => parseMarketplaceArgs(["--profile", "p", "--x"])).toThrow(/不明な引数/);
  });

  it("生データのファイル名", () => {
    expect(rawName("stability.stable-image-inpaint-v1:0")).toBe("marketplace-stability.stable-image-inpaint-v1:0.json");
  });
});

describe("listAgreementOffers", () => {
  it("引数は配列で渡し、成功なら JSON を返す", () => {
    const calls = [];
    const runner = (args) => (calls.push(args), { status: 0, stdout: '{"offers":[]}', stderr: "" });
    expect(listAgreementOffers(runner, { profile: "p", region: "us-east-1", modelId: "openai.gpt-6-luna" })).toMatchObject({ ok: true, json: { offers: [] } });
    expect(calls[0]).toEqual(["bedrock", "list-foundation-model-agreement-offers", "--model-id", "openai.gpt-6-luna", "--profile", "p", "--region", "us-east-1", "--output", "json"]);
  });

  it("Marketplace 経由でないモデルは notSupported (取得失敗とは分ける)", () => {
    const runner = () => ({ status: 254, stdout: "", stderr: "An error occurred (ValidationException) when calling the ListFoundationModelAgreementOffers operation: Agreement not supported for this model" });
    expect(listAgreementOffers(runner, { profile: "p", region: "us-east-1", modelId: "xai.grok-4.7" })).toMatchObject({ ok: false, notSupported: true });
    const expired = () => ({ status: 255, stdout: "", stderr: "Token has expired" });
    expect(listAgreementOffers(expired, { profile: "p", region: "us-east-1", modelId: "x" })).toMatchObject({ ok: false, notSupported: false });
  });
});
