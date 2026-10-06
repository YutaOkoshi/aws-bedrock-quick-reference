// 結合テスト (jsdom) 用の組み立てヘルパー。
// 本物の window.location / history は書き換えられないので、偽物を差し込む。
import { vi } from "vitest";
import { mountApp } from "../src/scripts/app.js";
import { initI18n } from "../src/scripts/i18n.js";
import {
  buildSnapshot,
  buildOverrides,
  buildPrices,
  regionNotes,
} from "./fixtures/bedrock-fixture.js";
import mantle from "../data/mantle.json";
import { resetRememberedLane } from "../src/scripts/detail-view.js";

export const BASE_URL = "https://koyakimu.github.io/aws-bedrock-quick-reference/";

export function fakeLocation(search = "") {
  return {
    href: `${BASE_URL}${search}`,
    pathname: "/aws-bedrock-quick-reference/",
    search,
  };
}

export function fakeHistory(loc) {
  return {
    state: null,
    replaceState: vi.fn((state, _title, url) => {
      loc.href = new URL(url, BASE_URL).toString();
      loc.search = new URL(url, BASE_URL).search;
    }),
    pushState: vi.fn(),
  };
}

/**
 * fixture のスナップショットで画面一式を組み立てる。
 * extraProfiles を渡すと profiles.json に足した状態で組み立てられる
 * (未知の接頭辞の扱いを確かめるため。DATA-001 AC-013 / FILTER-001 AC-020)。
 */
export function mountFixtureApp({
  search = "",
  overrides,
  prices,
  lang = "ja-JP",
  extraProfiles = null,
  regionNotes: notes = regionNotes,
  getView,
  setView,
  // 取得の記録の差し替え (REGIONS-001 AC-007 / AC-014)。関数なら snapshot のものを渡す。
  fetchLog,
  // FEATURE-001 の機能表。省くと {} (機能列なし) で組み立てる。
  features,
} = {}) {
  Object.defineProperty(navigator, "language", { value: lang, configurable: true });
  document.body.innerHTML = '<main id="main"></main>';
  localStorage.clear();
  // DETAIL-001 AC-020 のレーンの記憶はモジュールのメモリなので、組み立てのたびに戻す。
  resetRememberedLane();
  initI18n();

  const snapshot = buildSnapshot();
  const loc = fakeLocation(search);
  const hist = fakeHistory(loc);
  const app = mountApp({
    host: document.getElementById("main"),
    models: snapshot.models,
    profiles: extraProfiles ? { ...snapshot.profiles, ...extraProfiles } : snapshot.profiles,
    fetchLog:
      typeof fetchLog === "function"
        ? fetchLog(snapshot.fetchLog)
        : (fetchLog ?? snapshot.fetchLog),
    regionNotes: notes,
    overrides: overrides ?? {},
    mantle,
    prices: prices ?? buildPrices(),
    features: features ?? {},
    location: loc,
    history: hist,
    getView,
    setView,
  });
  return { ...app, location: loc, history: hist, snapshot };
}

export { buildOverrides, buildPrices, regionNotes, mantle };

// --- ビュータブと行列 (REGIONS-001) ---
export const viewTab = (view) => document.querySelector(`nav.tabs .tab[data-view="${view}"]`);
export const matrixHeadRows = () => [...document.querySelectorAll("#regions-matrix thead tr")];
export const matrixBodyRows = () => [...document.querySelectorAll("#regions-matrix tbody tr")];
export const matrixRegionHeads = () =>
  [...(matrixHeadRows()[1]?.children ?? [])].map((th) => th.querySelector(".rg-code")?.textContent);
export const matrixCells = (rowIndex = 0) =>
  [...(matrixBodyRows()[rowIndex]?.querySelectorAll("td.mx") ?? [])];

// --- DOM の取り回し ---
export const bodyRows = () =>
  [...document.querySelectorAll("tbody tr[data-model-id]")].filter(
    (tr) => !tr.classList.contains("detail-row"),
  );
export const modelIds = () => bodyRows().map((tr) => tr.dataset.modelId);
export const rowFor = (modelId) =>
  bodyRows().find((tr) => tr.dataset.modelId === modelId) ?? null;
export const cells = (tr) => [...tr.children];
export const $ = (selector) => document.querySelector(selector);

export function setSelect(id, values) {
  const select = document.getElementById(id);
  for (const option of select.options) option.selected = values.includes(option.value);
  select.dispatchEvent(new Event("change"));
  return select;
}

export function setSearch(value) {
  const input = document.getElementById("filter-q");
  input.value = value;
  input.dispatchEvent(new Event("input"));
  return input;
}

export function setCheckbox(id, checked) {
  const box = document.getElementById(id);
  box.checked = checked;
  box.dispatchEvent(new Event("change"));
  return box;
}

// --- カスタムのリージョン複数選択 (FILTER-001 AC-012 〜 AC-017) ---
export const customBox = (code) => document.getElementById(`filter-custom-${code}`);

export function checkCustomRegion(code, checked = true) {
  const box = customBox(code);
  box.checked = checked;
  box.dispatchEvent(new Event("change"));
  return box;
}

export function customGroup(geo) {
  return document.querySelector(`#filter-custom-groups .filter-custom-group[data-geo="${geo}"]`);
}
