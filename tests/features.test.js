// @vitest-environment node
// FEATURE-001 の単体テスト。docs のモデルカード (.md) の fixture を読むので node 環境で走らせる。
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import {
  DOCS_BASE,
  TOC_URL,
  cardMarkdownUrl,
  defaultColumnsOf,
  featureKey,
  listModelCards,
  normalizeFeatures,
  parseModelCard,
  resolveModelIds,
  sameContent,
} from "../scripts/lib/features.mjs";
import featureNames from "../data/feature-names.json";

const fixture = (name) =>
  readFileSync(fileURLToPath(new URL(`./fixtures/features/${name}`, import.meta.url)), "utf8");

const SONNET = "model-card-anthropic-claude-sonnet-5-5.html";
const TITAN = "model-card-amazon-titan-text-embeddings-v2.html";
const HAIKU = "model-card-anthropic-claude-haiku-4-5.html";
const NOVA = "model-card-amazon-nova-2-lite.html";
const LUNA = "model-card-openai-gpt-6-luna.html";

const markdownOf = (card) => fixture(card.replace(/\.html$/, ".md"));

// models.json の形だけ真似た小さな一覧。値の中身はパースに関係しない。
const MODELS = Object.fromEntries(
  [
    "anthropic.claude-sonnet-5-5",
    "anthropic.claude-haiku-4-5-20251001-v1:0",
    "amazon.nova-2-lite-v1:0",
    "amazon.nova-2-lite-v1:0:256k",
    "amazon.nova-2-pro-v1:0",
    "amazon.titan-embed-text-v2:0",
    "amazon.titan-embed-text-v2:0:8k",
    "openai.gpt-6-luna",
  ].map((id) => [id, { name: id }]),
);

function allCards() {
  return Object.fromEntries([SONNET, TITAN, HAIKU, NOVA, LUNA].map((c) => [c, markdownOf(c)]));
}

function build(overrides = {}) {
  return normalizeFeatures({
    cards: allCards(),
    models: MODELS,
    names: featureNames,
    map: {},
    previous: null,
    generatedAt: "2026-10-06T00:00:00.000Z",
    ...overrides,
  });
}

describe("AC-001 取得対象の列挙", () => {
  it("toc-contents.json から model-card-*.html を重複なし昇順で返す", () => {
    const cards = listModelCards(JSON.parse(fixture("toc-contents.json")));
    expect(cards).toHaveLength(134);
    expect(cards).toContain(SONNET);
    expect([...cards].sort()).toEqual(cards);
    expect(new Set(cards).size).toBe(cards.length);
  });

  it("カードの .md の URL は英語版 docs の userguide 配下", () => {
    expect(TOC_URL).toBe("https://docs.aws.amazon.com/bedrock/latest/userguide/toc-contents.json");
    expect(cardMarkdownUrl(SONNET)).toBe(`${DOCS_BASE}model-card-anthropic-claude-sonnet-5-5.md`);
  });
});

