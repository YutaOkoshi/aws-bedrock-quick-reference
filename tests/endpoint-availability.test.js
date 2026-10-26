// @vitest-environment node
// In-Region / Geo / Global を bedrock-runtime / bedrock-mantle ごとに出す (2026-10-08)。
import { describe, expect, it } from "vitest";
import { endpointAvailability, endpointUnavailable, laneVerdict } from "../src/scripts/feature-model.mjs";

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

// 上段の判定は接続先をまとめる (D-021)。どちらかで使えれば可、片方だけなら only に接続先を入れる。
describe("laneVerdict", () => {
  it("両方使えるなら only は null", () => {
    expect(laneVerdict({ runtime: true, mantle: true })).toEqual({ available: true, only: null });
  });
  it("Runtime だけ (Mantle は不可と分かっている)", () => {
    expect(laneVerdict({ runtime: true, mantle: false })).toEqual({ available: true, only: "runtime" });
  });
  it("Mantle だけ", () => {
    expect(laneVerdict({ runtime: false, mantle: true })).toEqual({ available: true, only: "mantle" });
  });
  it("Mantle が記載なし (null) なら、Runtime だけでも only を付けない", () => {
    expect(laneVerdict({ runtime: true, mantle: null })).toEqual({ available: true, only: null });
  });
  it("どちらも不可", () => {
    expect(laneVerdict({ runtime: false, mantle: false })).toEqual({ available: false, only: null });
    expect(laneVerdict({ runtime: false, mantle: null })).toEqual({ available: false, only: null });
    expect(laneVerdict(undefined)).toEqual({ available: false, only: null });
  });
});

// 機能列を薄くするのは、起点で 3 区分とも不可と分かっている接続先だけ (記載なしは薄くしない)。
describe("endpointUnavailable", () => {
  const lanes = (runtime, mantle) => ({
    inRegion: { runtime: runtime[0], mantle: mantle[0] },
    geo: { runtime: runtime[1], mantle: mantle[1] },
    global: { runtime: runtime[2], mantle: mantle[2] },
  });
  it("3 区分とも false なら不可", () => {
    expect(endpointUnavailable(lanes([true, true, true], [false, false, false]), "mantle")).toBe(true);
    expect(endpointUnavailable(lanes([false, false, false], [true, false, false]), "runtime")).toBe(true);
  });
  it("1 つでも使えるか、記載なしがあれば不可としない", () => {
    expect(endpointUnavailable(lanes([true, true, true], [true, false, false]), "mantle")).toBe(false);
    expect(endpointUnavailable(lanes([true, true, true], [false, null, null]), "mantle")).toBe(false);
    expect(endpointUnavailable(null, "mantle")).toBe(false);
  });
});
