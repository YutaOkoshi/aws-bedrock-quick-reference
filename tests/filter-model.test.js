// FILTER-001 の単体テスト。AC-001 / 002 / 003 / 004 / 005 / 006 / 007 / 008 / 011。
// 判定は TABLE-001 の行をそのまま使い、やり直さない。
import { describe, it, expect } from "vitest";
import { buildViewModel } from "../src/scripts/bedrock-view-model.mjs";
import { regionName } from "../src/scripts/region-names.js";
import {
  CUSTOM_LIMIT,
  LIMIT_GEO_ORDER_PREFERENCE,
  countryCodes,
  geoCodes,
  allRegionCodes,
  canonicalLimitValue,
  customLimitCodes,
  customLimitValue,
  customRegionGroups,
  isCustomLimit,
  normalizeCustomLimit,
  MODALITIES,
  NO_LIMIT,
  annotateRow,
  applyFilters,
  activeConditions,
  buildLimitOptions,
  geoGroupRegions,
  isCallable,
  isValidLimit,
  limitOption,
  limitRegionSet,
  providerOptions,
  regionsByCountry,
  removeCondition,
  satisfiesLimit,
} from "../src/scripts/filter-model.mjs";
import { buildSnapshot, regionNotes, TOKYO } from "./fixtures/bedrock-fixture.js";

const snapshot = buildSnapshot();

function rowsFor(region = TOKYO) {
  return buildViewModel({
    models: snapshot.models,
    profiles: snapshot.profiles,
    fetchLog: snapshot.fetchLog,
    regionNotes,
    region,
  }).rows;
}

const rows = rowsFor();
const options = buildLimitOptions({ regionNotes, profiles: snapshot.profiles });
const setFor = (value) => limitRegionSet(options, value);
const ids = (result) => result.rows.map((row) => row.modelId).sort();

// --- AC-001 提供元 ---
describe("FILTER-001 AC-001 提供元で絞る", () => {
  it("providerName が一致する行だけが残る", () => {
    const result = applyFilters(rows, { provider: ["Anthropic"] }, { region: TOKYO });
    expect(ids(result)).toEqual(["anthropic.claude-sonnet-4-5-20250929-v1:0"]);
    expect(result.total).toBe(rows.length);
    expect(result.shown).toBe(1);
  });

  it("選択肢は表示中データの providerName の実値から生成する (固定表を持たない)", () => {
    expect(providerOptions(rows)).toEqual(["Amazon", "Anthropic", "Cohere", "NVIDIA"]);
    expect(providerOptions([])).toEqual([]);
  });

  it("複数選んだら OR になる", () => {
    const result = applyFilters(rows, { provider: ["Anthropic", "Cohere"] }, { region: TOKYO });
    expect(ids(result)).toEqual([
      "anthropic.claude-sonnet-4-5-20250929-v1:0",
      "cohere.embed-v4:0",
    ]);
  });
});

// --- AC-002 モダリティ ---
describe("FILTER-001 AC-002 モダリティで絞る", () => {
  it("選択肢は TEXT / IMAGE / SPEECH / VIDEO / EMBEDDING の 5 種", () => {
    expect([...MODALITIES]).toEqual(["TEXT", "IMAGE", "SPEECH", "VIDEO", "EMBEDDING"]);
  });

  it("input に含まれる行が残る", () => {
    const result = applyFilters(rows, { modality: ["IMAGE"] }, { region: TOKYO });
    expect(ids(result)).toEqual([
      "amazon.nova-lite-v1:0",
      "anthropic.claude-sonnet-4-5-20250929-v1:0",
      "cohere.embed-v4:0",
      "nvidia.nemotron-nano-12b-v2",
    ]);
  });

  it("output にしか含まれない行も残る (EMBEDDING は出力側)", () => {
    const result = applyFilters(rows, { modality: ["EMBEDDING"] }, { region: TOKYO });
    expect(ids(result)).toEqual(["amazon.titan-embed-text-v1:2:8k", "cohere.embed-v4:0"]);
  });
});