describe("AC-003 モデルカードのパース", () => {
  it("sonnet-5-5: ID・runtime / mantle の機能表・prompt caching・computer use を読む", () => {
    const parsed = parseModelCard(markdownOf(SONNET));
    expect(parsed.ids.runtime).toBe("anthropic.claude-sonnet-5-5");
    expect(parsed.ids.inference).toEqual([
      "us.anthropic.claude-sonnet-5-5",
      "eu.anthropic.claude-sonnet-5-5",
      "global.anthropic.claude-sonnet-5-5",
    ]);
    expect(parsed.runtime.Guardrails).toBe(true);
    expect(parsed.runtime["Structured outputs"]).toBe(false);
    expect(parsed.runtime["Count tokens"]).toBe(false);
    expect(parsed.mantle["Count tokens"]).toBe(true);
    expect(parsed.mantle.Guardrails).toBe(false);
    expect(parsed.promptCaching).toEqual({
      explicit: true,
      minTokens: "512",
      maxCheckpoints: "4",
      ttl: "5 minutes, 1 hour",
      fields: "system, messages, and tools",
      endpoints: ["runtime", "mantle"],
    });
    expect(parsed.computerUse).toEqual([
      { toolType: "computer_20251124", betaHeader: "computer-use-2025-11-24" },
    ]);
  });

  it("Endpoint support 表の bedrock-runtime 行を Model ID と取り違えない", () => {
    const parsed = parseModelCard(markdownOf(SONNET));
    expect(parsed.ids.runtime).not.toMatch(/supported|icon/);
  });

  it("titan-embeddings-v2: 機能節が無いと runtime / mantle / promptCaching は null、ID は取れる", () => {
    const parsed = parseModelCard(markdownOf(TITAN));
    expect(parsed.runtime).toBeNull();
    expect(parsed.mantle).toBeNull();
    expect(parsed.promptCaching).toBeNull();
    expect(parsed.computerUse).toBeNull();
    expect(parsed.ids.runtime).toBe("amazon.titan-embed-text-v2:0");
    // "Not supported" は ID として扱わない
    expect(parsed.ids.inference).toEqual([]);
  });

  it("haiku-4-5: Model ID が N/A なら runtime は null。mantle 表が先でも取り違えない", () => {
    const parsed = parseModelCard(markdownOf(HAIKU));
    expect(parsed.ids.runtime).toBeNull();
    expect(parsed.ids.inference).toContain("jp.anthropic.claude-haiku-4-5-20251001-v1:0");
    expect(parsed.runtime["Client-side tool calling"]).toBe(true);
    expect(parsed.mantle.Guardrails).toBe(false);
    expect(parsed.promptCaching.minTokens).toBe("4,096");
  });

  it("nova-2-lite: 表の値のエスケープ (\\*) を戻し、mantle 表が無ければ null", () => {
    const parsed = parseModelCard(markdownOf(NOVA));
    expect(parsed.mantle).toBeNull();
    expect(parsed.promptCaching.minTokens).toBe("1K*");
    expect(parsed.promptCaching.ttl).toBe("5 minutes");
    expect(parsed.computerUse).toBeNull();
  });

  it("gpt-6-luna: 見出しの揺れ (features / supported on the / Call the model) を読む", () => {
    const parsed = parseModelCard(markdownOf(LUNA));
    expect(parsed.ids.runtime).toBe("openai.gpt-6-luna");
    expect(parsed.ids.inference).toEqual(["us.openai.gpt-6-luna", "global.openai.gpt-6-luna"]);
    // 名前はリンクの中身。リンクの後ろの補足 (API の限定) は名前に含めない
    expect(parsed.runtime.Guardrails).toBe(true);
    expect(parsed.runtime["Knowledge Bases"]).toBe(false);
    expect(parsed.mantle["Server-side tool calling"]).toBe(true);
    // prompt caching は表ではなく文章なので null
    expect(parsed.promptCaching).toBeNull();
  });

  it("リンクの無い機能名は画像の後ろの平文を名前にする", () => {
    const md = [
      "## Capabilities and Features",
      "**Features supported using `bedrock-runtime` endpoint**",
      "",
      "| **Supported** | **Not Supported** | ",
      "| --- | --- | ",
      "|  + ![x](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Response streaming<br />+ ![x](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) Structured outputs  |  + ![x](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) [Guardrails](guardrails.html)  | ",
      "",
    ].join("\n");
    const parsed = parseModelCard(md);
    expect(parsed.runtime).toEqual({
      "Response streaming": true,
      "Structured outputs": true,
      Guardrails: false,
    });
  });

  it("prompt caching の表に 5 項目のどれも無ければ null (Implicit だけの表など)", () => {
    const md = [
      "## Capabilities and Features",
      "**Implicit Prompt Caching using `bedrock-runtime` endpoint**",
      "",
      "| **Implicit Prompt Caching supported** | **Endpoint** | ",
      "| --- | --- | ",
      "| Yes | bedrock-runtime | ",
    ].join("\n");
    expect(parseModelCard(md).promptCaching).toBeNull();
  });

  it("空・null は null を返す", () => {
    expect(parseModelCard(null)).toBeNull();
    expect(parseModelCard("")).toBeNull();
  });
});

