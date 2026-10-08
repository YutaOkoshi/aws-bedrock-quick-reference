// DETAIL-001 v8 の純関数側 (レーンの要約・既定のレーン・並び・推論先・価格)。
import { describe, it, expect } from "vitest";
import {
  LANE_GEO,
  LANE_GLOBAL,
  LANE_IN_REGION,
  LANE_ORDER,
  buildDestinationLines,
  buildDetail,
  buildLaneSummaries,
  buildPriceRows,
  defaultLane,
  globalExtrasMissing,
  resolveLane,
  sortGeoProfiles,
} from "../src/scripts/detail-model.mjs";
import {
  buildSnapshot,
  buildPrices,
  regionNotes,
  regionNotesWithoutCountry,
  CLAUDE_45,
  EXTRA_PROFILES,
  NO_LANE_MODEL,
  NVIDIA,
  TOKYO,
} from "./fixtures/bedrock-fixture.js";
import mantle from "../data/mantle.json";

const snapshot = buildSnapshot();
const prices = buildPrices(snapshot.models);
const profiles = { ...snapshot.profiles, ...EXTRA_PROFILES };
const NOVA = "amazon.nova-lite-v1:0";
const COHERE = "cohere.embed-v4:0";

const summarize = (modelId, options = {}) =>
  buildLaneSummaries(modelId, {
    models: snapshot.models,
    profiles,
    region: TOKYO,
    regionNotes,
    ...options,
  });

describe("AC-014 レーンの要約", () => {
  it("3 レーン分を必ず返す", () => {
    const summaries = summarize(CLAUDE_45);
    expect(Object.keys(summaries)).toEqual([...LANE_ORDER]);
  });

  it("In-Region は availability[R] に ON_DEMAND があるかで決まる", () => {
    // Claude Sonnet 4.5 は東京で INFERENCE_PROFILE のみ = 不可。
    expect(summarize(CLAUDE_45)[LANE_IN_REGION].available).toBe(false);
    expect(summarize(NOVA)[LANE_IN_REGION].available).toBe(true);
  });

  it("Geo は全プロファイルの推論先の和集合を国内 / 国外に分けて数える", () => {
    const geo = summarize(CLAUDE_45)[LANE_GEO];
    expect(geo.available).toBe(true);
    // jp. (東京・大阪) ∪ apac. (8 件) = 8 件。国内 2 (東京・大阪)、国外 6。
    expect(geo.countryKnown).toBe(true);
    expect(geo.domesticCount).toBe(2);
    expect(geo.foreignCount).toBe(6);
    expect(geo.totalCount).toBe(8);
  });

  it("国外 0 件のプロファイルでは foreignCount が 0 になる", () => {
    // jp. だけのモデルを作る (apac. を外す)。
    const geo = buildLaneSummaries(CLAUDE_45, {
      models: snapshot.models,
      profiles: snapshot.profiles,
      region: TOKYO,
      regionNotes,
    })[LANE_GEO];
    expect(geo.domesticCount).toBe(2);
    expect(geo.foreignCount).toBe(0);
  });

  it("起点の country が分からないときは件数を切り分けず総数だけ返す", () => {
    const geo = summarize(CLAUDE_45, { regionNotes: regionNotesWithoutCountry() })[LANE_GEO];
    expect(geo.countryKnown).toBe(false);
    expect(geo.domesticCount).toBe(0);
    expect(geo.foreignCount).toBe(0);
    expect(geo.totalCount).toBe(8);
  });

  it("Global は global. プロファイルの有無で決まり ID を返す", () => {
    expect(summarize(CLAUDE_45)[LANE_GLOBAL].available).toBe(true);
    expect(summarize(CLAUDE_45)[LANE_GLOBAL].id).toBe(`global.${CLAUDE_45}`);
    expect(summarize(NOVA)[LANE_GLOBAL].available).toBe(false);
  });

  it("全不可のモデルでは 3 レーンとも available が false", () => {
    const summaries = summarize(NO_LANE_MODEL);
    expect(LANE_ORDER.map((lane) => summaries[lane].available)).toEqual([false, false, false]);
  });

  it("sources[R] が空配列でも Geo は「使える」(推論先 0 件)", () => {
    const geo = summarize(NVIDIA)[LANE_GEO];
    expect(geo.available).toBe(true);
    expect(geo.totalCount).toBe(0);
  });
});

