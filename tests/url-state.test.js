// SHARE-001 の単体テスト。AC-003 / 006 / 007 / 008 (パース・シリアライズの純関数側)。
import { describe, it, expect } from "vitest";
import {
  DEFAULT_STATE,
  PARAM_ORDER,
  parseState,
  searchString,
  serializeState,
  shareUrl,
} from "../src/scripts/url-state.mjs";
import { buildLimitOptions } from "../src/scripts/filter-model.mjs";
import { buildSnapshot, regionNotes } from "./fixtures/bedrock-fixture.js";

const snapshot = buildSnapshot();
const regions = Object.keys(regionNotes).filter((key) => key !== "_source");
const providers = ["Amazon", "Anthropic", "Cohere", "NVIDIA"];
// limit の正当値は FILTER-001 の選択肢そのもの。畳まれた値 (geo:jp など) も
// 選択肢が aliases に持っているので、ここでは値の一覧ではなく選択肢を渡す。
const limitOptions = buildLimitOptions({ regionNotes, profiles: snapshot.profiles });
const vocab = { regions, providers, limitOptions };

// --- AC-003 絞り込み条件が URL に載る ---
describe("SHARE-001 AC-003 絞り込み条件が URL に載る", () => {
  it("5 条件が provider / modality / q / callable / limit に載り、複数選択はカンマ区切り", () => {
    const query = serializeState({
      region: "ap-northeast-1",
      provider: ["Anthropic", "Cohere"],
      modality: ["TEXT"],
      q: "claude",
      callable: true,
      limit: "country:jp",
    });
    const params = new URLSearchParams(query);
    expect(params.get("provider")).toBe("Anthropic,Cohere");
    expect(params.get("modality")).toBe("TEXT");
    expect(params.get("q")).toBe("claude");
    expect(params.get("callable")).toBe("1");
    expect(params.get("limit")).toBe("country:jp");
  });

  it("既定値と同じ条件はパラメータから省く (既定状態の URL はクエリなし)", () => {
    expect(serializeState(DEFAULT_STATE)).toBe("");
    expect(serializeState({})).toBe("");
    expect(searchString(DEFAULT_STATE)).toBe("");
    // 既定の起点リージョンは載らないが、それ以外は載る
    expect(serializeState({ region: "ap-northeast-1" })).toBe("");
    expect(serializeState({ region: "eu-central-1" })).toBe("region=eu-central-1");
    expect(serializeState({ callable: false, limit: "none", q: "" })).toBe("");
  });

  it("パラメータの並び順は view / region / sort / provider / modality / q / callable / limit / cols", () => {
    const query = serializeState({
      view: "regions",
      sort: "alpha",
      region: "us-east-2",
      provider: ["Amazon"],
      modality: ["TEXT"],
      q: "nova",
      callable: true,
      limit: "geo:apac",
      cols: ["guardrails"],
    });
    expect([...new URLSearchParams(query).keys()]).toEqual([...PARAM_ORDER]);
  });
});

// --- AC-006 言語は URL に載せない ---
describe("SHARE-001 AC-006 言語は URL に載せない", () => {
  it("serializeState の出力に言語のパラメータが含まれない", () => {
    const query = serializeState({ region: "eu-west-1", limit: "geo:eu", lang: "ja" });
    const keys = [...new URLSearchParams(query).keys()];
    expect(keys).not.toContain("lang");
    expect(keys).not.toContain("language");
    expect(keys).not.toContain("locale");
    expect(PARAM_ORDER).not.toContain("lang");
  });

  it("展開中の行も URL に載せない", () => {
    const keys = [...new URLSearchParams(serializeState({ open: ["x"] })).keys()];
    expect(keys).toEqual([]);
  });
});

// --- AC-002 / AC-004 復元 ---
describe("SHARE-001 AC-004 URL からの絞り込み復元", () => {
  it("?region=...&provider=...&limit=... を状態に戻す", () => {
    const { state, ignored } = parseState(
      "?region=ap-northeast-1&provider=Anthropic&limit=country:jp",
      vocab,
    );
    expect(state.region).toBe("ap-northeast-1");
    expect(state.provider).toEqual(["Anthropic"]);
    expect(state.limit).toBe("country:jp");
    expect(ignored).toEqual([]);
  });

  it("serializeState → parseState で往復する", () => {
    const before = {
      view: "origin",
      sort: "pinned",
      region: "eu-central-1",
      provider: ["Anthropic", "Cohere"],
      modality: ["TEXT", "IMAGE"],
      q: "claude",
      callable: true,
      limit: "geo:eu",
      cols: null,
    };
    const { state } = parseState(`?${serializeState(before)}`, vocab);
    expect(state).toEqual(before);
  });
});