describe("AC-005 モデル ID の解決", () => {
  it("haiku-4-5: Model ID が N/A なら inference ID の接頭辞を外して引く", () => {
    const parsed = parseModelCard(markdownOf(HAIKU));
    expect(resolveModelIds(HAIKU, parsed, { models: MODELS, map: {} })).toEqual([
      "anthropic.claude-haiku-4-5-20251001-v1:0",
    ]);
  });

  it("nova-2-lite: 文脈長違いの ID も <ID>: の前方一致で引く", () => {
    const parsed = parseModelCard(markdownOf(NOVA));
    expect(resolveModelIds(NOVA, parsed, { models: MODELS, map: {} })).toEqual([
      "amazon.nova-2-lite-v1:0",
      "amazon.nova-2-lite-v1:0:256k",
    ]);
  });

  it("対応表が最優先。値 null は空配列", () => {
    const parsed = parseModelCard(markdownOf(SONNET));
    expect(
      resolveModelIds(SONNET, parsed, { models: MODELS, map: { [SONNET]: ["openai.gpt-6-luna"] } }),
    ).toEqual(["openai.gpt-6-luna"]);
    expect(resolveModelIds(SONNET, parsed, { models: MODELS, map: { [SONNET]: null } })).toEqual(
      [],
    );
  });

  it("どの段でも当たらなければ空配列", () => {
    const parsed = parseModelCard(markdownOf(SONNET));
    expect(resolveModelIds(SONNET, parsed, { models: {}, map: {} })).toEqual([]);
  });
});

describe("AC-004 機能名の正規化", () => {
  it("対応表の名前は正規化キー、無い名前は unknown:<slug>", () => {
    expect(featureKey("Knowledge Bases", featureNames)).toBe("knowledgeBase");
    expect(featureKey("Foo bar", featureNames)).toBe("unknown:foo-bar");
  });

  it("gpt-6-luna: Knowledge Bases は knowledgeBase に寄る", () => {
    const { features } = build();
    expect(features.byModel["openai.gpt-6-luna"].runtime.knowledgeBase).toBe(false);
    expect(features.byModel["openai.gpt-6-luna"].runtime).not.toHaveProperty("unknown:knowledge-bases");
  });

  it("対応表に無い名前は unknown のキーで features と unknownFeatures に載る", () => {
    const md = markdownOf(SONNET).replace("[Flows](flows.html)", "[Foo bar](foo.html)");
    const { features } = build({ cards: { ...allCards(), [SONNET]: md } });
    expect(features.unknownFeatures).toEqual(["Foo bar"]);
    expect(features.features["unknown:foo-bar"]).toEqual({ label: "Foo bar", docs: "foo.html" });
    expect(features.byModel["anthropic.claude-sonnet-5-5"].runtime["unknown:foo-bar"]).toBe(true);
    // unknown は既知のキーの後ろに並ぶ
    const keys = Object.keys(features.features);
    expect(keys.at(-1)).toBe("unknown:foo-bar");
  });

  it("features は names.labels の順で、表示名と docs のリンク先を持つ", () => {
    const { features } = build();
    const order = Object.keys(featureNames.labels);
    const keys = Object.keys(features.features);
    expect(keys).toEqual(order.filter((k) => keys.includes(k)));
    expect(features.features.guardrails).toEqual({ label: "Guardrails", docs: "guardrails.html" });
    expect(featureNames.defaultColumns).toBe("all");
    expect(features.defaultColumns).toEqual(keys);
  });

  it("defaultColumns: all は unknown も含む全キーに展開し、配列指定はそのまま", () => {
    const md = markdownOf(SONNET).replace("[Flows](flows.html)", "[Foo bar](foo.html)");
    const { features } = build({ cards: { ...allCards(), [SONNET]: md } });
    expect(features.defaultColumns).toEqual(Object.keys(features.features));
    expect(features.defaultColumns).toContain("unknown:foo-bar");
    const listed = build({ names: { ...featureNames, defaultColumns: ["guardrails", "countTokens"] } });
    expect(listed.features.defaultColumns).toEqual(["guardrails", "countTokens"]);
    expect(defaultColumnsOf(undefined, ["a"])).toEqual([]);
  });
});

