// 公式 docs (英語版) のモデルカード .md を data/features.json の形に直す純関数群 (FEATURE-001 / D-015)。
// I/O・時刻・ネットワークを持たない。取得と書き出しは scripts/fetch-bedrock-features.mjs が行う。

// 取得元は英語版 docs の userguide だけ (FEATURE-001 AC-001)。認証は要らない。
export const DOCS_BASE = "https://docs.aws.amazon.com/bedrock/latest/userguide/";
export const TOC_URL = `${DOCS_BASE}toc-contents.json`;

const CARD_HREF = /^model-card-.+\.html$/;

// "model-card-x.html" -> 同じページの markdown 版。docs は .html を .md に替えると text/markdown で返す。
export function cardMarkdownUrl(card) {
  return `${DOCS_BASE}${String(card).replace(/\.html$/, ".md")}`;
}

// toc-contents.json を再帰で歩いてモデルカードを集める。入れ子の深さは固定しない。
export function listModelCards(toc) {
  const found = new Set();
  const walk = (node) => {
    if (Array.isArray(node)) {
      node.forEach(walk);
      return;
    }
    if (!node || typeof node !== "object") return;
    if (typeof node.href === "string" && CARD_HREF.test(node.href)) found.add(node.href);
    Object.values(node).forEach(walk);
  };
  walk(toc);
  return [...found].sort();
}

// --- markdown の読み取り ---------------------------------------------------

