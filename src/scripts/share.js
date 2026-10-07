// URL による状態の共有 (SHARE-001)。クエリの読み書きは url-state.mjs が持ち、
// このファイルは history / clipboard / 通知の DOM だけを扱う。
import {
  DEFAULT_VIEW,
  parseState,
  searchString,
  serializeState,
  shareUrl,
} from "./url-state.mjs";
import { providerOptions } from "./filter-model.mjs";
import { copyText } from "./copy.js";
import { t, getLang, applyTranslations, LANG_CHANGED_EVENT } from "./i18n.js";
import { regionOptionLabel } from "./region-names.js";
import { FEATURE_COLUMNS_EVENT, SORT_CHANGED_EVENT, SOURCE_REGION_EVENT } from "./table-view.js";
import { FILTER_CHANGED_EVENT } from "./filter-bar.js";
import { VIEW_CHANGED_EVENT } from "./view-tabs.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * 起点リージョン・並び順・ビュー・絞り込みを URL に載せ、URL から復元する。
 * view (TABLE-001) と filter (FILTER-001) が mount 済みであることが前提。
 *
 * getView / setView は画面ビュー (REGIONS-001) の入口。タブの UI は REGIONS-001 が持つので、
 * まだ無い間は既定の "origin" を返す getter と何もしない setter で動く (SHARE-001 AC-011)。
 *
 * providers は provider の正当値。REGIONS-001 の行列は起点に依存しない母集団を持つので
 * (AC-003)、全モデルの providerName を渡す。省くと今の起点で表示できる行から作る。
 */
