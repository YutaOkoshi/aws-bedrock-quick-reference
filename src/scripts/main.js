// エントリーポイント。データを読み込み、i18n / テーマ / 画面を組み立てる。
import models from "../../data/models.json";
import profiles from "../../data/profiles.json";
import fetchLog from "../../data/fetch-log.json";
import regionNotes from "../../data/region-notes.json";
import overrides from "../../data/overrides.json";
import mantle from "../../data/mantle.json";
import prices from "../../data/prices.json";
import features from "../../data/features.json";

import { initI18n, setupLangToggle } from "./i18n.js";
import { initTheme, setupThemeToggle } from "./theme.js";
import { mountApp } from "./app.js";

import "../styles/tokens.css";
import "../styles/base.css";
import "../styles/header.css";
import "../styles/table.css";
import "../styles/filter.css";
import "../styles/detail.css";
import "../styles/flow.css";
import "../styles/regions.css";

function boot() {
  initTheme();
  initI18n();
  setupLangToggle();
  setupThemeToggle();

  const host = document.getElementById("main");
  if (!host) return;

  mountApp({ host, models, profiles, fetchLog, regionNotes, overrides, mantle, prices, features });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot);
} else {
  boot();
}

import '../styles/reference-layout.css';
import '../styles/reference-overview.css';
import '../styles/region-map.css';
import './presentation.js';

import '../styles/reference-polish.css';
