// @vitest-environment node
// In-Region / Geo / Global を bedrock-runtime / bedrock-mantle ごとに出す (2026-10-08)。
import { describe, expect, it } from "vitest";
import { endpointAvailability } from "../src/scripts/feature-model.mjs";

const R = "ap-northeast-1";
const runtimeRow = { inRegion: false, geo: [{ profileId: "jp.m" }], global: { profileId: "global.m" } };
const features = (entry) => ({ byModel: { m: entry } });

describe("endpointAvailability", () => {
  it("Runtime は API の判定 (行の inRegion / geo / global) をそのまま使う", () => {
    const result = endpointAvailability({ features: {}, mantle: null, modelId: "m", region: R, row: runtimeRow });
    expect(result.inRegion.runtime).toBe(false);
    expect(result.geo.runtime).toBe(true);
    expect(result.global.runtime).toBe(true);
  });

  it("Mantle は docs の bedrock-mantle の地域の表で決める", () => {
    const f = features({ endpoints: { "bedrock-runtime": {}, "bedrock-mantle": {} }, regions: { "bedrock-mantle": { inRegion: [R], geo: [], global: [] } } });
    const result = endpointAvailability({ features: f, mantle: null, modelId: "m", region: R, row: runtimeRow });
    expect(result.inRegion).toMatchObject({ mantle: true, mantleShared: false });
    expect(result.geo.mantle).toBe(false);
    expect(result.global.mantle).toBe(false);
  });

  it("docs の Programmatic Access に bedrock-mantle の行が無ければ、Mantle はどのレーンも不可", () => {
    const f = features({ endpoints: { "bedrock-runtime": {} }, regions: { "bedrock-runtime": { inRegion: [], geo: [R], global: [R] } } });
    const result = endpointAvailability({ features: f, mantle: null, modelId: "m", region: R, row: runtimeRow });
    expect([result.inRegion.mantle, result.geo.mantle, result.global.mantle]).toEqual([false, false, false]);
  });

  it("接続先を分けていない表 (shared) を使ったときは mantleShared が立つ", () => {
    const f = features({ endpoints: { "bedrock-runtime": {}, "bedrock-mantle": {} }, regions: { shared: { inRegion: [R], geo: [], global: [] } } });
    const result = endpointAvailability({ features: f, mantle: null, modelId: "m", region: R, row: runtimeRow });
    expect(result.inRegion).toMatchObject({ mantle: true, mantleShared: true });
  });

  it("docs に地域の表が無ければ、In-Region は mantle.json で決め、Geo / Global は分からない (null)", () => {
    const mantle = { regions: [R], models: { m: { runtime: true, mantle: true } } };
    const result = endpointAvailability({ features: features({ endpoints: { "bedrock-mantle": {} } }), mantle, modelId: "m", region: R, row: runtimeRow });
    expect(result.inRegion.mantle).toBe(true);
    expect(result.geo.mantle).toBeNull();
    expect(result.global.mantle).toBeNull();
  });

  it("docs にも mantle.json にも無ければ、Mantle はすべて null (記載なし)", () => {
    const result = endpointAvailability({ features: {}, mantle: null, modelId: "m", region: R, row: runtimeRow });
    expect([result.inRegion.mantle, result.geo.mantle, result.global.mantle]).toEqual([null, null, null]);
  });
});