describe("AC-015 既定で選ばれるレーン", () => {
  it("In-Region → Geo → Global の順で最初の可を返す", () => {
    expect(defaultLane(summarize(NOVA))).toBe(LANE_IN_REGION);
    expect(defaultLane(summarize(CLAUDE_45))).toBe(LANE_GEO);
    expect(defaultLane(summarize(COHERE))).toBe(LANE_IN_REGION);
  });

  it("Geo が無く Global だけあるモデルは Global", () => {
    const summaries = {
      inRegion: { available: false },
      geo: { available: false },
      global: { available: true },
    };
    expect(defaultLane(summaries)).toBe(LANE_GLOBAL);
  });

  it("3 つとも不可なら In-Region", () => {
    expect(defaultLane(summarize(NO_LANE_MODEL))).toBe(LANE_IN_REGION);
  });
});

describe("AC-020 セッション内で覚えたレーン", () => {
  it("覚えたレーンが使えるならそれを返す", () => {
    expect(resolveLane(LANE_GLOBAL, summarize(CLAUDE_45))).toBe(LANE_GLOBAL);
  });

  it("使えないなら既定に戻る", () => {
    expect(resolveLane(LANE_GLOBAL, summarize(NOVA))).toBe(LANE_IN_REGION);
    expect(resolveLane(null, summarize(CLAUDE_45))).toBe(LANE_GEO);
  });
});

describe("AC-018 Geo のプロファイルの並び", () => {
  it("sources[R] の件数の昇順、同数なら接頭辞の昇順", () => {
    const sorted = sortGeoProfiles(profiles, TOKYO).filter(
      (entry) => entry.profileId.endsWith(CLAUDE_45),
    );
    expect(sorted.map((entry) => entry.prefix)).toEqual(["jp", "apac"]);
  });

  it("同数のときは接頭辞で決まる", () => {
    const list = [
      { profileId: "zz.m", prefix: "zz", destinations: ["a", "b"] },
      { profileId: "aa.m", prefix: "aa", destinations: ["a", "b"] },
      { profileId: "mm.m", prefix: "mm", destinations: ["a"] },
    ];
    expect(sortGeoProfiles(list, TOKYO).map((entry) => entry.prefix)).toEqual(["mm", "aa", "zz"]);
  });

  it("要約のプロファイルも同じ並びになる", () => {
    expect(summarize(CLAUDE_45)[LANE_GEO].prefixes).toEqual(["jp", "apac"]);
  });
});

describe("AC-019 推論先の行", () => {
  const lines = (lane, options = {}) =>
    buildDestinationLines(lane, { region: TOKYO, regionNotes, ...options });

  it("In-Region は起点の地名 1 件、リージョンコードを含まない", () => {
    const { lines: rows } = lines(LANE_IN_REGION, { available: true });
    expect(rows).toEqual([{ kind: "inRegion", places: ["東京"], warn: false }]);
    expect(JSON.stringify(rows)).not.toContain(TOKYO);
  });

  it("In-Region 不可のときは説明文の材料を返す", () => {
    const { lines: rows } = lines(LANE_IN_REGION, { available: false });
    expect(rows).toEqual([{ kind: "notOffered", place: "東京" }]);
  });

  it("Geo は 国内 / 国外 の 2 行。国外は warn", () => {
    const { lines: rows, note } = lines(LANE_GEO, {
      destinations: EXTRA_PROFILES[`apac.${CLAUDE_45}`].sources[TOKYO],
    });
    expect(rows.map((row) => row.kind)).toEqual(["domestic", "foreign"]);
    expect(rows[0].places).toEqual(["東京", "大阪"]);
    expect(rows[0].warn).toBe(false);
    expect(rows[1].count).toBe(6);
    expect(rows[1].warn).toBe(true);
    expect(note).toBe("geo");
    expect(JSON.stringify(rows)).not.toContain("ap-northeast");
  });

  it("国外が 0 件ならその行を出さない", () => {
    const { lines: rows } = lines(LANE_GEO, { destinations: ["ap-northeast-1", "ap-northeast-3"] });
    expect(rows.map((row) => row.kind)).toEqual(["domestic"]);
  });

  it("起点の country が分からないときは 1 行にまとめる", () => {
    const { lines: rows } = lines(LANE_GEO, {
      destinations: ["ap-northeast-1", "ap-northeast-3"],
      regionNotes: regionNotesWithoutCountry(),
    });
    expect(rows.map((row) => row.kind)).toEqual(["any"]);
    expect(rows[0].count).toBe(2);
  });

  it("Global は 1 行だけで個別のリージョンを列挙しない", () => {
    const { lines: rows, note } = lines(LANE_GLOBAL);
    expect(rows).toEqual([{ kind: "globalScope", places: [], warn: true }]);
    expect(note).toBe("global");
  });

  it("英語でも地名だけを返す", () => {
    const { lines: rows } = lines(LANE_GEO, {
      destinations: ["ap-northeast-1", "ap-northeast-2"],
      lang: "en",
    });
    expect(rows[0].places).toEqual(["Asia Pacific (Tokyo)"]);
    expect(rows[1].places).toEqual(["Asia Pacific (Seoul)"]);
    expect(JSON.stringify(rows)).not.toContain("ap-northeast");
  });
});

