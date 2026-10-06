// 画面の組み立て。表 (TABLE-001) → 絞り込み (FILTER-001) → 行の展開 (DETAIL-001)
// → URL の復元 (SHARE-001) の順に取り付ける。データは引数で受け取り、
// このモジュールからファイルを読まない (テストが fixture を渡せるようにするため)。
import { mountTableView } from "./table-view.js";
import { mountFilterBar } from "./filter-bar.js";
import { mountDetailView } from "./detail-view.js";
import { mountShare } from "./share.js";
import { mountViewTabs } from "./view-tabs.js";
import { mountRegionsView } from "./regions-view.js";
import { LANG_CHANGED_EVENT } from "./i18n.js";
import { SORT_CHANGED_EVENT, SOURCE_REGION_EVENT } from "./table-view.js";
import { FILTER_CHANGED_EVENT } from "./filter-bar.js";
import { VIEW_REGIONS } from "./url-state.mjs";
import { matrixSourceRows } from "./regions-model.mjs";
import { providerOptions } from "./filter-model.mjs";

export function mountApp({
  host,
  models,
  profiles,
  fetchLog,
  regionNotes,
  overrides = {},
  mantle = null,
  prices = {},
  // FEATURE-001: data/features.json。無ければ {} で機能列も機能の節も出さない。
  features = {},
  location: loc = typeof window !== "undefined" ? window.location : undefined,
  history: hist = typeof window !== "undefined" ? window.history : undefined,
  // 画面ビュー (REGIONS-001) の入口。タブの UI ができるまでは既定の "origin" のまま。
  getView,
  setView,
}) {
  // ヘッダ直下の 2 ビュー (REGIONS-001 AC-001)。既存の画面は「起点から」のパネルに入る。
  const tabs = mountViewTabs({ host });

  const view = mountTableView({
    host: tabs.panels.origin,
    models,
    profiles,
    fetchLog,
    regionNotes,
    overrides,
    mantle,
    prices,
    features,
  });

  const filter = mountFilterBar({
    view,
    host: host.querySelector("#filter-bar"),
    profiles,
    regionNotes,
  });

  const detail = mountDetailView({
    view,
    models,
    profiles,
    regionNotes,
    mantle,
    prices,
    features,
  });

  // 取得日時・出典の脚注は 2 つのビューで共用する 1 つにする (REGIONS-001 UI Description)。
  const footnote = tabs.panels.origin.querySelector("#footnote");
  if (footnote) host.appendChild(footnote);

  const regions = mountRegionsView({
    host: tabs.panels.regions,
    models,
    fetchLog,
    regionNotes,
    filter,
    getSort: () => view.getSort(),
    getOriginRegion: () => view.getRegion(),
  });

  // 行列は「リージョン」タブが初めて選ばれたときに描く (AC-NFR-002)。
  tabs.onChange((next) => {
    if (next === VIEW_REGIONS) regions.activate();
  });
  // 起点・絞り込み・並び順が変わったら、次に開いたときに追いつく。
  for (const event of [SOURCE_REGION_EVENT, FILTER_CHANGED_EVENT, SORT_CHANGED_EVENT]) {
    document.addEventListener(event, () => regions.invalidate());
  }

  // 復元されたビューは控えるだけにして、実際の切り替えは絞り込みを当て終わった後に行う。
  // restore() の途中で切り替えると、まだ当たっていない絞り込みで行列を 1 度描いてしまう。
  let restoredView = null;
  const share = mountShare({
    view,
    filter,
    regionNotes,
    // provider の正当値は全モデルの providerName。行列は起点に依存しない (SHARE-001 AC-012)。
    providers: providerOptions(matrixSourceRows(models)),
    host,
    location: loc,
    history: hist,
    getView: getView ?? tabs.getView,
    setView:
      setView ??
      ((next) => {
        restoredView = next;
      }),
  });
  // 通知はどちらのビューでも読めるよう、タブの上に置く (SHARE-001 AC-007 / AC-008)。
  tabs.row.insertAdjacentElement("beforebegin", share.notice);
  // 「この表示の URL をコピー」もビューに依らないので、タブと同じ行に置く (AC-005)。
  tabs.row.appendChild(share.copyButton);
  // URL の値は TABLE-001 の既定値より優先する (SHARE-001 AC-002)。
  share.restore();
  // 復元は絞り込みを黙って当てる (イベントを出さない) ので、行列にも当て直す。
  // 伏せたままの行列はここでは描かれず、印だけが付く。
  regions.invalidate();
  // 絞り込みを当て終えてからビューを切り替える。
  if (restoredView) tabs.setView(restoredView);
  // 復元で「リージョン」が選ばれていたら、ここで描く (SHARE-001 AC-011)。
  // tabs.setView からの onChange で描き終えていれば、ここは何もしない。
  if (tabs.getView() === VIEW_REGIONS) regions.activate();

  // 言語が変わってもリロードしない (I18N-001 AC-003)。
  document.addEventListener(LANG_CHANGED_EVENT, () => view.rerender());

  return { view, filter, detail, share, tabs, regions };
}