// --- AC-003 名前の部分一致 ---
describe("FILTER-001 AC-003 名前の部分一致", () => {
  it("modelId に対して大文字小文字を区別せず部分一致する", () => {
    expect(ids(applyFilters(rows, { q: "SONNET" }, { region: TOKYO }))).toEqual([
      "anthropic.claude-sonnet-4-5-20250929-v1:0",
    ]);
  });

  it("modelName にしか無い語にも一致する", () => {
    // modelId は nvidia.nemotron-nano-12b-v2、名前だけが "Nemotron Nano 12B v2 VL BF16"
    expect(ids(applyFilters(rows, { q: "bf16" }, { region: TOKYO }))).toEqual([
      "nvidia.nemotron-nano-12b-v2",
    ]);
  });

  it("空文字や空白だけなら何も絞らない", () => {
    expect(applyFilters(rows, { q: "   " }, { region: TOKYO }).shown).toBe(rows.length);
  });
});

// --- AC-004 この起点から呼べるものだけ ---
describe("FILTER-001 AC-004 この起点リージョンから呼べるものだけ", () => {
  it("In-Region / Geo / Global が 3 つとも不可の行が消える", () => {
    const titan = rows.find((row) => row.modelId === "amazon.titan-embed-text-v1:2:8k");
    expect(titan.inRegion).toBe(false);
    expect(titan.geo).toEqual([]);
    expect(titan.global).toBeNull();
    expect(isCallable(titan)).toBe(false);

    const result = applyFilters(rows, { callable: true }, { region: TOKYO });
    expect(ids(result)).not.toContain("amazon.titan-embed-text-v1:2:8k");
    expect(result.shown).toBe(rows.length - 1);
  });

  it("いずれか 1 つが可なら残る", () => {
    const claude = rows.find((row) => row.modelId === "anthropic.claude-sonnet-4-5-20250929-v1:0");
    expect(claude.inRegion).toBe(false);
    expect(isCallable(claude)).toBe(true);
  });
});