describe("AC-006 値の 3 状態と byModel", () => {
  it("Supported は true、Not Supported は false、記載なしはキーなし", () => {
    const { features } = build();
    const sonnet = features.byModel["anthropic.claude-sonnet-5-5"];
    expect(sonnet.card).toBe(SONNET);
    expect(sonnet.runtime.guardrails).toBe(true);
    expect(sonnet.runtime.structuredOutputs).toBe(false);
    expect(sonnet.mantle.countTokens).toBe(true);
    expect(sonnet.runtime).not.toHaveProperty("projects");
    expect(sonnet.promptCaching.minTokens).toBe("512");
  });

  it("文脈長違いの ID にも同じ内容が載る。機能節の無いカードは byModel に載らない", () => {
    const { features } = build();
    expect(features.byModel["amazon.nova-2-lite-v1:0:256k"].runtime.guardrails).toBe(true);
    expect(features.byModel).not.toHaveProperty("amazon.titan-embed-text-v2:0");
    expect(features.cards).toBe(5);
    expect(features.cardsWithFeatures).toBe(4);
    expect(features.failedCards).toBe(0);
  });

  it("引けないカードは unmatchedCards に残す。対応表の null は数えない", () => {
    const models = { ...MODELS };
    delete models["openai.gpt-6-luna"];
    const { features } = build({ models });
    expect(features.unmatchedCards).toEqual([
      { card: LUNA, modelId: "openai.gpt-6-luna", reason: "not-found" },
    ]);
    const confirmed = build({ models, map: { [LUNA]: null } });
    expect(confirmed.features.unmatchedCards).toEqual([]);
  });

  it("bedrock-runtime の行が無く、mantle の行の ID も models.json に無いカードは no-runtime-id。未知の機能名は ID が引けなくても数える", () => {
    const md = markdownOf(LUNA)
      .replace(/\n\| bedrock-runtime \| openai\.gpt-6-luna[^\n]*/, "")
      .replace("| bedrock-mantle | openai.gpt-6-luna |", "| bedrock-mantle | openai.gpt-6-luna-mantle-only |")
      .replace("[Projects](projects.html)", "[Foo bar](foo.html)");
    const { features } = build({ cards: { ...allCards(), [LUNA]: md } });
    expect(features.unmatchedCards).toEqual([{ card: LUNA, modelId: null, reason: "no-runtime-id" }]);
    expect(features.unknownFeatures).toEqual(["Foo bar"]);
  });

  it("2 枚のカードが同じ ID に当たったら後勝ちにせず duplicate で残す", () => {
    const { features } = build({ map: { [LUNA]: ["anthropic.claude-sonnet-5-5"] } });
    expect(features.byModel["anthropic.claude-sonnet-5-5"].card).toBe(SONNET);
    expect(features.unmatchedCards).toContainEqual({
      card: LUNA,
      modelId: "anthropic.claude-sonnet-5-5",
      reason: "duplicate",
    });
  });

  it("取得失敗 (値 null) は failedCards に数え、例外にしない", () => {
    const { features } = build({ cards: { ...allCards(), [SONNET]: null } });
    expect(features.failedCards).toBe(1);
    expect(features.byModel).not.toHaveProperty("anthropic.claude-sonnet-5-5");
  });
});

describe("AC-007 generatedAt の据え置き", () => {
  it("内容が前回と同じなら previous の generatedAt を引き継ぐ", () => {
    const first = build().features;
    const second = build({ previous: first, generatedAt: "2026-10-07T00:00:00.000Z" }).features;
    expect(second.generatedAt).toBe("2026-10-06T00:00:00.000Z");
    expect(sameContent(first, second)).toBe(true);
  });

  it("内容が変われば新しい generatedAt", () => {
    const first = build().features;
    const md = markdownOf(SONNET).replace("[Flows](flows.html)", "[Foo bar](foo.html)");
    const second = build({
      cards: { ...allCards(), [SONNET]: md },
      previous: first,
      generatedAt: "2026-10-07T00:00:00.000Z",
    }).features;
    expect(second.generatedAt).toBe("2026-10-07T00:00:00.000Z");
    expect(sameContent(first, second)).toBe(false);
  });
});

describe("AC-008 安全弁", () => {
  it("cardsWithFeatures が前回の半分未満なら guardTripped", () => {
    const previous = { ...build().features, cardsWithFeatures: 100 };
    expect(build({ previous }).guardTripped).toBe(true);
    expect(build({ previous: { ...previous, cardsWithFeatures: 8 } }).guardTripped).toBe(false);
    expect(build().guardTripped).toBe(false);
  });
});