// --- AC-007 未知のリージョン ---
describe("SHARE-001 AC-007 未知のリージョン", () => {
  it("例外を投げず既定にフォールバックし、無視した値を報告する", () => {
    const { state, ignored } = parseState("?region=xx-nowhere-9", vocab);
    expect(state.region).toBe("ap-northeast-1");
    expect(ignored).toEqual([{ param: "region", value: "xx-nowhere-9", fallback: true }]);
    // URL は既定状態に書き換わる
    expect(serializeState(state)).toBe("");
  });
});

// --- AC-008 不正な絞り込みパラメータ ---
describe("SHARE-001 AC-008 不正な絞り込みパラメータ", () => {
  it("解釈できないパラメータだけを無視して残りを適用する", () => {
    const { state, ignored } = parseState(
      "?region=ap-northeast-1&limit=country:atlantis&modality=SMELL&callable=maybe&provider=Anthropic",
      vocab,
    );
    expect(state.region).toBe("ap-northeast-1");
    expect(state.provider).toEqual(["Anthropic"]);
    expect(state.limit).toBe("none");
    expect(state.modality).toEqual([]);
    expect(state.callable).toBe(false);
    expect(ignored.map((entry) => entry.param).sort()).toEqual(["callable", "limit", "modality"]);
  });

  it("複数選択は有効な値だけを残す", () => {
    const { state, ignored } = parseState("?provider=Anthropic,Atlantis&modality=text,SMELL", vocab);
    expect(state.provider).toEqual(["Anthropic"]);
    expect(state.modality).toEqual(["TEXT"]);
    expect(ignored).toEqual([
      { param: "provider", value: "Atlantis" },
      { param: "modality", value: "SMELL" },
    ]);
  });

  it("空のクエリ / 壊れたクエリでも既定状態を返す", () => {
    expect(parseState("", vocab).state).toEqual({ ...DEFAULT_STATE, provider: [], modality: [] });
    expect(parseState(undefined, vocab).state.region).toBe("ap-northeast-1");
    expect(parseState("?&&=broken&region=", vocab).state.region).toBe("ap-northeast-1");
  });

  it("XSS を狙う値も文字列として持つだけで例外にならない", () => {
    const { state, ignored } = parseState('?q=<img src=x onerror="alert(1)">', vocab);
    expect(state.q).toBe('<img src=x onerror="alert(1)">');
    expect(ignored).toEqual([]);
  });
});

// --- AC-005 共有用 URL ---
describe("SHARE-001 AC-005 共有用 URL の組み立て", () => {
  it("GitHub Pages のサブパスを保ったままクエリだけを差し替える", () => {
    const url = shareUrl(
      { region: "eu-central-1", limit: "geo:eu" },
      "https://koyakimu.github.io/aws-bedrock-quick-reference/?region=ap-northeast-3#old",
    );
    expect(url).toBe(
      "https://koyakimu.github.io/aws-bedrock-quick-reference/?region=eu-central-1&limit=geo%3Aeu",
    );
  });

  it("既定状態ならクエリなしの絶対 URL になる", () => {
    expect(shareUrl(DEFAULT_STATE, "https://example.com/sub/path/?region=eu-west-1")).toBe(
      "https://example.com/sub/path/",
    );
  });
});

