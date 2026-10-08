// 行の展開と詳細パネル (DETAIL-001 v8)。
// パネルは 共通の見出し行 → レーンのタブ → タブごとの 図 / 指定する ID / 推論先 / 価格。
// データの組み立ては detail-model.mjs、図は flow-figure.js が持ち、ここは DOM とイベントだけ。
import {
  LANE_GEO,
  LANE_GLOBAL,
  LANE_IN_REGION,
  LANE_ORDER,
  buildDestinationLines,
  buildDetail,
  buildMantlePriceRows,
  buildPriceRows,
  globalExtrasMissing,
  resolveLane,
} from "./detail-model.mjs";
import { formatPrice } from "./bedrock-view-model.mjs";
import { buildFlowFigure } from "./flow-figure.js";
import { createCopyable } from "./copy.js";
import { geoAreaLabel } from "./geo-labels.js";
import { t, getLang, LANG_CHANGED_EVENT } from "./i18n.js";
import { regionName } from "./region-names.js";
import { DOCS_BASE, buildFeatureRows, inferenceMismatches, modelDocsUrl } from "./feature-model.mjs";
import { featureLegend, markNo, markYes, mismatchText } from "./table-view.js";

// 出典: bedrock-mantle の対応モデル表 (MANTLE-001 AC-006)。
const MANTLE_AVAILABILITY_DOC =
  "https://docs.aws.amazon.com/bedrock/latest/userguide/models-endpoint-availability.html";

// 選んだレーンはセッション内のメモリにだけ持つ。URL にも localStorage にも保存しない (AC-020)。
let rememberedLane = null;