describe("summary (PR 本文)", () => {
  it("モデルごとの機能の増減を +runtime:<名前> / -mantle:<名前> で出す", () => {
    const first = build().features;
    const md = markdownOf(SONNET)
      .replace(
        "icon-no.png) [Intelligent prompt routing](prompt-routing.html)<br />+ ![Red circle with white X icon indicating error, cancel, or close action.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png) [Count tokens]",
        "icon-no.png) [Intelligent prompt routing](prompt-routing.html)<br />+ ![x](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png) [Count tokens]",
      );
    expect(md).not.toBe(markdownOf(SONNET));
    const { summary } = build({ cards: { ...allCards(), [SONNET]: md }, previous: first });
    expect(summary).toMatch(/^## Feature changes/);
    expect(summary).toContain("- anthropic.claude-sonnet-5-5: +runtime:Count tokens");
  });

  it("差分が無ければ No changes.", () => {
    const first = build().features;
    expect(build({ previous: first }).summary).toContain("No changes.");
  });
});

// 機能一覧に Explicit Prompt Caching が無く、Prompt caching の表にだけ Yes があるカード (sonnet-4-5 相当)。
function cachingCard({ heading, listExplicit = null, explicit = "Yes" }) {
  const icon = (yes) =>
    `![x](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-${yes ? "yes" : "no"}.png)`;
  const runtimeItems = [`+ ${icon(true)} [Guardrails](guardrails.html)`];
  if (listExplicit !== null)
    runtimeItems.push(`+ ${icon(listExplicit)} [Explicit Prompt Caching](prompt-caching.html)`);
  return [
    "# Claude Sonnet 4.5",
    "## Capabilities and Features",
    "**Features supported using `bedrock-runtime` endpoint**",
    "",
    "| **Supported** | **Not Supported** | ",
    "| --- | --- | ",
    `|  ${runtimeItems.join("<br />")}  |  + ${icon(false)} [Count tokens](count-tokens.html)  | `,
    "",
    "**Features supported using `bedrock-mantle` endpoint**",
    "",
    "| **Supported** | **Not Supported** | ",
    "| --- | --- | ",
    `|  + ${icon(true)} [Count tokens](count-tokens.html)  |  + ${icon(false)} [Guardrails](guardrails.html)  | `,
    "",
    heading,
    "",
    "| **Explicit Prompt Caching supported** | **Min tokens per cache checkpoint** | **Max cache checkpoints per request** | **Supported TTL** | **Fields that accept prompt cache checkpoints** | ",
    "| --- | --- | --- | --- | --- | ",
    `| ${explicit} | 1,024 | 4 | 5 minutes | system, messages, and tools | `,
    "",
    "## Programmatic Access",
    "| **Endpoint** | **Model ID** | **In-Region endpoint URL** | **Geo inference ID** | **Global inference ID** | ",
    "| --- | --- | --- | --- | --- | ",
    "| bedrock-runtime | anthropic.claude-sonnet-4-5-20250929-v1:0 | N/A | N/A | N/A | ",
    "",
  ].join("\n");
}

describe("Explicit Prompt Caching を Prompt caching の表から補う", () => {
  const CARD = "model-card-anthropic-claude-sonnet-4-5.html";
  const ID = "anthropic.claude-sonnet-4-5-20250929-v1:0";
  const models = { [ID]: {} };
  const run = (md) =>
    normalizeFeatures({ cards: { [CARD]: md }, models, names: featureNames, map: {}, previous: null, generatedAt: "t" });

  it("見出しの接続先を endpoints に持つ (*** の見出しも読む)", () => {
    const both = parseModelCard(
      cachingCard({ heading: "***Implicit and Explicit Prompt Caching using `bedrock-runtime` and `bedrock-mantle` endpoints***" }),
    );
    expect(both.promptCaching.endpoints).toEqual(["runtime", "mantle"]);
    const none = parseModelCard(cachingCard({ heading: "**Implicit and Explicit Prompt Caching**" }));
    expect(none.promptCaching.endpoints).toEqual([]);
  });

  it("見出しにある接続先だけ explicitPromptCaching を補う。implicit は補わない", () => {
    const { features } = run(
      cachingCard({ heading: "**Implicit and Explicit Prompt Caching using `bedrock-runtime` endpoint**" }),
    );
    expect(features.byModel[ID].runtime.explicitPromptCaching).toBe(true);
    expect(features.byModel[ID].mantle).not.toHaveProperty("explicitPromptCaching");
    expect(features.byModel[ID].runtime).not.toHaveProperty("implicitPromptCaching");
  });

  it("見出しに接続先が無ければ補わない", () => {
    const { features } = run(cachingCard({ heading: "**Implicit and Explicit Prompt Caching**" }));
    expect(features.byModel[ID].runtime).not.toHaveProperty("explicitPromptCaching");
  });

  it("機能一覧の値を優先し、食い違いは上書きせず summary に conflict で出す", () => {
    const { features, summary } = run(
      cachingCard({
        heading: "**Prompt Caching using `bedrock-runtime` and `bedrock-mantle` endpoints**",
        listExplicit: false,
      }),
    );
    expect(features.byModel[ID].runtime.explicitPromptCaching).toBe(false);
    expect(features.byModel[ID].mantle.explicitPromptCaching).toBe(true);
    expect(summary).toContain("### Conflicts");
    expect(summary).toContain(`- ${CARD}: runtime:Explicit Prompt Caching`);
  });
});

// 推論 ID の食い違いの注釈 (2026-10-08): Programmatic Access の表から、接続先ごとの Geo / Global の推論 ID を読む。
describe("parseModelCard: 接続先ごとの Geo / Global の推論 ID", () => {
  const card = (rows) => [
    "## Programmatic Access",
    "",
    "| **Endpoint** | **Model ID** | **In-Region endpoint URL** | **Geo inference ID** | **Global inference ID** | ",
    "| --- | --- | --- | --- | --- | ",
    ...rows,
    "",
  ].join("\n");

  it("bedrock-runtime / bedrock-mantle の行ごとに Geo と Global の ID を持つ。Not supported / N/A は空", () => {
    const parsed = parseModelCard(markdownOf(LUNA));
    expect(parsed.endpoints).toEqual({
      "bedrock-mantle": { modelId: "openai.gpt-6-luna", geo: [], global: [] },
      "bedrock-runtime": { modelId: "openai.gpt-6-luna", geo: ["us.openai.gpt-6-luna"], global: ["global.openai.gpt-6-luna"] },
    });
  });

  it("<br /> 区切りと、文の中に書かれた ID (Kimi K3) を拾う", () => {
    const parsed = parseModelCard(card([
      "| bedrock-runtime | moonshotai.kimi-k3 | https://bedrock-runtime.{region}.amazonaws.com | us.moonshotai.kimi-k3 in the commercial AWS Regions, in.moonshotai.kimi-k3 in the India Regions | global.moonshotai.kimi-k3 | ",
    ]));
    expect(parsed.endpoints["bedrock-runtime"]).toEqual({
      modelId: "moonshotai.kimi-k3",
      geo: ["us.moonshotai.kimi-k3", "in.moonshotai.kimi-k3"],
      global: ["global.moonshotai.kimi-k3"],
    });
    const nova = parseModelCard(markdownOf(NOVA)).endpoints["bedrock-runtime"];
    expect(nova.geo.length).toBeGreaterThan(1);
  });

  it("bedrock-runtime の行が無いカード (GPT-5.4) は mantle の行だけ", () => {
    const parsed = parseModelCard(card(["| bedrock-mantle | openai.gpt-5.4 | https://bedrock-mantle.{region}.api.aws/openai/v1 | Not supported | Not supported | "]));
    expect(parsed.endpoints).toEqual({ "bedrock-mantle": { modelId: "openai.gpt-5.4", geo: [], global: [] } });
    expect(parsed.ids.runtime).toBeNull();
  });
});

describe("resolveModelIds: bedrock-runtime の行が無いカードは bedrock-mantle の行のモデル ID で引く", () => {
  it("models.json にある ID なら結び付ける。無ければ結び付けない", () => {
    const parsed = { ids: { runtime: null, inference: [] }, endpoints: { "bedrock-mantle": { modelId: "openai.gpt-5.4", geo: [], global: [] } } };
    expect(resolveModelIds("model-card-openai-gpt-54.html", parsed, { models: { "openai.gpt-5.4": {} }, map: {} })).toEqual(["openai.gpt-5.4"]);
    expect(resolveModelIds("model-card-openai-gpt-54.html", parsed, { models: {}, map: {} })).toEqual([]);
  });
});

// In-Region / Geo / Global を接続先ごとに出す (2026-10-08): Regional Availability / Supported Regions の表を読む。
describe("parseModelCard: 接続先ごとの地域の表 (regions)", () => {
  const YES = "![Green circle with white checkmark icon.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-yes.png)";
  const NO = "![Red circle with white X icon.](https://docs.aws.amazon.com/bedrock/latest/userguide/images/icons/icon-no.png)";
  const ids = (rows) => ["## Programmatic Access", "", "| **Endpoint** | **Model ID** | **In-Region endpoint URL** | **Geo inference ID** | **Global inference ID** | ", "| --- | --- | --- | --- | --- | ", ...rows, ""];

  it("古い書式: 接続先の見出しごとの表。値はアイコン", () => {
    const md = [
      ...ids(["| bedrock-runtime | m | x | us.m | global.m | ", "| bedrock-mantle | m | x | N/A | N/A | "]),
      "## Regional Availability", "", "Availability differs by endpoint.", "",
      "**Availability using the `bedrock-runtime` endpoint**", "", "",
      "| **Region** | **In-Region** | **Geo** | **Global** | ", "| --- | --- | --- | --- | ",
      `| us-east-1 (N. Virginia) | ${YES} | ${YES} | ${YES} | `,
      `| ap-northeast-1 (Tokyo) | ${NO} | ${NO} | ${YES} | `, "",
      "**Availability using the `bedrock-mantle` endpoint**", "", "",
      "| **Region** | **In-Region** | **Geo** | **Global** | ", "| --- | --- | --- | --- | ",
      `| ap-northeast-1 (Tokyo) | ${YES} | ${NO} | ${NO} | `, "",
      "## Quotas and Limits", "",
    ].join("\n");
    expect(parseModelCard(md).regions).toEqual({
      "bedrock-runtime": { inRegion: ["us-east-1"], geo: ["us-east-1"], global: ["ap-northeast-1", "us-east-1"] },
      "bedrock-mantle": { inRegion: ["ap-northeast-1"], geo: [], global: [] },
    });
  });

  it("新しい書式: Supported Regions の節で、値は Supported / Not supported、列名は US Geo CRIS / Global CRIS", () => {
    const md = [
      ...ids(["| bedrock-mantle | m | x | Not supported | Not supported | ", "| bedrock-runtime | m | Not supported | us.m | global.m | "]),
      "## Supported Regions", "",
      "**The `bedrock-mantle` endpoint**", "", "",
      "| **Region** | **In-Region** | **Geo** | **Global** | ", "| --- | --- | --- | --- | ",
      "| us-east-1 (US East (N. Virginia)) | Supported | Not supported | Not supported | ", "",
      "**The `bedrock-runtime` endpoint**", "", "",
      "| **Source Region** | **In-Region** | **US Geo CRIS** | **Global CRIS** | ", "| --- | --- | --- | --- | ",
      "| us-east-1 | Not supported | Supported | Supported | ",
      "| eu-central-1 | Not supported | Not supported | Supported | ", "",
    ].join("\n");
    expect(parseModelCard(md).regions).toEqual({
      "bedrock-mantle": { inRegion: ["us-east-1"], geo: [], global: [] },
      "bedrock-runtime": { inRegion: [], geo: ["us-east-1"], global: ["eu-central-1", "us-east-1"] },
    });
  });

  it("接続先の見出しが無い表は、Programmatic Access に接続先が 1 つだけならその接続先の表とする", () => {
    const md = [
      ...ids(["| bedrock-runtime | m | x | us.m | Not supported | "]),
      "## Regional Availability", "",
      "| **Region** | **In-Region** | **Geo** | **Global** | ", "| --- | --- | --- | --- | ",
      `| us-east-1 (N. Virginia) | ${YES} | ${YES} | ${NO} | `, "",
    ].join("\n");
    expect(parseModelCard(md).regions).toEqual({ "bedrock-runtime": { inRegion: ["us-east-1"], geo: ["us-east-1"], global: [] } });
  });

  it("接続先が 2 つあるのに見出しの無い表は、どちらか決めず shared (接続先を分けていない表) として読む", () => {
    const md = [
      ...ids(["| bedrock-runtime | m | x | us.m | global.m | ", "| bedrock-mantle | m | x | N/A | N/A | "]),
      "## Regional Availability", "",
      "| **Region** | **In-Region** | **Geo** | **Global** | ", "| --- | --- | --- | --- | ",
      `| us-east-1 (N. Virginia) | ${YES} | ${YES} | ${YES} | `, "",
    ].join("\n");
    expect(parseModelCard(md).regions).toEqual({ shared: { inRegion: ["us-east-1"], geo: ["us-east-1"], global: ["us-east-1"] } });
  });
});