// 表のセルに入る markdown のエスケープ (\_ \* など) を戻す。
function unescape(text) {
  return String(text ?? "").replace(/\\([\\`*_{}[\]()#+\-.!|])/g, "$1");
}

function cleanCell(text) {
  return unescape(text).replace(/\*\*/g, "").trim();
}

function splitRow(line) {
  const body = line.trim().replace(/^\|/, "").replace(/\|$/, "");
  return body.split("|");
}

// `## ` で節に分ける。見出し行の文字列と本文の行を返す。
function sections(markdown) {
  return String(markdown)
    .split(/\n(?=## )/)
    .map((chunk) => {
      const lines = chunk.split("\n");
      return { title: lines[0].replace(/^## /, "").trim(), lines: lines.slice(1) };
    });
}

// 節の中の表を、直前の見出し (太字の 1 行か ### 見出し) と組にして返す。
// 見出しは「直後の表」1 つだけに付く。見出しと表の間に別の見出しが来たら付け替わる。
function headedTables(lines) {
  const tables = [];
  let heading = null;
  let current = null;
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("|")) {
      if (!current) {
        current = { heading, rows: [] };
        tables.push(current);
        heading = null;
      }
      current.rows.push(splitRow(trimmed));
      continue;
    }
    current = null;
    const bold = trimmed.match(/^\*{2,3}(.+?)\*{2,3}$/);
    const sub = trimmed.match(/^#{3,}\s+(.+)$/);
    if (bold || sub) heading = (bold ?? sub)[1].trim();
  }
  // 1 行目がヘッダ、2 行目が区切り (--- ) の表だけを扱う。
  return tables
    .filter((t) => t.rows.length >= 2 && /^[\s:-]+$/.test(t.rows[1].join("")))
    .map((t) => ({
      heading: t.heading,
      header: t.rows[0].map(cleanCell),
      body: t.rows.slice(2),
    }));
}

function column(header, pattern) {
  return header.findIndex((name) => pattern.test(name));
}

// ID のセル。バッククォートを外し、空白を含むもの (N/A / Not supported) は ID ではない。
function idsInCell(cell) {
  return String(cell ?? "")
    .split(/<br\s*\/?>/)
    .map((part) => unescape(part).replace(/`/g, "").trim())
    .filter((part) => part && part !== "N/A" && !/\s/.test(part));
}

// Programmatic Access (新しい書式では "Call the model") の表。節の名前ではなく
// ヘッダに Endpoint と Model ID の列があることで見分ける。Endpoint support 表には Model ID 列が無い。
function parseIds(allSections) {
  for (const section of allSections) {
    for (const table of headedTables(section.lines)) {
      const endpointCol = column(table.header, /^endpoint$/i);
      const idCol = column(table.header, /^model id$/i);
      if (endpointCol < 0 || idCol < 0) continue;
      const row = table.body.find((r) => cleanCell(r[endpointCol]) === "bedrock-runtime");
      if (!row) continue;
      const inference = [];
      table.header.forEach((name, index) => {
        if (/inference id/i.test(name)) inference.push(...idsInCell(row[index]));
      });
      return { runtime: idsInCell(row[idCol])[0] ?? null, inference: [...new Set(inference)] };
    }
  }
  return { runtime: null, inference: [] };
}

// 推論 ID (接頭辞.プロバイダ.モデル) を、<br /> 区切りや文の中からも拾う (Kimi K3 は
// "us.moonshotai.kimi-k3 in the commercial AWS Regions, in.moonshotai.kimi-k3 in the India Regions")。
const INFERENCE_ID = /^[a-z][a-z-]*\.[a-z0-9-]+\.[a-z0-9.:-]+$/;
function inferenceIdsIn(cell) {
  const ids = String(cell ?? "")
    .split(/<br\s*\/?>|[\s,]+/)
    .map((part) => unescape(part).replace(/`/g, "").replace(/[.,;]+$/, "").trim())
    .filter((part) => INFERENCE_ID.test(part));
  return [...new Set(ids)];
}

// Programmatic Access の表を接続先ごとに読む: { "<endpoint>": { modelId, geo: [...], global: [...] } }。
// Not supported / N/A は空の配列。食い違いの注釈 (feature-model.mjs の inferenceMismatches) に使う。
function parseEndpoints(allSections) {
  for (const section of allSections) {
    for (const table of headedTables(section.lines)) {
      const endpointCol = column(table.header, /^endpoint$/i);
      const idCol = column(table.header, /^model id$/i);
      if (endpointCol < 0 || idCol < 0) continue;
      const geoCol = column(table.header, /geo inference id/i);
      const globalCol = column(table.header, /global inference id/i);
      const endpoints = {};
      for (const row of table.body) {
        const endpoint = cleanCell(row[endpointCol]);
        if (!/^bedrock-(runtime|mantle)$/.test(endpoint) || endpoints[endpoint]) continue;
        endpoints[endpoint] = {
          modelId: idsInCell(row[idCol])[0] ?? null,
          geo: geoCol >= 0 ? inferenceIdsIn(row[geoCol]) : [],
          global: globalCol >= 0 ? inferenceIdsIn(row[globalCol]) : [],
        };
      }
      if (Object.keys(endpoints).length > 0) return endpoints;
    }
  }
  return null;
}

// Regional Availability (新しい書式では Supported Regions) の表を接続先ごとに読む:
// { "<endpoint>": { inRegion: [region], geo: [region], global: [region] } }。値はアイコン (icon-yes) か "Supported"。
// 接続先の見出しが無い表は、Programmatic Access の接続先が 1 つだけならその接続先の表とする。
// 2 つあるときはどちらか決めず "shared" (docs が接続先を分けていない表) として持つ。
const REGION_CODE = /^([a-z]{2}(?:-gov)?-[a-z]+-\d+)\b/;
function supported(cell) {
  const text = String(cell ?? "");
  return /icon-yes\.png/.test(text) || /^\s*supported\s*$/i.test(cleanCell(text));
}

function parseRegions(allSections, endpoints) {
  const regions = {};
  for (const section of allSections) {
    if (!/^(regional availability|supported regions)$/i.test(section.title)) continue;
    for (const table of headedTables(section.lines)) {
      const regionCol = column(table.header, /region/i);
      const inRegionCol = column(table.header, /^in-region$/i);
      const geoCol = column(table.header, /geo/i);
      const globalCol = column(table.header, /global/i);
      if (regionCol !== 0 || inRegionCol < 0 || geoCol < 0 || globalCol < 0) continue;
      const named = /bedrock-(runtime|mantle)/.exec(table.heading ?? "");
      const only = Object.keys(endpoints ?? {});
      const endpoint = named ? named[0] : only.length === 1 ? only[0] : "shared";
      if (!endpoint || regions[endpoint]) continue;
      const lanes = { inRegion: [], geo: [], global: [] };
      for (const row of table.body) {
        const code = REGION_CODE.exec(cleanCell(row[regionCol]));
        if (!code) continue;
        if (supported(row[inRegionCol])) lanes.inRegion.push(code[1]);
        if (supported(row[geoCol])) lanes.geo.push(code[1]);
        if (supported(row[globalCol])) lanes.global.push(code[1]);
      }
      for (const key of Object.keys(lanes)) lanes[key] = [...new Set(lanes[key])].sort();
      regions[endpoint] = lanes;
    }
  }
  return Object.keys(regions).length > 0 ? regions : null;
}

const ITEM =
  /icon-(yes|no)\.png\)\s*(?:\[([^\]]+)\]\(([^)\s]*)\)|([^<]+))/;

// Supported / Not Supported の 2 セル。値はアイコンで決める (列の位置には頼らない)。
function parseFeatureTable(table, links) {
  const result = {};
  for (const row of table.body) {
    for (const cell of row) {
      for (const item of cell.split(/<br\s*\/?>/)) {
        const match = item.match(ITEM);
        if (!match) continue;
        const name = unescape(match[2] ?? match[4]).trim();
        if (!name) continue;
        result[name] = match[1] === "yes";
        if (match[3] && !(name in links)) links[name] = match[3];
      }
    }
  }
  return result;
}

function parsePromptCaching(table) {
  const row = table.body[0];
  if (!row) return null;
  const pick = (pattern) => {
    const index = column(table.header, pattern);
    return index < 0 ? null : cleanCell(row[index]);
  };
  // 列はヘッダ名で引く。"Prompt caching supported" のように名前が違う列は Explicit とみなさない。
  const explicit = pick(/explicit prompt caching supported/i);
  const result = {
    explicit: explicit === "Yes" ? true : explicit === "No" ? false : null,
    minTokens: pick(/min tokens/i),
    maxCheckpoints: pick(/max .*checkpoints/i),
    ttl: pick(/ttl/i),
    fields: pick(/fields/i),
  };
  // Implicit だけの表など、5 項目のどれも無い表は持たない。
  if (Object.values(result).every((v) => v === null)) return null;
  // 表の対象の接続先は見出しに書いてある。書いていなければ空 (どこにも補わない)。
  const heading = table.heading ?? "";
  result.endpoints = [
    ...(/bedrock-runtime/.test(heading) ? ["runtime"] : []),
    ...(/bedrock-mantle/.test(heading) ? ["mantle"] : []),
  ];
  return result;
}

function parseComputerUse(table) {
  const toolCol = column(table.header, /tool type/i);
  const betaCol = column(table.header, /beta header/i);
  if (toolCol < 0) return null;
  return table.body.map((row) => ({
    toolType: cleanCell(row[toolCol]),
    betaHeader: betaCol < 0 ? null : cleanCell(row[betaCol]),
  }));
}

// モデルカード 1 本を読む。機能節が無くても ID は返す (FEATURE-001 AC-003)。
export function parseModelCard(markdown) {
  if (typeof markdown !== "string" || markdown.trim() === "") return null;
  const all = sections(markdown);
  const endpoints = parseEndpoints(all);
  const parsed = {
    ids: parseIds(all),
    endpoints,
    regions: parseRegions(all, endpoints),
    runtime: null,
    mantle: null,
    promptCaching: null,
    computerUse: null,
    links: {},
  };
  const capabilities = all.find((s) => /^capabilities and features$/i.test(s.title));
  if (!capabilities) return parsed;

  for (const table of headedTables(capabilities.lines)) {
    const heading = table.heading ?? "";
    if (/features supported/i.test(heading)) {
      if (/bedrock-runtime/.test(heading) && !parsed.runtime)
        parsed.runtime = parseFeatureTable(table, parsed.links);
      else if (/bedrock-mantle/.test(heading) && !parsed.mantle)
        parsed.mantle = parseFeatureTable(table, parsed.links);
    } else if (/prompt caching/i.test(heading) && !parsed.promptCaching) {
      parsed.promptCaching = parsePromptCaching(table);
    } else if (/computer use/i.test(heading) && !parsed.computerUse) {
      parsed.computerUse = parseComputerUse(table);
    }
  }
  return parsed;
}

// --- 正規化 ---------------------------------------------------------------

function matchModels(candidates, modelIds) {
  const hits = new Set();
  for (const candidate of candidates) {
    for (const id of modelIds) {
      if (id === candidate || id.startsWith(`${candidate}:`)) hits.add(id);
    }
  }
  return [...hits].sort();
}

function stripPrefix(profileId) {
  const dot = profileId.indexOf(".");
  return dot < 0 ? profileId : profileId.slice(dot + 1);
}

// (1) 対応表 (2) Model ID 列 (3) inference ID から接頭辞を外したもの。最初に当たった段で確定する。
// 対応表の値 null は「該当なし確認済み」で空配列を返す。区別は呼び出し側が map を見て行う。
export function resolveModelIds(card, parsed, { models, map }) {
  const modelIds = Object.keys(models ?? {});
  const stages = [];
  if (map && Object.hasOwn(map, card)) {
    if (map[card] === null) return [];
    stages.push([].concat(map[card]));
  }
  if (parsed?.ids?.runtime) stages.push([parsed.ids.runtime]);
  if (parsed?.ids?.inference?.length) stages.push([...new Set(parsed.ids.inference.map(stripPrefix))]);
  // bedrock-runtime の行が無いカード (GPT-5.4 / 5.5) は bedrock-mantle の行のモデル ID で引く。
  // models.json (bedrock-runtime の一覧) にある ID のときだけ当たる。
  if (!parsed?.ids?.runtime && parsed?.endpoints?.["bedrock-mantle"]?.modelId) stages.push([parsed.endpoints["bedrock-mantle"].modelId]);
  for (const candidates of stages) {
    const hits = matchModels(candidates, modelIds);
    if (hits.length > 0) return hits;
  }
  return [];
}

function slug(text) {
  return String(text)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// 対応表に無い名前は推測で寄せない (FEATURE-001 AC-004)。
export function featureKey(docsName, names) {
  return names?.names?.[docsName] ?? `unknown:${slug(docsName)}`;
}

// docs のリンク先を userguide からの相対 URL に揃える。カード内アンカーはカード名を前に付ける。
function docsHref(href, card) {
  if (!href) return null;
  if (href.startsWith("#")) return `${card}${href}`;
  return href.replace(/^([^/#:]+)\.md(#|$)/, "$1.html$2");
}

function withoutGeneratedAt(value) {
  if (!value || typeof value !== "object") return value;
  const { generatedAt, ...rest } = value;
  return rest;
}

// generatedAt を除いて同じ内容か。定期実行で空の差分を作らないため (FEATURE-001 AC-007)。
export function sameContent(a, b) {
  return JSON.stringify(withoutGeneratedAt(a)) === JSON.stringify(withoutGeneratedAt(b));
}

// 既定で表に出す列。"all" は features の全キー (unknown も含む) を同じ順で。配列ならそのまま。
export function defaultColumnsOf(spec, keys) {
  if (spec === "all") return [...keys];
  return Array.isArray(spec) ? [...spec] : [];
}

const EXPLICIT_KEY = "explicitPromptCaching";

const STATE_MARK = { true: "+", false: "-" };

function diffTable(scope, before = {}, after = {}, labelOf) {
  const keys = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})])];
  const changes = [];
  for (const key of keys) {
    const p = before?.[key];
    const n = after?.[key];
    if (p === n) continue;
    // + は対応になった、- は対応でなくなった、~ は非対応と記載なしの間の移動。
    const mark = n === true ? STATE_MARK.true : p === true ? STATE_MARK.false : "~";
    changes.push(`${mark}${scope}:${labelOf(key)}`);
  }
  return changes;
}

function buildSummary({ previous, features, failedList, filled, conflicts }) {
  const labelOf = (key) =>
    features.features[key]?.label ?? previous?.features?.[key]?.label ?? key;
  const before = previous?.byModel ?? {};
  const after = features.byModel;
  const lines = [];
  for (const id of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
    const p = before[id];
    const n = after[id];
    if (!n) {
      lines.push(`- ${id}: (removed)`);
      continue;
    }
    const changes = [
      ...diffTable("runtime", p?.runtime, n.runtime, labelOf),
      ...diffTable("mantle", p?.mantle, n.mantle, labelOf),
    ];
    if (p && JSON.stringify(p.promptCaching) !== JSON.stringify(n.promptCaching))
      changes.push("~promptCaching");
    if (p && JSON.stringify(p.computerUse) !== JSON.stringify(n.computerUse))
      changes.push("~computerUse");
    if (p && p.card !== n.card) changes.push(`~card:${n.card}`);
    if (!p) changes.unshift("(new)");
    if (changes.length > 0) lines.push(`- ${id}: ${changes.join(", ")}`);
  }

  const out = ["## Feature changes", ""];
  out.push(...(lines.length > 0 ? lines : ["No changes."]));
  out.push(
    "",
    `cards: ${features.cards} / with features: ${features.cardsWithFeatures} / failed: ${features.failedCards}`,
    "",
    "### Unknown features",
    "",
    ...(features.unknownFeatures.length > 0
      ? features.unknownFeatures.map((name) => `- ${name}`)
      : ["None."]),
    "",
    "### Unmatched cards",
    "",
    ...(features.unmatchedCards.length > 0
      ? features.unmatchedCards.map(
          (u) => `- ${u.card} (${u.reason}${u.modelId ? `: ${u.modelId}` : ""})`,
        )
      : ["None."]),
  );
  const label = features.features[EXPLICIT_KEY]?.label ?? EXPLICIT_KEY;
  out.push(
    "",
    "### Filled from Prompt caching table",
    "",
    ...(filled.length > 0 ? filled.map((f) => `- ${f.card}: ${f.scope}:${label} = ${f.value}`) : ["None."]),
    "",
    "### Conflicts",
    "",
    ...(conflicts.length > 0
      ? conflicts.map(
          (c) => `- ${c.card}: ${c.scope}:${label} (list: ${c.list}, prompt caching table: ${c.table})`,
        )
      : ["None."]),
  );
  if (failedList.length > 0) out.push("", "### Failed cards", "", ...failedList.map((c) => `- ${c}`));
  return `${out.join("\n")}\n`;
}

// cards: { [card]: markdown | null }。null は取得失敗で、例外にせず failedCards に数える。
export function normalizeFeatures({ cards, models, names, map = {}, previous = null, generatedAt }) {
  const labels = names?.labels ?? {};
  const byModel = {};
  const unmatchedCards = [];
  const unknown = new Set();
  const seen = new Map(); // featureKey -> { label, docs }
  const failedList = [];
  const filled = [];
  const conflicts = [];
  let cardsWithFeatures = 0;

  const toKeys = (table, card, links) => {
    if (!table) return null;
    const out = {};
    for (const [name, value] of Object.entries(table)) {
      const key = featureKey(name, names);
      if (key.startsWith("unknown:")) unknown.add(name);
      out[key] = value;
      const href = docsHref(links[name], card);
      const known = seen.get(key);
      // docs のリンク先はカード内アンカーより独立したページを優先する。
      const inCard = (value) => !value || value.startsWith("model-card-");
      if (!known) seen.set(key, { label: labels[key] ?? name, docs: href });
      else if (inCard(known.docs) && !inCard(href)) known.docs = href;
    }
    return out;
  };

  const cardNames = Object.keys(cards ?? {}).sort();
  for (const card of cardNames) {
    const parsed = parseModelCard(cards[card]);
    if (!parsed) {
      failedList.push(card);
      continue;
    }
    if (!parsed.runtime && !parsed.mantle) continue;
    cardsWithFeatures += 1;

    // 機能名の正規化は ID が引けないカードでも行う。unknown の検出を ID の解決に依存させない。
    const entry = {
      card,
      runtime: toKeys(parsed.runtime, card, parsed.links),
      mantle: toKeys(parsed.mantle, card, parsed.links),
      promptCaching: parsed.promptCaching,
      computerUse: parsed.computerUse,
      ...(parsed.endpoints ? { endpoints: parsed.endpoints } : {}),
      ...(parsed.regions ? { regions: parsed.regions } : {}),
    };

    // 機能一覧に Explicit Prompt Caching が無いカードは、Prompt caching の表の値で補う。
    // 補うのは見出しにある接続先だけ。一覧に値があれば一覧を優先し、食い違いは上書きせず残す。
    const caching = parsed.promptCaching;
    if (caching && typeof caching.explicit === "boolean") {
      for (const scope of caching.endpoints ?? []) {
        const table = entry[scope];
        if (!table) continue;
        if (!Object.hasOwn(table, EXPLICIT_KEY)) {
          table[EXPLICIT_KEY] = caching.explicit;
          filled.push({ card, scope, value: caching.explicit });
          if (!seen.has(EXPLICIT_KEY))
            seen.set(EXPLICIT_KEY, { label: labels[EXPLICIT_KEY] ?? "Explicit Prompt Caching", docs: "prompt-caching.html" });
        } else if (table[EXPLICIT_KEY] !== caching.explicit) {
          conflicts.push({ card, scope, list: table[EXPLICIT_KEY], table: caching.explicit });
        }
      }
    }

    const ids = resolveModelIds(card, parsed, { models, map });
    if (ids.length === 0) {
      const confirmedNone = Object.hasOwn(map ?? {}, card) && map[card] === null;
      if (!confirmedNone) {
        const tried =
          parsed.ids.runtime ??
          (parsed.ids.inference[0] ? stripPrefix(parsed.ids.inference[0]) : null);
        // bedrock-runtime の行が無い (mantle 専用) カードは引く手がかりが無い。
        unmatchedCards.push({ card, modelId: tried, reason: tried ? "not-found" : "no-runtime-id" });
      }
      continue;
    }

    for (const id of ids) {
      if (byModel[id]) unmatchedCards.push({ card, modelId: id, reason: "duplicate" });
      else byModel[id] = entry;
    }
  }

  // 列の順: 対応表の labels の順 → unknown を表示名の昇順。
  const knownKeys = Object.keys(labels).filter((key) => seen.has(key));
  const unknownKeys = [...seen.keys()]
    .filter((key) => !Object.hasOwn(labels, key))
    .sort((a, b) => seen.get(a).label.localeCompare(seen.get(b).label));
  const order = [...knownKeys, ...unknownKeys];
  const features = Object.fromEntries(order.map((key) => [key, seen.get(key)]));
  const rank = new Map(order.map((key, index) => [key, index]));
  const sortTable = (table) =>
    table
      ? Object.fromEntries(Object.entries(table).sort(([a], [b]) => rank.get(a) - rank.get(b)))
      : null;

  const sortedByModel = {};
  for (const id of Object.keys(byModel).sort()) {
    const entry = byModel[id];
    sortedByModel[id] = { ...entry, runtime: sortTable(entry.runtime), mantle: sortTable(entry.mantle) };
  }

  const result = {
    generatedAt,
    source: TOC_URL,
    cards: cardNames.length,
    cardsWithFeatures,
    failedCards: failedList.length,
    features,
    defaultColumns: defaultColumnsOf(names?.defaultColumns, order),
    byModel: sortedByModel,
    unmatchedCards: unmatchedCards.sort(
      (a, b) => a.card.localeCompare(b.card) || String(a.modelId).localeCompare(String(b.modelId)),
    ),
    unknownFeatures: [...unknown].sort(),
  };
  if (previous?.generatedAt && sameContent(previous, result)) result.generatedAt = previous.generatedAt;

  // 書式が変わってパースが空振りしたときに全データを消さない (FEATURE-001 AC-008)。
  const guardTripped =
    Number(previous?.cardsWithFeatures) > 0 && cardsWithFeatures < previous.cardsWithFeatures / 2;

  return { features: result, summary: buildSummary({ previous, features: result, failedList, filled, conflicts }), guardTripped };
}
