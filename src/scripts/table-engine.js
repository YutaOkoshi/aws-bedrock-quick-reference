// 汎用の表エンジン。列定義と行の配列だけを受け取り、Bedrock のことは一切知らない
// (TABLE-001「Bedrock 固有の知識を持たせない」/ D-001)。
// 先例 aws-gpu-quick-reference の table-engine.js を、価格まわりを外して持ってきたもの。

// 値が無いセルの表示。
export const EMPTY = "—";

const NUMERIC_TYPES = new Set(["number"]);

// 順位で比べる型。昇順は「低い順位が先」に揃えてあるので、
// 初回クリック (= desc) で最良の値が先頭に来る。
const RANK_TYPES = new Set(["flag"]);
const RANKS = { flag: { true: 2, false: 1 } };

function isBlank(value) {
  return value == null || value === "";
}

// ソート上の「値なし」。数値列で数として読めない値も順序を壊すので末尾へ送る。
function isMissing(type, value) {
  if (isBlank(value)) return true;
  return NUMERIC_TYPES.has(type) && Number.isNaN(Number(value));
}

function rankOf(type, value) {
  const rank = RANKS[type]?.[String(value)];
  return rank == null ? 0 : rank;
}

// 列が sortValue を持つならその戻り値で比べる。
function sortValueOf(column, row) {
  return typeof column.sortValue === "function" ? column.sortValue(row) : row[column.key];
}

export function compareValues(type, a, b) {
  if (NUMERIC_TYPES.has(type)) return Number(a) - Number(b);
  if (RANK_TYPES.has(type)) return rankOf(type, a) - rankOf(type, b);
  return String(a).localeCompare(String(b));
}

// 並べ替えた新しい配列を返す。入力は変更しない。値なしの行は方向によらず末尾。
export function sortRows(rows, column, dir) {
  const copy = rows.slice();
  if (!column || !dir) return copy;

  const indexed = copy.map((row, index) => ({ row, index, value: sortValueOf(column, row) }));
  const filled = indexed.filter(({ value }) => !isMissing(column.type, value));
  const blank = indexed.filter(({ value }) => isMissing(column.type, value));

  filled.sort((x, y) => {
    const result = compareValues(column.type, x.value, y.value);
    if (result !== 0) return dir === "asc" ? result : -result;
    return x.index - y.index; // 同値は元の順を保つ (安定ソート)
  });

  return [...filled, ...blank].map(({ row }) => row);
}

// クリックごとに desc → asc → 解除 と巡回する。
export function nextSortState(state, key) {
  if (state.sortKey !== key) return { sortKey: key, sortDir: "desc" };
  if (state.sortDir === "desc") return { sortKey: key, sortDir: "asc" };
  return { sortKey: null, sortDir: null };
}

export function visibleColumns(columns, hiddenGroups) {
  const hidden = new Set(hiddenGroups || []);
  return columns.filter((column) => !hidden.has(column.group));
}

function isNumericColumn(column) {
  return column.align ? column.align === "right" : NUMERIC_TYPES.has(column.type);
}

function isMonoColumn(column) {
  return column.mono === true || NUMERIC_TYPES.has(column.type);
}

function defaultCellText(type, value) {
  if (isBlank(value)) return EMPTY;
  if (type === "number") return String(value);
  if (type === "flag") return value === true ? "✓" : EMPTY;
  return String(value);
}

// 固定列に付ける class の添字。既定は列のキー。
// 2 段ヘッダの表のように、位置で名乗らせたい場合は列に stickyName を持たせる。
function stickyName(column) {
  return column.stickyName ?? column.key;
}

// 1 列ぶんのヘッダセル。中身は labelKey か、列が持つ headerContent(column)。
function buildHeaderCell(column, state, i18n) {
  const th = document.createElement("th");
  th.dataset.key = column.key;
  th.setAttribute("scope", "col");
  if (column.sticky) th.classList.add("sticky", `sticky-${stickyName(column)}`);
  if (column.className) th.classList.add(...String(column.className).split(/\s+/).filter(Boolean));
  if (isNumericColumn(column)) th.classList.add("num");
  if (column.title) th.title = column.title;

  if (typeof column.headerContent === "function") {
    const content = column.headerContent(column);
    if (content instanceof Node) th.appendChild(content);
    else th.textContent = String(content);
    return th;
  }

  // 並べ替えできる列だけ、中身をネイティブの button にする。
  // フォーカスと Enter / Space はブラウザが面倒を見てくれる。
  let content = th;
  if (column.sortable !== false) {
    th.classList.add("sortable");
    th.setAttribute("aria-sort", "none");
    content = document.createElement("button");
    content.type = "button";
    content.className = "sort-btn";
    th.appendChild(content);
  }
  content.textContent = i18n(column.labelKey);

  if (state.sortKey === column.key && state.sortDir) {
    th.classList.add("sorted");
    th.setAttribute("aria-sort", state.sortDir === "asc" ? "ascending" : "descending");
    const arrow = document.createElement("span");
    arrow.className = "sortarrow";
    arrow.textContent = state.sortDir === "asc" ? "▲" : "▼";
    content.appendChild(arrow);
  }

  if (typeof column.sortHint === "function") {
    const hint = document.createElement("span");
    hint.className = "column-sort-hint";
    hint.textContent = column.sortHint(state.sortKey === column.key ? state.sortDir : null);
    th.appendChild(hint);
    content.setAttribute("aria-label", `${i18n(column.labelKey)}: ${hint.textContent}`);
  }
  return th;
}

