// 表に出す機能列を選ぶピッカー (FEATURE-001)。DOM だけを持ち、どの列を出すかの状態は table-view.js が持つ。
// 選択肢の名前は docs の英語名のまま出す (訳さない)。ボタンなどの UI 文言だけ i18n を通す。
import { t } from "./i18n.js";

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

/**
 * options: [{ key, label }]（featureOptions の返り値）
 * onChange(keys): チェックの変更。keys は options の順に並べた選択中のキー
 * onReset(): 「既定に戻す」
 */
export function createFeaturePicker({ options, selected = [], onChange, onReset }) {
  const root = el("details", "feature-picker");
  root.id = "feature-picker";
  root.hidden = options.length === 0;
  const summary = el("summary", "feature-picker-summary");
  const menu = el("div", "feature-picker-menu");
  menu.setAttribute("role", "group");
  const list = el("div", "feature-picker-list");
  const reset = el("button", "ctl feature-picker-reset");
  reset.type = "button";
  reset.id = "feature-picker-reset";
  menu.append(list, reset);
  root.append(summary, menu);

  const boxes = new Map();
  for (const option of options) {
    const label = el("label", "feature-picker-option");
    const box = document.createElement("input");
    box.type = "checkbox";
    box.value = option.key;
    box.dataset.featureKey = option.key;
    label.append(box, el("span", "feature-picker-name", option.label));
    list.appendChild(label);
    boxes.set(option.key, box);
  }

  list.addEventListener("change", (event) => {
    if (!event.target.matches("input[type=checkbox]")) return;
    onChange?.(options.filter((option) => boxes.get(option.key).checked).map((option) => option.key));
  });
  reset.addEventListener("click", () => onReset?.());

  let current = [...selected];
  function renderText() {
    summary.textContent = t("feature.pickerLabel", { count: current.length });
    menu.setAttribute("aria-label", t("feature.pickerGroup"));
    reset.textContent = t("feature.pickerReset");
  }

  function setSelected(keys) {
    current = [...keys];
    const on = new Set(keys);
    for (const [key, box] of boxes) box.checked = on.has(key);
    renderText();
  }

  setSelected(selected);

  return { el: root, setSelected, refresh: renderText };
}
