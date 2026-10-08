// @vitest-environment node
// docs のモデルカードと ListInferenceProfiles の、Geo / Global の推論 ID の食い違い (2026-10-08)。
import { describe, expect, it } from "vitest";
import { inferenceMismatches } from "../src/scripts/feature-model.mjs";

const features = (endpoints) => ({ byModel: { m: { card: "model-card-x.html", endpoints } } });
const profiles = (...ids) => Object.fromEntries(ids.map((id) => [id, { modelId: "m", sources: { "us-east-1": ["*"] } }]));

describe("inferenceMismatches", () => {
  it("API に Global があるのに docs の bedrock-runtime では Not supported (または行が無い)", () => {
    const result = inferenceMismatches(features({ "bedrock-mantle": { modelId: "m", geo: [], global: [] } }), profiles("global.m"), "m");
    expect(result.global).toEqual({ api: ["global.m"], docs: [] });
    expect(result.geo).toBeNull();
  });

  it("docs に Geo の ID があるのに API に無い", () => {
    const result = inferenceMismatches(features({ "bedrock-runtime": { modelId: "m", geo: ["us.m", "in.m"], global: [] } }), profiles("us.m"), "m");
    expect(result.geo).toEqual({ api: ["us.m"], docs: ["in.m", "us.m"] });
  });

  it("一致していれば null", () => {
    const result = inferenceMismatches(features({ "bedrock-runtime": { modelId: "m", geo: ["us.m"], global: ["global.m"] } }), profiles("us.m", "global.m"), "m");
    expect(result).toEqual({ geo: null, global: null });
  });

  it("docs の推論 ID の表が分からないモデルは比べない (null)", () => {
    expect(inferenceMismatches({ byModel: { m: { card: "x" } } }, profiles("global.m"), "m")).toEqual({ geo: null, global: null });
    expect(inferenceMismatches({}, profiles("global.m"), "m")).toEqual({ geo: null, global: null });
  });
});

describe("inferenceMismatches: 比べない ID", () => {
  it("カードの bedrock-runtime の行が別の ID (文脈長の付いた Provisioned 専用の ID など) なら比べない", () => {
    const f = { byModel: { "a.b-v1:0:256k": { endpoints: { "bedrock-runtime": { modelId: "a.b-v1:0", geo: ["us.a.b-v1:0"], global: ["global.a.b-v1:0"] } } } } };
    expect(inferenceMismatches(f, {}, "a.b-v1:0:256k")).toEqual({ geo: null, global: null });
  });

  it("GovCloud の推論 ID (us-gov.) は対象外なので docs 側から外す", () => {
    const f = { byModel: { m: { endpoints: { "bedrock-runtime": { modelId: "m", geo: ["us-gov.m"], global: [] } } } } };
    expect(inferenceMismatches(f, {}, "m")).toEqual({ geo: null, global: null });
  });
});