export function mountShare({
  view,
  filter,
  regionNotes,
  providers = null,
  host = document.getElementById("main"),
  location: loc = window.location,
  history: hist = window.history,
  getView = () => DEFAULT_VIEW,
  setView = () => {},
} = {}) {
  const regions = view.getRegions();
  const limitOptions = filter ? filter.getLimitOptions() : [];

  // --- 通知 (AC-007 / AC-008) ---
  const notice = el("section", "banner notice");
  notice.id = "share-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;
  const noticeList = el("ul", "notice-list");
  noticeList.id = "share-notice-list";
  const close = el("button", "notice-close", "×");
  close.type = "button";
  close.id = "share-notice-close";
  close.setAttribute("data-i18n-aria-label", "share.noticeClose");
  close.setAttribute("aria-label", t("share.noticeClose"));
  close.addEventListener("click", () => {
    notice.hidden = true;
  });
  notice.append(noticeList, close);
  const sourceBar = document.getElementById("source-bar");
  if (sourceBar) sourceBar.insertAdjacentElement("afterend", notice);
  else host?.prepend(notice);

  // --- 「この表示の URL をコピー」(AC-005) ---
  const copy = el("button", "ctl share-copy");
  copy.type = "button";
  copy.id = "share-copy";
  copy.setAttribute("data-i18n", "share.copy");
  copy.textContent = t("share.copy");
  copy.addEventListener("click", async () => {
    const ok = await copyText(currentUrl());
    copy.classList.toggle("copied", ok);
    copy.textContent = ok ? t("share.copied") : t("share.copy");
    setTimeout(() => {
      copy.classList.remove("copied");
      copy.textContent = t("share.copy");
    }, 1200);
  });
  if (sourceBar) sourceBar.appendChild(copy);

  function currentState() {
    return {
      view: getView(),
      region: view.getRegion(),
      // 並び順は表が持つ (TABLE-001 AC-014)。まだ setSort を持たない画面でも落ちないようにする。
      sort: view.getSort?.(),
      ...(filter ? filter.getState() : {}),
      // 表に出す機能列 (FEATURE-001)。まだ機能列を持たない画面では null (= 既定列)。
      cols: view.getFeatureColumns?.() ?? null,
    };
  }

  // 既定の機能列と同じなら cols を URL から省くための比較相手。
  function serializeOptions() {
    return { defaultCols: view.getDefaultFeatureColumns?.() ?? [] };
  }

  function currentUrl() {
    return shareUrl(currentState(), loc.href, serializeOptions());
  }

  // 絞り込み操作で戻るボタンの履歴を埋めない。常に replaceState (AC-001)。
  function syncUrl() {
    const query = searchString(currentState(), serializeOptions());
    // 先頭スラッシュの絶対パスを作らない。GitHub Pages のサブパス配下でも動くように
    // 現在のパスをそのまま使う (Spec Notes)。
    const path = `${loc.pathname}${query}`;
    hist.replaceState(hist.state ?? null, "", path);
  }

  function showNotice(messages) {
    noticeList.replaceChildren(...messages.map((message) => el("li", "notice-line", message)));
    notice.hidden = messages.length === 0;
  }

  function describeIgnored(ignored) {
    const messages = [];
    for (const entry of ignored) {
      if (entry.param === "region" && entry.fallback) {
        messages.push(
          t("share.noticeRegion", {
            region: entry.value,
            fallback: regionOptionLabel(view.getRegion(), getLang(), regionNotes),
          }),
        );
      }
    }
    const others = ignored.filter((entry) => !(entry.param === "region" && entry.fallback));
    if (others.length > 0) {
      messages.push(
        t("share.noticeIgnored", {
          items: others.map((entry) => `${entry.param}=${entry.value}`).join(", "),
        }),
      );
    }
    return messages;
  }

  /** 初期化。URL を読み、起点と絞り込みに適用してから URL を現在の状態に揃える。 */
  function restore(search = loc.search) {
    // provider の正当値。渡されていればそれが正 (= 全モデルの providerName)。
    // 起点で絞った一覧で検査すると、行が 0 件の起点を指した URL で provider が
    // 落ちて通知が出てしまい、SHARE-001 AC-012 に反する。
    const validProviders = providers ?? providerOptions(view.getModel()?.rows ?? []);
    const { state, ignored } = parseState(search, {
      regions,
      providers: validProviders,
      limitOptions,
      featureKeys: view.getFeatureKeys?.() ?? [],
    });

    if (state.region !== view.getRegion()) view.setRegion(state.region);
    // 並び順は表に、ビューは呼び出し側に当てる (AC-011 / AC-013)。
    if (typeof view.setSort === "function") view.setSort(state.sort);
    setView(state.view);
    // 機能列 (FEATURE-001)。null は既定列。復元なのでイベントは出さない。
    view.setFeatureColumns?.(state.cols ?? view.getDefaultFeatureColumns?.() ?? [], { silent: true });

    if (filter) {
      // 起点を当てた後の母集団で判定し直す。providers が渡されていれば起点に依らない。
      const afterRegion = providers ?? providerOptions(view.getModel()?.rows ?? []);
      const kept = state.provider.filter((entry) => afterRegion.includes(entry));
      for (const entry of state.provider) {
        if (!kept.includes(entry)) ignored.push({ param: "provider", value: entry });
      }
      filter.setStateSilently({
        provider: kept,
        modality: state.modality,
        q: state.q,
        callable: state.callable,
        limit: state.limit,
      });
    }

    showNotice(describeIgnored(ignored));
    // 不正値を落とした結果を URL にも反映する (AC-007)。
    syncUrl();
    return { state, ignored };
  }

  // 起点・絞り込みが変わるたびに URL を書き換える (AC-001 / AC-003)。
  document.addEventListener(SOURCE_REGION_EVENT, syncUrl);
  document.addEventListener(FILTER_CHANGED_EVENT, syncUrl);
  // 並び順の切り替えも URL に載せる (AC-013)。履歴は積まず replaceState のまま。
  document.addEventListener(SORT_CHANGED_EVENT, syncUrl);
  // ビューの切り替えも URL に載せる (AC-011)。
  document.addEventListener(VIEW_CHANGED_EVENT, syncUrl);
  // 機能列の選択も URL に載せる (FEATURE-001)。
  document.addEventListener(FEATURE_COLUMNS_EVENT, syncUrl);

  document.addEventListener(LANG_CHANGED_EVENT, () => {
    applyTranslations(notice);
    copy.textContent = t("share.copy");
  });

  return {
    notice,
    copyButton: copy,
    restore,
    syncUrl,
    currentUrl,
    currentState,
    serialize: () => serializeState(currentState(), serializeOptions()),
  };
}