export function resetRememberedLane() {
  rememberedLane = null;
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// aria-controls / id に使える形にする。モデル ID の "." や ":" をそのまま id にしない。
export function panelId(modelId) {
  return `detail-${String(modelId).replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

const laneId = (modelId, lane) => `${panelId(modelId)}-${lane}`;
const tabId = (modelId, lane) => `${panelId(modelId)}-tab-${lane}`;

// --- AC-010 共通の見出し行 -------------------------------------------------

function headItem(labelKey, body) {
  const item = el("div", "head-item");
  item.dataset.item = labelKey;
  item.appendChild(el("span", "k", t(labelKey)));
  item.appendChild(body);
  return item;
}

function mantleItem(detail) {
  const body = el("div", "head-mantle");
  body.appendChild(el("span", "endpoint-value mono", detail.mantleEndpoint));
  body.appendChild(el("span", "detail-endpoint-apis", t("mantle.mantleApis")));

  // AC-005 項目 3: Mantle で指定するモデル ID。✓ の組み合わせのときだけ ID を出す。
  const idLine = el("div", "detail-mantle-model-id");
  if (detail.mantle?.available === true) {
    idLine.appendChild(el("span", "detail-mantle-model-id-label", t("mantle.mantleModelId")));
    idLine.appendChild(
      createCopyable(detail.mantle.mantleModelId, { labelKey: "copy.mantleModelId" }),
    );
  } else if (detail.mantle && !detail.mantle.modelSupported) {
    idLine.appendChild(el("span", "detail-mantle-none", t("mantle.mantleUnsupportedModel")));
  } else if (!detail.mantle) {
    idLine.appendChild(el("span", "detail-mantle-none", t("mantle.mantleUnknownModel")));
  } else {
    idLine.appendChild(el("span", "detail-mantle-none", t("mantle.notAvailable")));
  }
  body.appendChild(idLine);

  // AC-004: Mantle では cross-region inference が使えない。
  body.appendChild(el("p", "detail-mantle-no-cris", t("mantle.noCris")));

  // AC-006: 転記元への脚注リンク。
  const footnote = el("p", "detail-mantle-source");
  const link = el("a", "doc-link", t("mantle.docs"));
  link.href = MANTLE_AVAILABILITY_DOC;
  link.target = "_blank";
  link.rel = "noreferrer";
  footnote.appendChild(link);
  body.appendChild(footnote);
  return body;
}

function headGrid(detail) {
  const grid = el("div", "head-grid");
  const ids = el("div", "connection-ids");
  ids.appendChild(createCopyable(detail.modelId, { labelKey: "copy.modelId" }));
  for (const profile of detail.summaries.geo.profiles ?? []) {
    ids.appendChild(idSection(profile.profileId, { profile: true, label: `Geo · ${geoAreaLabel(profile.prefix)}` }));
  }
  if (detail.summaries.global.available) {
    ids.appendChild(idSection(detail.summaries.global.id, { profile: true, label: "Global" }));
  }
  grid.appendChild(headItem("detail.modelId", ids));
  const runtime = el("div", "head-runtime");
  runtime.appendChild(el("span", "endpoint-value detail-endpoint-value mono", detail.endpoint));
  // MANTLE-001 v2 AC-005 項目 2: FQDN と、そこで呼べる API。
  runtime.appendChild(el("span", "detail-endpoint-apis", t("mantle.runtimeApis")));
  grid.appendChild(headItem("detail.runtimeEndpoint", runtime));
  // 起点に mantle が無いときはこの項目ごと出さない (AC-010)。
  if (detail.mantleEndpoint) grid.appendChild(headItem("detail.mantleEndpoint", mantleItem(detail)));
  return grid;
}

// --- AC-014 レーンのタブと要約 ---------------------------------------------

function laneTitle(lane, summary) {
  if (lane === LANE_IN_REGION) return t("detail.laneInRegion");
  if (lane === LANE_GLOBAL) return t("detail.laneGlobal");
  const areas = [...new Set(summary.prefixes ?? [])].map(geoAreaLabel);
  if (areas.length === 0) return t("detail.laneGeoPlain");
  return t("detail.laneGeo", { areas: areas.join(t("detail.laneJoin")) });
}

function laneSummaryText(lane, summary) {
  if (!summary.available) return { text: t("detail.sumUnavailable"), warn: false };
  if (lane === LANE_IN_REGION) return { text: t("detail.sumInRegion"), warn: false };
  if (lane === LANE_GLOBAL) return { text: t("detail.sumGlobal"), warn: true };
  // 起点の country が分からないときは件数を切り分けず「推論先 K」(AC-014)。
  if (!summary.countryKnown) {
    return { text: t("detail.sumGeoUnknown", { count: summary.totalCount }), warn: false };
  }
  return {
    text: t("detail.sumGeo", { domestic: summary.domesticCount, foreign: summary.foreignCount }),
    // 国外が 1 件でもあれば warn 色 (AC-014)。
    warn: summary.foreignCount >= 1,
  };
}

// --- AC-017 各レーンのパネルの中身 -----------------------------------------

function idSection(id, { profile, label }) {
  const section = el("section", "detail-id");
  section.appendChild(el("h4", null, label));
  section.appendChild(
    createCopyable(id, { labelKey: profile ? "copy.profileId" : "copy.modelId" }),
  );
  return section;
}

// AC-019: 地名だけを出す。リージョンコードは出さない。
function destinationSection(lane, { destinations, region, regionNotes, available }) {
  const section = el("section", "detail-dest");
  section.appendChild(el("h4", null, t("detail.destinations")));
  const lang = getLang();
  const { lines, note } = buildDestinationLines(lane, {
    destinations,
    region,
    regionNotes,
    lang,
    available,
  });
  const separator = t("detail.destSeparator");
  const list = el("ul", "dest-list");
  for (const line of lines) {
    const item = el("li", `dest-line dest-${line.kind}`);
    item.dataset.kind = line.kind;
    if (line.kind === "unavailable") {
      // AC-016: 使えないレーン。タブの要約と同じ語 (AC-014) を 1 行だけ出す。
      item.appendChild(el("span", "state-none", t("detail.sumUnavailable")));
    } else if (line.kind === "notOffered") {
      item.appendChild(el("span", "state-none", t("detail.destNotOffered", { place: line.place })));
    } else if (line.kind === "globalScope") {
      item.appendChild(el("span", "k", t("detail.destScopeLabel")));
      item.appendChild(el("span", "v-warn", t("detail.destGlobalScope")));
    } else {
      const labelKey =
        line.kind === "domestic"
          ? "detail.destDomestic"
          : line.kind === "foreign"
            ? "detail.destForeign"
            : "detail.destAny";
      if (line.kind === "inRegion") {
        item.appendChild(el("span", "v", line.places.join(separator)));
      } else {
        item.appendChild(el("span", "k", t(labelKey, { count: line.count })));
        item.appendChild(
          el("span", line.warn ? "v-warn" : "v", line.places.join(separator)),
        );
      }
    }
    list.appendChild(item);
  }
  section.appendChild(list);

  if (note === "geo") {
    section.appendChild(
      el(
        "p",
        "note-muted dest-note",
        t("detail.destGeoNote", { place: regionName(region, lang, regionNotes) }),
      ),
    );
  } else if (note === "global") {
    section.appendChild(el("p", "note-muted dest-note", t("detail.destGlobalNote")));
  }
  return section;
}

// 価格の行を表にする。Runtime と Mantle で同じ形を使う。
function priceTable(rows) {
  const wrap = el("div", "price-wrap");
  const table = el("table", "detail-price-table price-table");
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const key of ["price.kindColumn", "price.input", "price.output"]) {
    const th = el("th", null, t(key));
    th.setAttribute("scope", "col");
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);

  const tbody = document.createElement("tbody");
  for (const row of rows) {
    const tr = el("tr", `detail-price-row detail-price-${row.kind}`);
    tr.dataset.kind = row.kind;
    let label = row.kind === "metered" ? row.label : t(`price.kind.${row.kind}`);
    if (row.maxInputTokens) label += ` · ${t("price.shortContext", { count: row.maxInputTokens.toLocaleString("en-US") })}`;
    if (row.minInputTokens) label += ` · ${t("price.longContext", { count: row.minInputTokens.toLocaleString("en-US") })}`;
    else if (row.longContext) label += ` · ${t("price.longContextTier")}`;
    tr.appendChild(el("td", "detail-price-kind", label));
    for (const value of [row.input, row.output]) {
      const text = formatPrice(value);
      // 出力側の単価が無い種別は「—」(AC-013)。
      tr.appendChild(el("td", "detail-price-value v num mono", text == null ? "—" : `$${text}${row.unit ? ` / ${t(`price.units.${row.unit}`)}` : ""}`));
    }
    tbody.appendChild(tr);
  }
  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}

// AC-013: レーンごとの価格。bedrock-mantle の単価は Runtime と別に決まるので、別の表にする。
// D-018: 価格未収録のときに docs のモデルカード (無ければ料金ページ) へ案内するリンク。
function docsLink(modelId, features) {
  const wrap = el("p", "detail-price-docs");
  const link = el("a", "doc-link price-docs-link", t("price.docsLinkDetail"));
  link.href = modelDocsUrl(features, modelId);
  link.target = "_blank";
  link.rel = "noreferrer";
  wrap.appendChild(link);
  return wrap;
}

function priceSection(modelId, { prices, features, region, regionNotes, lane, available, summaries }) {
  const section = el("section", "detail-price");
  section.appendChild(el("h4", null, t("price.heading")));
  const rows = buildPriceRows(modelId, { prices, region, lane });
  const mantleRows = buildMantlePriceRows(modelId, { prices, region });

  // AC-016 (2026-10-08 変更): 呼べないレーンには単価の表を出さない。東京の標準の単価は Geo で呼んだときの価格でも
  // あるので、In-Region の不可のタブに並べると「提供なしなのに価格がある」と読める。同じ標準の単価を使えるレーンを案内する。
  if (!available && (rows.length > 0 || mantleRows.length > 0)) {
    const alternatives = lane === LANE_GLOBAL ? [] : [LANE_IN_REGION, LANE_GEO].filter((other) => other !== lane && summaries?.[other]?.available);
    const text = alternatives.length > 0
      ? t("price.unavailableLaneSeeOther", { lane: alternatives.map((other) => laneTitle(other, summaries[other])).join(" / ") })
      : t("price.unavailableLaneHidden");
    section.appendChild(el("p", "detail-price-unavailable note-muted", text));
    return section;
  }

  if (rows.length === 0 && mantleRows.length === 0) {
    section.appendChild(el("p", "detail-no-price", t("price.none")));
    section.appendChild(docsLink(modelId, features));
    return section;
  }

  const runtime = el("div", "detail-price-runtime");
  // Mantle の表があるときだけ、どちらの接続先の単価かを見出しで分ける。
  if (mantleRows.length > 0) runtime.appendChild(el("h5", "detail-price-endpoint mono", t("price.runtimeHeading")));
  if (rows.length > 0) {
    runtime.appendChild(priceTable(rows));
  } else {
    runtime.appendChild(el("p", "detail-no-price", t("price.none")));
    runtime.appendChild(docsLink(modelId, features));
  }
  // D-018: Price List に無く、AWS Marketplace の offer の単価を出しているときは出典を書く。
  const source = prices?.byModel?.[modelId]?.[region]?.source;
  if (rows.length > 0 && source?.type === "marketplace") {
    runtime.appendChild(el("p", "note-muted detail-price-source", t("price.sourceMarketplaceDetail", { offerId: source.offerId ?? "—" })));
  }
  section.appendChild(runtime);

  if (mantleRows.length > 0) {
    const mantle = el("div", "detail-price-mantle");
    mantle.appendChild(el("h5", "detail-price-endpoint mono", t("price.mantleHeading")));
    mantle.appendChild(priceTable(mantleRows));
    mantle.appendChild(el("p", "note-muted detail-price-mantle-note", t("price.mantleNote")));
    section.appendChild(mantle);
  }

  const notes = [t("price.unit", { place: regionName(region, getLang(), regionNotes) })];
  if (lane === LANE_GEO) notes.push(t("price.geoSame"));
  if (lane === LANE_GLOBAL && globalExtrasMissing(modelId, { prices, region })) {
    // Mantle の表にはバッチ・キャッシュが並ぶことがあるので、Runtime に限った文言にする。
    notes.push(t(mantleRows.length > 0 ? "price.globalMissingRuntime" : "price.globalMissing"));
  }
  section.appendChild(el("p", "detail-price-unit price-unit", notes.join(" ")));
  return section;
}

// FEATURE-001: 機能の節。機能名・Prompt caching / Computer use の値は docs の英語のまま出す (訳さない)。
const CACHING_FIELDS = ["explicit", "minTokens", "maxCheckpoints", "ttl", "fields"];

function smallTable(className, headers) {
  const table = el("table", className);
  const thead = document.createElement("thead");
  const headRow = document.createElement("tr");
  for (const text of headers) {
    const th = el("th", null, text);
    th.setAttribute("scope", "col");
    headRow.appendChild(th);
  }
  thead.appendChild(headRow);
  const tbody = document.createElement("tbody");
  table.append(thead, tbody);
  return { table, tbody };
}

function wrapped(table) {
  const wrap = el("div", "price-wrap feature-wrap");
  wrap.appendChild(table);
  return wrap;
}

function cachingValue(field, value) {
  if (value == null || value === "") return "—";
  // docs の表では Yes / No。features.json では true / false に直してあるので戻す。
  if (field === "explicit") return value === true ? "Yes" : value === false ? "No" : String(value);
  return String(value);
}

function featureSection(modelId, { features }) {
  // byModel にモデルが無い・features.json が空でも節は出し、記載なしの文言にする (FEATURE-001 AC-014)。
  const section = el("section", "detail-feature");
  section.appendChild(el("h4", null, t("feature.heading")));
  const entry = features?.byModel?.[modelId];
  const rows = buildFeatureRows(features, modelId);

  if (rows.length > 0) {
    const { table, tbody } = smallTable("detail-feature-table", [
      t("feature.nameColumn"),
      "bedrock-runtime",
      "bedrock-mantle",
    ]);
    for (const row of rows) {
      const tr = el("tr", "detail-feature-row");
      tr.dataset.key = row.key;
      tr.appendChild(el("td", "detail-feature-name", row.label));
      for (const state of [row.runtime, row.mantle]) {
        // 表の機能列と同じ印 (✓ 対応 / ✕ 非対応 のピル)。記載なしは「—」。
        const td = el("td", `detail-feature-mark feature-${state}`);
        td.appendChild(
          state === "yes"
            ? markYes("feature.mark.yes")
            : state === "no"
              ? markNo("feature.mark.no")
              : document.createTextNode("—"),
        );
        td.setAttribute("aria-label", t(`feature.state.${state}`));
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    }
    section.appendChild(wrapped(table));
    // 表と同じ凡例を 1 行 (✓ / ✕ / — の意味)。
    const legend = el("p", "detail-feature-legend");
    legend.appendChild(featureLegend());
    section.appendChild(legend);
  }

  if (entry?.promptCaching) {
    section.appendChild(el("h5", "detail-feature-sub", "Prompt caching"));
    const { table, tbody } = smallTable("detail-caching-table", [t("feature.itemColumn"), t("feature.valueColumn")]);
    for (const field of CACHING_FIELDS) {
      const tr = el("tr");
      tr.dataset.field = field;
      const th = el("th", null, t(`feature.caching.${field}`));
      th.setAttribute("scope", "row");
      tr.append(th, el("td", "mono", cachingValue(field, entry.promptCaching[field])));
      tbody.appendChild(tr);
    }
    section.appendChild(wrapped(table));
  }

  if (Array.isArray(entry?.computerUse) && entry.computerUse.length > 0) {
    section.appendChild(el("h5", "detail-feature-sub", "Computer use"));
    const { table, tbody } = smallTable("detail-computer-use-table", ["Tool type", "Beta header"]);
    for (const tool of entry.computerUse) {
      const tr = el("tr");
      tr.append(el("td", "mono", tool.toolType ?? "—"), el("td", "mono", tool.betaHeader ?? "—"));
      tbody.appendChild(tr);
    }
    section.appendChild(wrapped(table));
  }

  if (rows.length === 0 && !entry?.promptCaching && !entry?.computerUse?.length) {
    section.appendChild(el("p", "detail-no-feature", t("feature.none")));
  }

  if (entry?.card) {
    const link = el("a", "doc-link detail-feature-card", t("feature.cardLink"));
    link.href = `${DOCS_BASE}${entry.card}`;
    link.target = "_blank";
    link.rel = "noreferrer";
    const line = el("p", "detail-feature-source");
    line.appendChild(link);
    section.appendChild(line);
  }
  return section;
}

/** 図 + 指定する ID + 推論先 の 3 点セット (AC-017 / AC-018 の 1 ブロック)。 */
function laneBlock(lane, { modelId, detail, regionNotes, profile, available, heading }) {
  const block = el("div", "lane-block");
  if (profile) block.dataset.profileId = profile.profileId;
  if (heading) block.appendChild(el("h4", "lane-block-head", heading));
  block.appendChild(
    buildFlowFigure(lane, {
      available,
      destinations: profile?.destinations ?? (available ? [detail.region] : []),
      region: detail.region,
      regionNotes,
      prefix: profile?.prefix ?? null,
    }),
  );
  block.appendChild(
    destinationSection(lane, {
      destinations: profile?.destinations ?? [],
      region: detail.region,
      regionNotes,
      available,
    }),
  );
  return block;
}

// docs のモデルカードと ListInferenceProfiles の推論 ID の食い違い。表の判定は API に従い、ここで注釈する。
function mismatchNote(modelId, lane, { features, profiles }) {
  const mismatch = inferenceMismatches(features, profiles, modelId)[lane === LANE_GEO ? "geo" : "global"];
  if (!mismatch) return null;
  const note = el("p", "note-warn inference-mismatch", `${t("mismatch.heading")} ${mismatchText(mismatch)} `);
  const link = el("a", "doc-link", t("mismatch.docs"));
  link.href = modelDocsUrl(features, modelId);
  link.target = "_blank";
  link.rel = "noreferrer";
  note.appendChild(link);
  return note;
}

function lanePanel(lane, { modelId, detail, regionNotes, prices, features, profiles }) {
  const summary = detail.summaries[lane];
  const panel = el("div", "lane-panel");
  panel.id = laneId(modelId, lane);
  panel.setAttribute("role", "tabpanel");
  panel.setAttribute("aria-labelledby", tabId(modelId, lane));
  panel.tabIndex = 0;
  panel.dataset.lane = lane;

  // AC-021: どのレーンも使えないときは無言の空パネルを出さない。
  // 開いた状態になるのは In-Region のパネルなので、説明文はそこにだけ置く。
  if (!detail.anyLane && lane === LANE_IN_REGION) {
    panel.appendChild(el("p", "detail-no-lane", t("detail.noLane")));
  }

  if (lane === LANE_GEO && summary.available) {
    // AC-018: プロファイルごとに 図 + ID + 推論先 を 1 ブロックとして縦に積む。
    for (const profile of summary.profiles) {
      panel.appendChild(
        laneBlock(lane, {
          modelId,
          detail,
          regionNotes,
          profile,
          available: true,
          heading: geoAreaLabel(profile.prefix),
        }),
      );
    }
  } else if (lane === LANE_GEO) {
    panel.appendChild(
      laneBlock(lane, { modelId, detail, regionNotes, profile: null, available: false }),
    );
  } else if (lane === LANE_GLOBAL) {
    panel.appendChild(
      laneBlock(lane, {
        modelId,
        detail,
        regionNotes,
        profile: summary.available ? { profileId: summary.id, prefix: "global", destinations: [] } : null,
        available: summary.available,
      }),
    );
  } else {
    panel.appendChild(
      laneBlock(lane, { modelId, detail, regionNotes, profile: null, available: summary.available }),
    );
  }

  if (lane === LANE_GEO || lane === LANE_GLOBAL) {
    const note = mismatchNote(modelId, lane, { features, profiles });
    if (note) panel.appendChild(note);
  }

  // AC-018: 価格の節はブロックごとに繰り返さず、パネルの末尾に 1 つだけ。
  panel.appendChild(
    priceSection(modelId, {
      prices,
      features,
      region: detail.region,
      regionNotes,
      lane,
      available: summary.available,
      summaries: detail.summaries,
    }),
  );
  return panel;
}

function laneTabs(modelId, detail, { onSelect }) {
  const tablist = el("div", "lane-tabs");
  tablist.setAttribute("role", "tablist");
  tablist.setAttribute("aria-label", t("detail.laneTabs"));
  const buttons = [];

  for (const lane of LANE_ORDER) {
    const summary = detail.summaries[lane];
    const button = el("button", "lane-tab");
    button.type = "button";
    button.id = tabId(modelId, lane);
    button.dataset.lane = lane;
    button.setAttribute("role", "tab");
    button.setAttribute("aria-controls", laneId(modelId, lane));
    // AC-016: 使えないレーンは淡色にするが disabled にはしない。
    if (!summary.available) button.classList.add("is-dim");
    button.appendChild(el("span", "lane-title", laneTitle(lane, summary)));
    const { text, warn } = laneSummaryText(lane, summary);
    const sum = el("span", "lane-sum", text);
    if (warn) sum.classList.add("is-warn");
    button.appendChild(sum);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      onSelect(lane);
    });
    buttons.push(button);
    tablist.appendChild(button);
  }

  // roving tabindex + 矢印キー。
  tablist.addEventListener("keydown", (event) => {
    const index = buttons.indexOf(document.activeElement);
    if (index < 0) return;
    let next = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % buttons.length;
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      next = (index - 1 + buttons.length) % buttons.length;
    }
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = buttons.length - 1;
    if (next == null) return;
    event.preventDefault();
    buttons[next].focus();
    onSelect(buttons[next].dataset.lane);
  });

  return { tablist, buttons };
}

/**
 * 行の展開を表に取り付ける。
 * 展開状態はモデル ID で持つので、起点リージョンを切り替えても対象モデルが
 * 表に残っている限り開いたままになる (AC-001)。
 */
export function mountDetailView({
  view,
  models,
  profiles,
  regionNotes,
  mantle = null,
  prices = {},
  features = {},
} = {}) {
  const open = new Set();

  function buildPanelRow(modelId, columnCount) {
    const detail = buildDetail(modelId, {
      models,
      profiles,
      regionNotes,
      mantle,
      prices,
      region: view.getRegion(),
      lang: getLang(),
    });
    const tr = el("tr", "detail-row");
    tr.id = panelId(modelId);
    tr.dataset.modelId = modelId;
    const td = document.createElement("td");
    td.colSpan = columnCount;
    const panel = el("div", "detail-panel");

    let selected = resolveLane(rememberedLane, detail.summaries);
    const panels = new Map();

    function select(lane) {
      selected = lane;
      // AC-020: セッション内のメモリだけ。URL にも localStorage にも書かない。
      rememberedLane = lane;
      for (const [key, element] of panels) element.hidden = key !== lane;
      for (const button of tabs.buttons) {
        const on = button.dataset.lane === lane;
        button.setAttribute("aria-selected", String(on));
        button.tabIndex = on ? 0 : -1;
      }
    }

    panel.appendChild(headGrid(detail));
    const notes = view.getModel().rows.find(row => row.modelId === modelId)?.notes ?? [];
    const localizedNotes = notes.filter(entry => entry.note?.[getLang()]?.trim());
    if (localizedNotes.length) {
      const section = el("section", "detail-notes");
      section.appendChild(el("h4", null, t("table.notes")));
      const list = el("ul");
      for (const entry of localizedNotes) {
        const item = el("li", "detail-note", entry.note[getLang()]);
        if (entry.id !== modelId) item.appendChild(el("code", "detail-note-profile", entry.id));
        list.appendChild(item);
      }
      section.appendChild(list);
      panel.appendChild(section);
    }
    const tabs = laneTabs(modelId, detail, { onSelect: select });
    panel.appendChild(tabs.tablist);
    for (const lane of LANE_ORDER) {
      const element = lanePanel(lane, { modelId, detail, regionNotes, prices, features, profiles });
      panels.set(lane, element);
      panel.appendChild(element);
    }
    // DETAIL-001 AC-023 / FEATURE-001 AC-013: 機能はレーンに依らないので、
    // レーンのパネル群の下に 1 回だけ置く。
    panel.appendChild(featureSection(modelId, { features }));
    select(selected);

    td.appendChild(panel);
    tr.appendChild(td);
    return { tr, detail };
  }

  function toggleButton(modelId) {
    const button = el("button", "detail-toggle");
    button.type = "button";
    button.dataset.modelId = modelId;
    button.setAttribute("aria-expanded", String(open.has(modelId)));
    button.setAttribute("aria-controls", panelId(modelId));
    button.setAttribute("aria-label", t("detail.toggle"));
    button.title = t("detail.toggle");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      toggle(modelId);
    });
    return button;
  }

  function toggle(modelId) {
    if (open.has(modelId)) open.delete(modelId);
    else open.add(modelId);
    decorate();
  }

  // 表が描き直されるたびにトグルとパネルを付け直す。
  function decorate() {
    const tbody = view.table?.querySelector("tbody");
    if (!tbody) return;
    for (const stale of tbody.querySelectorAll("tr.detail-row")) stale.remove();

    for (const tr of [...tbody.querySelectorAll("tr[data-model-id]")]) {
      const modelId = tr.dataset.modelId;
      const first = tr.firstElementChild;
      if (first && !first.querySelector(".detail-toggle")) {
        first.prepend(toggleButton(modelId));
      }
      const button = tr.querySelector(".detail-toggle");
      const isOpen = open.has(modelId);
      if (button) button.setAttribute("aria-expanded", String(isOpen));
      tr.classList.toggle("expanded", isOpen);
      if (!isOpen) continue;
      const { tr: panel } = buildPanelRow(modelId, tr.children.length);
      tr.insertAdjacentElement("afterend", panel);
    }
  }

  // 行クリックでも開閉する (AC-001)。コピーボタンやリンクの操作は拾わない。
  view.table?.addEventListener("click", (event) => {
    if (event.target.closest("button, a, input, select")) return;
    const tr = event.target.closest("tr[data-model-id]");
    if (!tr || tr.classList.contains("detail-row")) return;
    toggle(tr.dataset.modelId);
  });

  document.addEventListener(LANG_CHANGED_EVENT, () => decorate());
  view.onRender(() => decorate());

  return {
    isOpen: (modelId) => open.has(modelId),
    openRow(modelId) {
      open.add(modelId);
      decorate();
    },
    closeRow(modelId) {
      open.delete(modelId);
      decorate();
    },
    toggle,
  };
}