describe("AC-013 レーンごとの価格", () => {
  it("In-Region / Geo は 標準 → バッチ → キャッシュ読み → キャッシュ書き", () => {
    expect(
      buildPriceRows(CLAUDE_45, { prices, region: TOKYO, lane: LANE_IN_REGION }).map((r) => r.kind),
    ).toEqual(["standard", "batch", "cacheRead"]);
    expect(
      buildPriceRows(CLAUDE_45, { prices, region: TOKYO, lane: LANE_GEO }).map((r) => r.kind),
    ).toEqual(["standard", "batch", "cacheRead"]);
  });

  it("Global は global の行だけ", () => {
    expect(
      buildPriceRows(CLAUDE_45, { prices, region: TOKYO, lane: LANE_GLOBAL }).map((r) => r.kind),
    ).toEqual(["global"]);
  });

  it("単価が 1 つも無ければ空配列", () => {
    expect(buildPriceRows("no-such-model", { prices, region: TOKYO, lane: LANE_GEO })).toEqual([]);
    expect(buildPriceRows(NOVA, { prices, region: TOKYO, lane: LANE_GLOBAL })).toEqual([]);
  });

  it("出力の単価が無い種別は output が null", () => {
    const rows = buildPriceRows(CLAUDE_45, { prices, region: TOKYO, lane: LANE_IN_REGION });
    expect(rows.find((row) => row.kind === "cacheRead").output).toBeNull();
  });

  it("Global にバッチ・キャッシュが無いことを判定できる (In-Region のバッチ・キャッシュは数えない)", () => {
    // fixture の Claude は In-Region のバッチ・キャッシュだけを持つ
    expect(globalExtrasMissing(CLAUDE_45, { prices, region: TOKYO })).toBe(true);
    const withGlobal = { byModel: { [CLAUDE_45]: { [TOKYO]: { global: { input: 3 }, globalCacheRead: { input: 0.3 } } } } };
    expect(globalExtrasMissing(CLAUDE_45, { prices: withGlobal, region: TOKYO })).toBe(false);
    expect(globalExtrasMissing("no-such-model", { prices, region: TOKYO })).toBe(false);
  });
});

describe("AC-010 / AC-022 パネル 1 枚ぶん", () => {
  const detailOf = (modelId, region = TOKYO) =>
    buildDetail(modelId, {
      models: snapshot.models,
      profiles,
      regionNotes,
      prices,
      mantle,
      region,
    });

  it("起点の bedrock-runtime の FQDN を持つ", () => {
    expect(detailOf(CLAUDE_45).endpoint).toBe("bedrock-runtime.ap-northeast-1.amazonaws.com");
  });

  it("mantle があるリージョンでだけ mantle の FQDN を持つ", () => {
    expect(detailOf(CLAUDE_45).mantleEndpoint).toBe("bedrock-mantle.ap-northeast-1.api.aws");
    expect(detailOf(CLAUDE_45, "ap-northeast-3").mantleEndpoint).toBeNull();
  });

  it("cause も availability も profiles も持たない (D-013 / D-008)", () => {
    const detail = detailOf(CLAUDE_45);
    expect(detail).not.toHaveProperty("cause");
    expect(detail).not.toHaveProperty("availability");
    expect(detail).not.toHaveProperty("profiles");
    expect(JSON.stringify({ ...detail, prices: null })).not.toContain("scp-deny");
  });

  it("anyLane で「どのレーンも使えない」が分かる", () => {
    expect(detailOf(CLAUDE_45).anyLane).toBe(true);
    expect(detailOf(NO_LANE_MODEL).anyLane).toBe(false);
  });
});