// --- AC-010 limit のカスタム集合 (Issue #1 / FILTER-001 AC-016 / AC-017) ---
describe("SHARE-001 AC-010 limit のカスタム集合", () => {
  it("custom:<code>+<code> を状態に戻す (コードは昇順)", () => {
    const { state, ignored } = parseState("?limit=custom:ap-northeast-3%2Bap-northeast-1", vocab);
    expect(state.limit).toBe("custom:ap-northeast-1+ap-northeast-3");
    expect(ignored).toEqual([]);
  });

  it("生の + が空白に復号されても同じ集合になる", () => {
    // ?limit=custom:ap-northeast-1+ap-northeast-3 と手で書いた URL
    expect(parseState("?limit=custom:ap-northeast-1+ap-northeast-3", vocab).state.limit).toBe(
      "custom:ap-northeast-1+ap-northeast-3",
    );
  });

  it("serializeState → parseState で往復する", () => {
    const before = {
      view: "origin",
      sort: "pinned",
      region: "ap-northeast-1",
      provider: [],
      modality: [],
      q: "",
      callable: false,
      limit: "custom:ap-northeast-1+us-east-1",
      cols: null,
    };
    const query = serializeState(before);
    expect(query).toBe("limit=custom%3Aap-northeast-1%2Bus-east-1");
    expect(parseState(`?${query}`, vocab).state).toEqual(before);
  });

  it("region-notes.json に無いコードだけを落として報告する (AC-008 と同じ扱い)", () => {
    const { state, ignored } = parseState(
      "?limit=custom:ap-northeast-1%2Bxx-nowhere-9%2Bzz-void-1",
      vocab,
    );
    expect(state.limit).toBe("custom:ap-northeast-1");
    expect(ignored).toEqual([
      { param: "limit", value: "xx-nowhere-9" },
      { param: "limit", value: "zz-void-1" },
    ]);
  });

  it("空のカスタム集合は限定なしと同じ意味だが URL には残る", () => {
    expect(parseState("?limit=custom", vocab).state.limit).toBe("custom");
    expect(serializeState({ limit: "custom" })).toBe("limit=custom");
    // 全部が未知のコードなら空集合に潰れる
    expect(parseState("?limit=custom:xx-nowhere-9", vocab).state.limit).toBe("custom");
  });

  it("固定リストの値は今までどおり選択肢で検査する", () => {
    expect(parseState("?limit=country:atlantis", vocab).state.limit).toBe("none");
    expect(parseState("?limit=geo:apac", vocab).state.limit).toBe("geo:apac");
  });

  // FILTER-001 AC-019: 国と同じ集合になって畳まれた地理圏の値 (既存のリンク) は、
  // 残った選択肢の値に直して同じ集合を当てる。無視しない。
  it("畳まれた地理圏の値は残った選択肢の値に直す", () => {
    const jp = limitOptions.find((option) => option.value === "country:jp");
    expect(jp.aliases).toContain("geo:jp");
    const { state, ignored } = parseState("?limit=geo:jp", vocab);
    expect(state.limit).toBe("country:jp");
    expect(ignored).toEqual([]);
  });
});

// --- FEATURE-001 / SHARE-001 機能列 (cols=) ---
describe("FEATURE-001 cols= に表の機能列を載せる", () => {
  const featureKeys = ["streaming", "explicitPromptCaching", "structuredOutputs", "clientToolCalling", "guardrails"];
  const defaultCols = ["explicitPromptCaching", "structuredOutputs", "clientToolCalling", "guardrails"];
  const withKeys = { ...vocab, featureKeys };

  it("既定は cols: null (既定列) で、パラメータが無ければ null のまま", () => {
    expect(DEFAULT_STATE.cols).toBeNull();
    expect(PARAM_ORDER.at(-1)).toBe("cols");
    expect(parseState("", withKeys).state.cols).toBeNull();
  });

  it("cols=a,b を復元する", () => {
    const { state, ignored } = parseState("?cols=guardrails,streaming", withKeys);
    expect(state.cols).toEqual(["guardrails", "streaming"]);
    expect(ignored).toEqual([]);
  });

  it("cols= (空) は機能列なし", () => {
    const { state, ignored } = parseState("?cols=", withKeys);
    expect(state.cols).toEqual([]);
    expect(ignored).toEqual([]);
    expect(serializeState({ cols: [] }, { defaultCols })).toBe("cols=");
  });

  it("未知のキーは捨てて ignored に積む (AC-008 と同じ扱い)", () => {
    const { state, ignored } = parseState("?cols=guardrails,nope", withKeys);
    expect(state.cols).toEqual(["guardrails"]);
    expect(ignored).toEqual([{ param: "cols", value: "nope" }]);
  });

  it("null と既定と同じ並びは省き、それ以外はカンマ区切りで載せる", () => {
    expect(serializeState({ cols: null }, { defaultCols })).toBe("");
    expect(serializeState({ cols: [...defaultCols] }, { defaultCols })).toBe("");
    expect(serializeState({ cols: ["guardrails"] }, { defaultCols })).toBe("cols=guardrails");
    expect(serializeState({ cols: ["guardrails", "streaming"] }, { defaultCols })).toBe("cols=guardrails%2Cstreaming");
    expect(shareUrl({ cols: ["guardrails"] }, "https://example.com/x/", { defaultCols })).toBe("https://example.com/x/?cols=guardrails");
    expect(searchString({ cols: [] }, { defaultCols })).toBe("?cols=");
  });

  it("serializeState → parseState で往復する", () => {
    for (const cols of [["guardrails", "streaming"], []]) {
      const query = serializeState({ cols }, { defaultCols });
      expect(parseState(`?${query}`, withKeys).state.cols).toEqual(cols);
    }
  });
});