/**
 * ヘッダの行。headerGroups が無ければ 1 行、あれば 2 行にする。
 * headerGroups は [{ label | content, colspan, className }] の配列か、
 * 表示中の列を受け取って同じ配列を返す関数。グループに覆われない先頭の列
 * (= 列数 - colspan の合計) は rowspan=2 で 2 行ぶち抜きにする。
 */
function buildHead(columns, state, i18n, headerGroups, groupRowClass) {
  const groups = typeof headerGroups === "function" ? headerGroups(columns) : headerGroups;
  const top = document.createElement("tr");
  if (!groups) {
    for (const column of columns) top.appendChild(buildHeaderCell(column, state, i18n));
    return [top];
  }

  // グループの行に付ける class (見た目の側がその行を見つけられるように)。
  if (groupRowClass) top.className = groupRowClass;
  const spanned = groups.reduce((sum, group) => sum + (group.colspan ?? 1), 0);
  const leading = Math.max(columns.length - spanned, 0);
  const bottom = document.createElement("tr");

  columns.forEach((column, index) => {
    const th = buildHeaderCell(column, state, i18n);
    if (index < leading) {
      th.rowSpan = 2;
      top.appendChild(th);
    } else {
      bottom.appendChild(th);
    }
  });

  for (const group of groups) {
    const th = document.createElement("th");
    th.setAttribute("scope", "colgroup");
    th.colSpan = group.colspan ?? 1;
    if (group.className) th.classList.add(...String(group.className).split(/\s+/).filter(Boolean));
    if (group.content instanceof Node) th.appendChild(group.content);
    else th.textContent = String(group.label ?? "");
    top.appendChild(th);
  }

  return [top, bottom];
}

function buildBody(columns, rows, state, options = {}) {
  const fragment = document.createDocumentFragment();

  for (const row of rows) {
    const tr = document.createElement("tr");
    // 行に付ける印は呼び出し側が決める (DETAIL-001 が行を特定するための data-* 等)。
    if (typeof options.rowAttrs === "function") {
      for (const [name, value] of Object.entries(options.rowAttrs(row) ?? {})) {
        if (value != null) tr.setAttribute(name, String(value));
      }
    }

    for (const column of columns) {
      const td = document.createElement("td");
      const value = row[column.key];

      if (column.sticky) td.classList.add("sticky", `sticky-${stickyName(column)}`);
      if (isNumericColumn(column)) td.classList.add("num");
      if (isMonoColumn(column)) td.classList.add("mono");
      if (state.sortKey === column.key && state.sortDir) td.classList.add("sorted");
      // セルごとの見た目と説明は列が決める。エンジンは値の意味を知らない。
      if (column.className) td.classList.add(...String(column.className).split(/\s+/).filter(Boolean));
      if (typeof column.cellClass === "function") {
        const extra = column.cellClass(row);
        if (extra) td.classList.add(...String(extra).split(/\s+/).filter(Boolean));
      }
      if (typeof column.cellTitle === "function") {
        const title = column.cellTitle(row);
        if (title) td.title = String(title);
      }

      const content = column.format
        ? column.format(value, row)
        : defaultCellText(column.type, value);
      if (content instanceof Node) {
        td.appendChild(content);
      } else {
        td.textContent = content;
      }

      // dim は値ではなく描画結果で決める。
      if (td.textContent === EMPTY) td.classList.add("dim");

      tr.appendChild(td);
    }

    fragment.appendChild(tr);
  }

  return fragment;
}

export function createTable({
  columns,
  rows,
  state,
  onStateChange,
  i18n,
  rowAttrs,
  // 2 段ヘッダ (列グループ) を使う表だけが渡す。無ければヘッダは 1 行。
  headerGroups,
  // 2 段ヘッダの 1 行目 (グループの行) の tr に付ける class。
  groupRowClass,
  // 枠と table に足す class。見た目の違う表を同じエンジンで描けるようにする。
  frameClass,
  tableClass,
}) {
  const el = document.createElement("div");
  el.className = "table-frame";
  if (frameClass) el.classList.add(...String(frameClass).split(/\s+/).filter(Boolean));

  const table = document.createElement("table");
  if (tableClass) table.classList.add(...String(tableClass).split(/\s+/).filter(Boolean));
  const thead = document.createElement("thead");
  const tbody = document.createElement("tbody");
  table.appendChild(thead);
  table.appendChild(tbody);
  el.appendChild(table);

  let currentState = state;
  let currentColumns = columns;

  // ヘッダは描き直されるので、th ではなく thead に 1 度だけ委譲で張る。
  thead.addEventListener("click", (event) => {
    const th = event.target.closest("th.sortable");
    if (!th) return;
    if (typeof onStateChange !== "function") return;
    onStateChange({ ...currentState, ...nextSortState(currentState, th.dataset.key) });
  });

  function render(nextRows, nextState) {
    currentState = nextState;
    const shown = visibleColumns(currentColumns, nextState.hiddenGroups);
    const sortColumn = shown.find((column) => column.key === nextState.sortKey) || null;
    thead.replaceChildren(...buildHead(shown, nextState, i18n, headerGroups, groupRowClass));
    tbody.replaceChildren(
      buildBody(shown, sortRows(nextRows, sortColumn, nextState.sortDir), nextState, { rowAttrs }),
    );
  }

  render(rows, state);

  return {
    el,
    // 列そのものが変わる表 (列がデータから決まる行列など) のための入口。
    // 次の update() から効く。
    setColumns(nextColumns) {
      currentColumns = nextColumns;
    },
    update(nextRows, nextState) {
      render(nextRows, nextState || currentState);
    },
  };
}