// --- AC-005 推論先の限定: 国 ---
describe("FILTER-001 AC-005 推論先の限定 (国)", () => {
  it("国の選択肢はデータから導く (jp / us / au / ca / in)", () => {
    expect(countryCodes({ regionNotes, profiles: snapshot.profiles })).toEqual([
      "jp",
      "us",
      "au",
      "ca",
      "in",
    ]);
    expect(regionsByCountry(regionNotes, "jp")).toEqual(["ap-northeast-1", "ap-northeast-3"]);
    expect(regionsByCountry(regionNotes, "us")).toEqual([
      "us-east-1",
      "us-east-2",
      "us-west-1",
      "us-west-2",
    ]);
  });

  it("satisfiesLimit: jp. プロファイル / apac. プロファイル / In-Region の 3 パターン", () => {
    const jp = setFor("country:jp");
    // jp. プロファイルの destination は L の部分集合
    expect(satisfiesLimit(["ap-northeast-1", "ap-northeast-3"], jp)).toBe(true);
    // apac. プロファイルは ap-south-1 などを含むので満たさない
    expect(
      satisfiesLimit(
        ["ap-northeast-1", "ap-northeast-2", "ap-northeast-3", "ap-south-1"],
        jp,
      ),
    ).toBe(false);
    // In-Region の推論先は起点自身だけ
    expect(satisfiesLimit(["ap-northeast-1"], jp)).toBe(true);
  });

  it("「日本国内のみ」で残る行は In-Region 可の行と jp. を持つ行の和集合", () => {
    const result = applyFilters(
      rows,
      { limit: "country:jp" },
      { region: TOKYO, limitRegions: setFor("country:jp") },
    );
    expect(ids(result)).toEqual([
      "amazon.nova-lite-v1:0",
      "anthropic.claude-sonnet-4-5-20250929-v1:0",
      "cohere.embed-v4:0",
      "nvidia.nemotron-nano-12b-v2",
    ]);
  });

  it("満たさない使い方は行が残ってもセルが「限定外」の印になる", () => {
    const result = applyFilters(
      rows,
      { limit: "country:jp" },
      { region: TOKYO, limitRegions: setFor("country:jp") },
    );
    const nova = result.rows.find((row) => row.modelId === "amazon.nova-lite-v1:0");
    expect(nova.limit.inRegion).toBe(true);
    expect(nova.limit.geo["apac.amazon.nova-lite-v1:0"]).toBe(false);

    const claude = result.rows.find(
      (row) => row.modelId === "anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
    expect(claude.limit.geo["jp.anthropic.claude-sonnet-4-5-20250929-v1:0"]).toBe(true);
    expect(claude.limit.global).toBe(false);
  });
});

// --- AC-006 推論先の限定: 地理圏 ---
describe("FILTER-001 AC-006 推論先の限定 (地理圏)", () => {
  it("地理圏の一覧は固定リストではなくデータ由来 (D-012)", () => {
    expect(geoCodes({ regionNotes, profiles: snapshot.profiles })).toEqual([
      "jp",
      "apac",
      "eu",
      "us",
      "au",
      "ca",
      "in",
    ]);
  });

  it("地理圏グループは profiles.json の destination 和集合から導出する", () => {
    // ap-southeast-2 は region-notes.json では geo:au だが、apac. プロファイルの
    // destination に現れるのでグループに入る (固定表ではなくデータから導出している証拠)。
    const apac = geoGroupRegions(regionNotes, snapshot.profiles, "apac");
    expect(apac).toContain("ap-southeast-2");
    expect(apac).toContain("ap-northeast-1");
    expect(apac).toContain("ap-northeast-3");
    // プロファイルが 1 件も無い地理圏は region-notes.json の geo から導出する
    expect(geoGroupRegions(regionNotes, {}, "eu")).toContain("eu-central-1");
  });

  it("判定は接頭辞ではなく destination の包含で行う (jp. も APAC 内に収まる)", () => {
    const apac = setFor("geo:apac");
    const result = applyFilters(
      rows,
      { limit: "geo:apac" },
      { region: TOKYO, limitRegions: apac },
    );
    const claude = result.rows.find(
      (row) => row.modelId === "anthropic.claude-sonnet-4-5-20250929-v1:0",
    );
    expect(claude.limit.geo["jp.anthropic.claude-sonnet-4-5-20250929-v1:0"]).toBe(true);
    const nova = result.rows.find((row) => row.modelId === "amazon.nova-lite-v1:0");
    expect(nova.limit.geo["apac.amazon.nova-lite-v1:0"]).toBe(true);
  });

  it("起点が EU 圏外なら「EU 内のみ」で 0 件になる", () => {
    const result = applyFilters(
      rows,
      { limit: "geo:eu" },
      { region: TOKYO, limitRegions: setFor("geo:eu") },
    );
    expect(result.shown).toBe(0);
    expect(result.total).toBe(rows.length);
  });
});

// --- AC-007 In-Region と限定集合 ---
describe("FILTER-001 AC-007 In-Region と限定集合の関係", () => {
  it("R ∈ L なら In-Region は常に満たす", () => {
    const row = rows.find((r) => r.modelId === "nvidia.nemotron-nano-12b-v2");
    const annotated = annotateRow(row, { region: TOKYO, limitRegions: setFor("country:jp") });
    expect(annotated.limit.inRegion).toBe(true);
    expect(annotated.limit.any).toBe(true);
  });

  it("R ∉ L なら In-Region は満たさない", () => {
    const row = rows.find((r) => r.modelId === "nvidia.nemotron-nano-12b-v2");
    const annotated = annotateRow(row, { region: TOKYO, limitRegions: setFor("country:us") });
    expect(annotated.limit.inRegion).toBe(false);
    expect(annotated.limit.any).toBe(false);
  });
});

// --- AC-008 Global は常に満たさない ---
describe("FILTER-001 AC-008 Global は限定を満たさない", () => {
  it("destination が ['*'] のときどの L でも false", () => {
    // 空のカスタム集合は「制限なし」と同じ意味なので、L を持つ選択肢だけを見る (AC-015)。
    const values = [
      ...options.filter((o) => o.kind !== "none" && o.kind !== "custom").map((o) => o.value),
      "custom:ap-northeast-1+ap-northeast-3",
    ];
    for (const value of values) {
      expect(satisfiesLimit(["*"], setFor(value)), value).toBe(false);
    }
  });

  it("global. しか使えないモデルは限定選択時に候補から外れる", () => {
    const onlyGlobal = [
      {
        modelId: "vendor.global-only",
        provider: "Vendor",
        name: "Global Only",
        input: ["TEXT"],
        output: ["TEXT"],
        inRegion: false,
        geo: [],
        global: { profileId: "global.vendor.global-only", prefix: "global" },
        notes: [],
      },
    ];
    expect(applyFilters(onlyGlobal, { limit: NO_LIMIT }, { region: TOKYO }).shown).toBe(1);
    expect(
      applyFilters(
        onlyGlobal,
        { limit: "country:jp" },
        { region: TOKYO, limitRegions: setFor("country:jp") },
      ).shown,
    ).toBe(0);
  });
});

// --- AC-009 組み合わせ (単体側。画面側は filter-render.test.js) ---
describe("FILTER-001 AC-009 絞り込みの組み合わせは AND", () => {
  it("4 条件の AND を満たす行だけが残る", () => {
    const result = applyFilters(
      rows,
      { provider: ["Anthropic"], modality: ["TEXT"], q: "claude", limit: "country:jp" },
      { region: TOKYO, limitRegions: setFor("country:jp") },
    );
    expect(ids(result)).toEqual(["anthropic.claude-sonnet-4-5-20250929-v1:0"]);
    expect(result.total).toBe(5);
  });
});

// --- AC-011 限定集合に未知のリージョン ---
describe("FILTER-001 AC-011 限定集合に未知のリージョンが含まれる", () => {
  const profilesWithUnknown = {
    ...snapshot.profiles,
    "jp.vendor.future-model": {
      prefix: "jp",
      modelId: "vendor.future-model",
      name: "JP Future",
      sources: { "ap-northeast-1": ["ap-northeast-1", "xx-nowhere-9"] },
    },
  };

  it("region-notes.json に無いコードも限定集合にそのまま含める", () => {
    const jp = geoGroupRegions(regionNotes, profilesWithUnknown, "jp");
    expect(jp).toContain("xx-nowhere-9");
    expect(jp).toContain("ap-northeast-1");
  });

  it("表示名はコードをそのまま出す (落とさない・例外にしない)", () => {
    expect(regionName("xx-nowhere-9", "ja", regionNotes)).toBe("xx-nowhere-9");
    expect(regionName("xx-nowhere-9", "en", regionNotes)).toBe("xx-nowhere-9");
  });

  it("判定が黙って緩まない (未知コードを含む L でも包含判定は厳密)", () => {
    const unknownOptions = buildLimitOptions({ regionNotes, profiles: profilesWithUnknown });
    const jp = limitRegionSet(unknownOptions, "geo:jp");
    expect(satisfiesLimit(["ap-northeast-1", "xx-nowhere-9"], jp)).toBe(true);
    // L に無い ap-south-1 が 1 つでも混じれば満たさない
    expect(satisfiesLimit(["ap-northeast-1", "ap-south-1"], jp)).toBe(false);
    expect(satisfiesLimit([], jp)).toBe(false);
  });
});

// --- 補助: 条件チップと limit の正当性判定 (SHARE-001 が使う) ---
describe("FILTER-001 条件チップ", () => {
  it("設定中の条件が 1 個ずつチップに展開される", () => {
    expect(
      activeConditions({ provider: ["Anthropic"], modality: ["TEXT"], q: "claude", callable: true, limit: "country:jp" }),
    ).toEqual([
      { param: "provider", value: "Anthropic" },
      { param: "modality", value: "TEXT" },
      { param: "q", value: "claude" },
      { param: "callable", value: true },
      { param: "limit", value: "country:jp" },
    ]);
    expect(activeConditions({})).toEqual([]);
  });

  it("チップを外すとその条件だけが消える", () => {
    const next = removeCondition(
      { provider: ["Anthropic", "Cohere"], limit: "country:jp" },
      { param: "provider", value: "Anthropic" },
    );
    expect(next.provider).toEqual(["Cohere"]);
    expect(next.limit).toBe("country:jp");
    expect(removeCondition(next, { param: "limit", value: "country:jp" }).limit).toBe(NO_LIMIT);
  });

  it("limit の正当値は選択肢の値と、畳まれた値の別名", () => {
    expect(options[0].value).toBe(NO_LIMIT);
    expect(options.at(-1).value).toBe(CUSTOM_LIMIT);
    expect(isValidLimit(options, "country:atlantis")).toBe(false);
    expect(isValidLimit(options, "country:jp")).toBe(true);
    expect(isValidLimit(options, "geo:apac")).toBe(true);
  });
});

// --- AC-018 / AC-019 選択肢の重複を畳む (v4) ---
describe("FILTER-001 AC-018 推論先の限定の選択肢は 1 つの平坦なリスト", () => {
  it("並びは 制限なし → 国 (jp / us / au) → 残った地理圏 → カスタム", () => {
    const values = options.map((option) => option.value);
    expect(values[0]).toBe(NO_LIMIT);
    expect(values.at(-1)).toBe(CUSTOM_LIMIT);
    const middle = values.slice(1, -1);
    const countries = middle.filter((value) => value.startsWith("country:"));
    const geos = middle.filter((value) => value.startsWith("geo:"));
    // 国が先、地理圏が後。国と地理圏が交互に混ざらない
    expect(middle).toEqual([...countries, ...geos]);
    expect(countries).toEqual([
      "country:jp",
      "country:us",
      "country:au",
      "country:ca",
      "country:in",
    ]);
    // 残った地理圏は LIMIT_GEO_ORDER_PREFERENCE の並びのまま
    const geoOrder = LIMIT_GEO_ORDER_PREFERENCE.map((code) => `geo:${code}`);
    expect(geos).toEqual(geoOrder.filter((value) => geos.includes(value)));
  });

  it("国と集合が同じ地理圏は落ち、国のラベルだけが残る", () => {
    const jp = limitOption(options, "country:jp");
    expect(jp.labelKey).toBe("filter.country.jp");
    expect(jp.aliases).toContain("geo:jp");
    expect(options.map((option) => option.value)).not.toContain("geo:jp");
    // 集合が違う地理圏は残る (au は country:au に無い ap-southeast-6 を含む)
    const geoAu = limitOption(options, "geo:au");
    expect(geoAu.value).toBe("geo:au");
    expect(geoAu.labelKey).toBe("filter.geo.au");
    expect(geoAu.regions).not.toEqual(limitOption(options, "country:au").regions);
  });

  it("残った選択肢の集合はどれも互いに違う (重複が残らない)", () => {
    const sets = options
      .filter((option) => option.kind === "country" || option.kind === "geo")
      .map((option) => option.regions.join(","));
    expect(new Set(sets).size).toBe(sets.length);
  });

  it("選択肢はリージョン数を持つ (ラベルの件数はデータ由来)", () => {
    for (const option of options) {
      if (option.kind === "country" || option.kind === "geo") {
        expect(option.regions.length).toBe(new Set(option.regions).size);
        expect(option.regions.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("FILTER-001 AC-019 畳まれた値の URL は同じ集合を当てる", () => {
  it("geo:jp は country:jp に解決し、限定集合も同じ", () => {
    expect(canonicalLimitValue(options, "geo:jp")).toBe("country:jp");
    expect([...setFor("geo:jp")].sort()).toEqual([...setFor("country:jp")].sort());
    expect(isValidLimit(options, "geo:jp")).toBe(true);
  });

  it("選択肢にも別名にも無い値は null", () => {
    expect(canonicalLimitValue(options, "geo:atlantis")).toBeNull();
    expect(canonicalLimitValue(options, NO_LIMIT)).toBe(NO_LIMIT);
    expect(canonicalLimitValue(options, "custom:ap-northeast-1")).toBe("custom:ap-northeast-1");
  });
});

// --- AC-012 〜 AC-017 カスタム (リージョン複数選択、Issue #1) ---
describe("FILTER-001 AC-012 カスタムの限定集合", () => {
  it("セレクタの末尾がカスタムで、集合は持たない", () => {
    const custom = options.at(-1);
    expect(custom.value).toBe(CUSTOM_LIMIT);
    expect(custom.kind).toBe("custom");
    expect(custom.labelKey).toBe("filter.limitCustom");
    expect(isValidLimit(options, CUSTOM_LIMIT)).toBe(true);
    expect(isValidLimit(options, "custom:ap-northeast-1")).toBe(true);
  });

  it("選んだリージョンから L を作り、satisfiesLimit は固定リストと同じ判定をする", () => {
    const value = customLimitValue(["ap-northeast-3", "ap-northeast-1"]);
    expect(value).toBe("custom:ap-northeast-1+ap-northeast-3");
    const L = setFor(value);
    expect([...L].sort()).toEqual(["ap-northeast-1", "ap-northeast-3"]);
    // jp. プロファイルは収まる / apac. は収まらない / Global は常に満たさない
    expect(satisfiesLimit(["ap-northeast-1", "ap-northeast-3"], L)).toBe(true);
    expect(satisfiesLimit(["ap-northeast-1", "ap-south-1"], L)).toBe(false);
    expect(satisfiesLimit(["*"], L)).toBe(false);
  });

  it("同じ集合なら固定リストの country:jp と結果が一致する", () => {
    const custom = applyFilters(
      rows,
      { limit: "custom:ap-northeast-1+ap-northeast-3" },
      { region: TOKYO, limitRegions: setFor("custom:ap-northeast-1+ap-northeast-3") },
    );
    const fixed = applyFilters(
      rows,
      { limit: "country:jp" },
      { region: TOKYO, limitRegions: setFor("country:jp") },
    );
    expect(ids(custom)).toEqual(ids(fixed));
  });

  it("チップは件数で表す (activeConditions に載る)", () => {
    expect(activeConditions({ limit: "custom:ap-northeast-1+ap-northeast-3" })).toEqual([
      { param: "limit", value: "custom:ap-northeast-1+ap-northeast-3" },
    ]);
  });
});

describe("FILTER-001 AC-013 地理圏ごとのグループ", () => {
  it("ピッカーの区分は region-notes.json の geo から作る (固定表を持たない)", () => {
    const groups = customRegionGroups(regionNotes);
    // ca / in は region-notes.json の geo に足した実値から自動で現れる (DATA-001 AC-014)。
    expect(groups.map((group) => group.geo)).toEqual([
      "jp",
      "apac",
      "eu",
      "us",
      "au",
      "ca",
      "in",
      "other",
    ]);
    expect(groups.find((group) => group.geo === "jp").regions).toEqual([
      "ap-northeast-1",
      "ap-northeast-3",
    ]);
    expect(groups.find((group) => group.geo === "ca").regions).toEqual([
      "ca-central-1",
      "ca-west-1",
    ]);
    expect(groups.find((group) => group.geo === "in").regions).toEqual([
      "ap-south-1",
      "ap-south-2",
    ]);
    // 全リージョンがちょうど 1 つのグループに入る
    const all = groups.flatMap((group) => group.regions).sort();
    expect(all).toEqual(allRegionCodes(regionNotes));
    expect(new Set(all).size).toBe(all.length);
  });

  it("グループ一括選択は既存の選択に足し込む", () => {
    const jp = customRegionGroups(regionNotes).find((group) => group.geo === "jp").regions;
    const next = customLimitValue([...new Set(["us-east-1", ...jp])]);
    expect(next).toBe("custom:ap-northeast-1+ap-northeast-3+us-east-1");
  });
});

describe("FILTER-001 AC-014 選択のクリアと固定リストへの復帰", () => {
  it("クリアすると空集合の custom に戻る", () => {
    expect(customLimitValue([])).toBe(CUSTOM_LIMIT);
    expect(customLimitCodes(CUSTOM_LIMIT)).toEqual([]);
  });

  it("固定リストに戻すとカスタムの集合は残らない", () => {
    expect(isCustomLimit("country:jp")).toBe(false);
    expect(customLimitCodes("country:jp")).toEqual([]);
    expect(removeCondition({ limit: "custom:ap-northeast-1" }, { param: "limit" }).limit).toBe(
      NO_LIMIT,
    );
  });
});

describe("FILTER-001 AC-015 空のカスタム集合は限定しない", () => {
  it("L は null になり、どの行も落ちない", () => {
    expect(setFor(CUSTOM_LIMIT)).toBeNull();
    const result = applyFilters(rows, { limit: CUSTOM_LIMIT }, { region: TOKYO, limitRegions: null });
    expect(result.shown).toBe(rows.length);
    // 限定の印も付かない (制限なしと同じ扱い)
    expect(result.rows.every((row) => row.limit.active === false)).toBe(true);
  });

  it("条件チップには数えない (制限なしと同じ意味のため)", () => {
    expect(activeConditions({ limit: CUSTOM_LIMIT })).toEqual([]);
  });
});

describe("FILTER-001 AC-016 カスタム集合の表現", () => {
  it("コードは昇順・重複なしで + 連結する", () => {
    expect(customLimitValue(["us-east-1", "ap-northeast-1", "us-east-1"])).toBe(
      "custom:ap-northeast-1+us-east-1",
    );
    expect(customLimitCodes("custom:us-east-1+ap-northeast-1")).toEqual([
      "ap-northeast-1",
      "us-east-1",
    ]);
  });

  it("URLSearchParams が + を空白に復号しても読める", () => {
    expect(customLimitCodes("custom:ap-northeast-1 ap-northeast-3")).toEqual([
      "ap-northeast-1",
      "ap-northeast-3",
    ]);
  });
});

describe("FILTER-001 AC-017 カスタム集合に未知のリージョンコード", () => {
  const known = allRegionCodes(regionNotes);

  it("region-notes.json に無いコードは落とし、落としたことを報告する", () => {
    const result = normalizeCustomLimit("custom:ap-northeast-1+xx-nowhere-9", known);
    expect(result.codes).toEqual(["ap-northeast-1"]);
    expect(result.dropped).toEqual(["xx-nowhere-9"]);
    expect(result.value).toBe("custom:ap-northeast-1");
  });

  it("全部が未知なら空集合 (= 限定しない) になる", () => {
    const result = normalizeCustomLimit("custom:xx-nowhere-9+zz-void-1", known);
    expect(result.codes).toEqual([]);
    expect(result.value).toBe(CUSTOM_LIMIT);
    expect(result.dropped).toEqual(["xx-nowhere-9", "zz-void-1"]);
  });

  it("落とした結果の判定は緩まない (残ったコードだけで包含を見る)", () => {
    const { value } = normalizeCustomLimit("custom:ap-northeast-1+xx-nowhere-9", known);
    const L = setFor(value);
    expect(satisfiesLimit(["ap-northeast-1"], L)).toBe(true);
    expect(satisfiesLimit(["ap-northeast-1", "ap-northeast-3"], L)).toBe(false);
  });
});

// D-021: 「呼べるものだけ」と In-Region の限定は、bedrock-mantle で呼べる場合も数える。
describe("D-021 bedrock-mantle だけで呼べる行", () => {
  const titan = () => rows.find((row) => row.modelId === "amazon.titan-embed-text-v1:2:8k");
  const withMantle = (row, lane) => ({
    ...row,
    endpoints: { inRegion: { runtime: false, mantle: lane === "inRegion" }, geo: { runtime: false, mantle: lane === "geo" }, global: { runtime: false, mantle: lane === "global" } },
  });

  it("Mantle の In-Region だけで呼べる行は「呼べるものだけ」に残る", () => {
    expect(isCallable(withMantle(titan(), "inRegion"))).toBe(true);
    expect(isCallable(withMantle(titan(), null))).toBe(false);
  });

  it("Mantle の In-Region は推論先が起点だけなので、R ∈ L なら限定を満たす", () => {
    const row = withMantle(titan(), "inRegion");
    expect(annotateRow(row, { region: TOKYO, limitRegions: setFor("country:jp") }).limit.inRegion).toBe(true);
    expect(annotateRow(row, { region: TOKYO, limitRegions: setFor("country:us") }).limit.inRegion).toBe(false);
  });
});
