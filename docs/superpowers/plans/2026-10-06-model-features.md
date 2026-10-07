# モデル別 Capabilities and Features 実装計画

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 公式 docs（英語版）のモデルカードの Capabilities and Features を `data/features.json` に取り込み、表の選べる機能列と詳細パネルに出し、GitHub Actions で毎日取り直して差分を PR にする。

**Architecture:** 価格（PRICE-001）と同じく「純関数の lib + 薄い CLI + 生成物 JSON + 手書きの対応表」。画面は既存の `buildColumns` に列グループ `feature` を足し、詳細パネルに節を足す。URL は `cols=` を `url-state.mjs` に足す。

**Tech Stack:** Node 22（組み込み `fetch`）、Vite + vite-plugin-singlefile、vitest + jsdom、GitHub Actions。

設計: `docs/superpowers/specs/2026-10-06-model-features-design.md`（以下「設計」）。

## Global Constraints

- `package.json` の `dependencies` は空のまま。devDependencies も増やさない（D-001 / AC-009）
- `scripts/lib/features.mjs` は I/O・時刻・ネットワークを持たない純関数のみ
- 取得元は `https://docs.aws.amazon.com/bedrock/latest/userguide/` の英語版 `.md` と `toc-contents.json` だけ。日本語版 docs・サードパーティ（models.dev / LiteLLM）は使わない
- 生成物 `data/features.json` は手で編集しない。手書きは `data/feature-names.json` と `data/feature-model-map.json` だけ
- 機能名は ja / en どちらの画面でも docs の英語名のまま表示する
- 値は true / false / キーなし の 3 状態。「記載なし」を false に倒さない
- 対応表に無い機能名・モデルは推測で寄せない（`unknownFeatures` / `unmatchedCards` に残す）
- workflow に AWS の認証要素を置かない。`permissions` は `contents: write` と `pull-requests: write` だけ
- ファイルを読むテストは先頭に `// @vitest-environment node`
- コメント・文言は既存コードと同じ日本語の調子。AC 番号を `FEATURE-001 AC-xxx` で参照する
- 最終報告は要約のみ。詳細ログはファイルに書いてパスを返す

## ファイル構成と担当

| 担当 | ファイル |
|---|---|
| data | `scripts/lib/features.mjs`（新）, `scripts/fetch-bedrock-features.mjs`（新）, `data/feature-names.json`（新）, `data/feature-model-map.json`（新）, `data/features.json`（生成）, `tests/features.test.js`（新）, `tests/fetch-bedrock-features.test.js`（新）, `tests/fixtures/features/*`（配置済み・間引き可） |
| ci | `.github/workflows/refresh-features.yml`（新）, `tests/helpers/mini-yaml.js`（新。`deploy-workflow.test.js` から極小パーサを移す）, `tests/deploy-workflow.test.js`（import に置換）, `tests/refresh-features-workflow.test.js`（新） |
| ui | `src/scripts/feature-model.mjs`（新）, `src/scripts/feature-picker.js`（新）, `src/scripts/table-view.js`, `src/scripts/detail-view.js`, `src/scripts/url-state.mjs`, `src/scripts/share.js`, `src/scripts/app.js`, `src/scripts/main.js`, `src/i18n/ja.js`, `src/i18n/en.js`, `src/styles/table.css`, `src/styles/detail.css`, `tests/feature-render.test.js`（新）, `tests/feature-model.test.js`（新）, `tests/url-state.test.js` |
| docs | `docs/apd/spec-features.md`（新）, `docs/apd/decisions.md`, `docs/apd/spec-table.md`, `docs/apd/spec-detail.md`, `docs/apd/spec-share.md`, `CLAUDE.md`, `README.md` |

1 ファイルを 2 人で編集しない。

---

### Task 1 (data): パーサと正規化 `scripts/lib/features.mjs`

**Files:** Create `scripts/lib/features.mjs`, `tests/features.test.js`, `data/feature-names.json`, `data/feature-model-map.json`

**Interfaces（Produces）:**

```js
export const DOCS_BASE = "https://docs.aws.amazon.com/bedrock/latest/userguide/";
export const TOC_URL = `${DOCS_BASE}toc-contents.json`;
export function cardMarkdownUrl(card)            // "model-card-x.html" -> `${DOCS_BASE}model-card-x.md`
export function listModelCards(toc)               // toc JSON を再帰で歩き href が /^model-card-.+\.html$/ のものを重複なし昇順で返す
export function parseModelCard(markdown)          // -> ParsedCard | null（`## Capabilities and Features` が無くても ID は返す）
export function resolveModelIds(card, parsed, { models, map })   // -> string[]（空 = 引けない）。map の値 null は [] だが「確認済み」として扱うので呼び出し側で区別
export function featureKey(docsName, names)       // names.names[docsName] ?? `unknown:${slug(docsName)}`
export function normalizeFeatures({ cards, models, names, map, previous, generatedAt })
  // cards: { [card]: markdown | null }（null = 取得失敗）
  // -> { features: FeaturesJson, summary: string(Markdown), guardTripped: boolean }
export function sameContent(a, b)                 // generatedAt を除いて JSON 比較
```

`ParsedCard`:
```js
{
  ids: { runtime: "anthropic.claude-sonnet-5-5" | null, inference: ["us.anthropic....", "global.anthropic...."] },
  runtime: { "Guardrails": true, "Structured outputs": false } | null,   // docs の名前のまま
  mantle: {...} | null,
  promptCaching: { explicit: true|false|null, minTokens, maxCheckpoints, ttl, fields } | null,   // 文字列のまま
  computerUse: [{ toolType, betaHeader }] | null
}
```

パース規則:
- 節は `\n## ` で区切る。`## Programmatic Access` 節の表で、1 列目が `bedrock-runtime` の行の 2 列目を Model ID（`N/A` は null）、4〜5 列目のバッククォート内 / 平文の ID を inference に入れる（`<br />` 区切り、`N/A` は除く）。**他の節の `| bedrock-runtime |` 行は拾わない**（Endpoint support 表にもある）
- `## Capabilities and Features` 節の中で `bedrock-runtime` を含む `**Features supported using ...**` 見出しの直後の表を runtime、`bedrock-mantle` を mantle。セル内を `<br />` で割り、`icon-yes.png` → true / `icon-no.png` → false、名前は `[名前](` の中身（リンクが無ければ画像の後ろの平文）
- `Prompt Caching` を含む太字見出しの直後の表 → promptCaching（ヘッダ名で列を引く。`Explicit Prompt Caching supported` が `Yes`/`No` → true/false）
- `Computer use` を含む太字見出しの直後の表 → computerUse（`Tool type` / `Beta header`）
- 表の値の `\_` は `_` に戻し、前後の空白を落とす

ID 解決（設計 3.1）: (1) `map[card]` (2) `ids.runtime` (3) `ids.inference` の各値から最初の `.` までを外したもの。候補ごとに `Object.keys(models)` から `id === c || id.startsWith(c + ":")` を集める。最初に 1 件以上当たった段で確定。

`normalizeFeatures` の出力（設計 3 の JSON）:
- `features`: `names.labels` のキー順 → その後 unknown を label 昇順。値 `{ label, docs }`（docs はカードのリンク先の相対 URL。unknown は最初に見たもの）
- `defaultColumns`: `names.defaultColumns` をそのまま
- `byModel[id]`: `{ card, runtime, mantle, promptCaching, computerUse }`。runtime/mantle は正規化キーで。複数カードが同じ ID に当たったら後勝ちにせず `unmatchedCards` に `{card, modelId, reason:"duplicate"}` を積む
- `cards` / `cardsWithFeatures` / `failedCards` / `unmatchedCards` / `unknownFeatures`（docs の名前、昇順・重複なし）
- `generatedAt`: `previous` と `sameContent` なら `previous.generatedAt`、違えば引数の `generatedAt`
- `guardTripped`: `previous?.cardsWithFeatures` があり、新しい値がその半分未満
- `summary`: `## Feature changes` 見出しで、モデルごと `- <id>: +runtime:Guardrails, -mantle:Count tokens` の増減、続けて unknown と unmatched の一覧。差分が無ければ `No changes.`

`data/feature-names.json`（観測 26 種を全部載せる。表記揺れは寄せる）:
```json
{
  "_note": "docs の機能名 → 正規化キー。無い名前は推測で寄せず unknown:<slug> になる (FEATURE-001 AC-004)",
  "labels": {
    "streaming": "Response streaming",
    "implicitPromptCaching": "Implicit Prompt Caching",
    "explicitPromptCaching": "Explicit Prompt Caching",
    "structuredOutputs": "Structured outputs",
    "clientToolCalling": "Client-side tool calling",
    "serverToolCalling": "Server-side tool calling",
    "serverSystemTools": "Server-side system tools",
    "computerUse": "Computer use",
    "reasoning": "Reasoning",
    "countTokens": "Count tokens",
    "guardrails": "Guardrails",
    "abuseDetection": "Abuse detection",
    "knowledgeBase": "Knowledge base",
    "agents": "Agents",
    "flows": "Flows",
    "promptManagement": "Prompt management",
    "promptOptimization": "Prompt optimization",
    "promptRouting": "Intelligent prompt routing",
    "modelEvaluation": "Model evaluation",
    "applicationInferenceProfiles": "Application inference profiles",
    "invocationLogs": "Invocation logs",
    "projects": "Projects"
  },
  "names": {
    "Response streaming": "streaming",
    "Implicit Prompt Caching": "implicitPromptCaching",
    "Explicit Prompt Caching": "explicitPromptCaching",
    "Structured outputs": "structuredOutputs",
    "Structured outputs (JSON Schema; see API configuration)": "structuredOutputs",
    "Client-side tool calling": "clientToolCalling",
    "Server-side tool calling": "serverToolCalling",
    "Server-side tool use": "serverToolCalling",
    "Server-side system tools": "serverSystemTools",
    "Computer use": "computerUse",
    "Reasoning": "reasoning",
    "Count tokens": "countTokens",
    "Guardrails": "guardrails",
    "Abuse detection": "abuseDetection",
    "Knowledge base": "knowledgeBase",
    "Knowledge Bases": "knowledgeBase",
    "Agents": "agents",
    "Flows": "flows",
    "Prompt management": "promptManagement",
    "Prompt optimization": "promptOptimization",
    "Intelligent prompt routing": "promptRouting",
    "Model evaluation": "modelEvaluation",
    "Application inference profiles": "applicationInferenceProfiles",
    "Invocation logs": "invocationLogs",
    "Projects": "projects",
    "Projects (default project only)": "projects"
  },
  "defaultColumns": ["explicitPromptCaching", "structuredOutputs", "clientToolCalling", "guardrails"]
}
```
寄せ方に疑義がある組（`Server-side tool use` と `Server-side tool calling`、`Projects (default project only)`）は、該当カードの本文を読んで同じ機能を指すと確認できた場合だけ寄せる。確認できなければ `names` から外して unknown に残し、報告に書く。

`data/feature-model-map.json`: `{ "_note": "自動で引けないカード → models.json の ID 配列。null は該当なし確認済み (FEATURE-001 AC-005)" }` から始め、Task 2 の実取得で `unmatchedCards` を見て docs の本文で確認できたものだけ足す。

- [ ] Step 1: `tests/features.test.js` に失敗するテストを書く（fixture は `tests/fixtures/features/` に配置済み: sonnet-5-5 / titan-text-embeddings-v2（機能節なし）/ haiku-4-5（Model ID `N/A`）/ nova-2-lite（`:256k` 等の文脈長違い）/ gpt-6-luna（`Knowledge Bases` 表記）、`toc-contents.json`。`models` は fixture 内で小さく作る）。最低限のケース:
  - `listModelCards(toc)` が 134 件で `model-card-anthropic-claude-sonnet-5-5.html` を含む
  - sonnet-5-5: `ids.runtime === "anthropic.claude-sonnet-5-5"`、runtime の Guardrails true / Structured outputs false / Count tokens false、mantle の Count tokens true / Guardrails false、promptCaching `{explicit:true,minTokens:"512",maxCheckpoints:"4",ttl:"5 minutes, 1 hour",fields:"system, messages, and tools"}`、computerUse `[{toolType:"computer_20251124",betaHeader:"computer-use-2025-11-24"}]`
  - titan-embeddings-v2: runtime / mantle / promptCaching が null、ids は取れる
  - haiku-4-5: `ids.runtime === null`、`resolveModelIds` が `anthropic.claude-haiku-4-5-20251001-v1:0` を返す
  - nova-2-lite: `amazon.nova-2-lite-v1:0` と `amazon.nova-2-lite-v1:0:256k` の両方を返す
  - gpt-6-luna: `Knowledge Bases` が `knowledgeBase` に寄る
  - 対応表に無い名前 `Foo bar` → `unknown:foo-bar`、`unknownFeatures` に載る
  - `generatedAt` 据え置き（同内容の previous を渡すと previous の値）／変化時は新しい値
  - 安全弁（previous.cardsWithFeatures=100、新が 40 → guardTripped true）
  - 取得失敗（cards の値 null）は `failedCards` に数え例外にしない
  - summary に `+runtime:Guardrails` 形式の増減が出る
- [ ] Step 2: `npx vitest run tests/features.test.js` で FAIL を確認
- [ ] Step 3: 実装
- [ ] Step 4: PASS を確認、`npm test` 全体も PASS
- [ ] Step 5: commit `feat(features): モデルカードの機能表のパーサと正規化 (FEATURE-001)`

### Task 2 (data): CLI `scripts/fetch-bedrock-features.mjs` と実データ

**Files:** Create `scripts/fetch-bedrock-features.mjs`, `tests/fetch-bedrock-features.test.js`; Generate `data/features.json`; Modify `data/feature-model-map.json`

**Interfaces:** Consumes Task 1。Produces `data/features.json`、`data/raw/<日付>/features/summary.md`、終了コード（guardTripped で 1）。

`fetch-bedrock-prices.mjs` と同じ形（`USAGE` / `parseFeatureArgs(argv, { today })` を export / `main` は `import.meta.url === file://argv[1]` のときだけ）:
- 引数: `--date YYYY-MM-DD` / `--dry-run` / `--from-raw YYYY-MM-DD`。不明な引数は例外
- 取得: `TOC_URL` → `listModelCards` → 各 `.md` を同時 4 本、`headers: { "Accept-Language": "en-US", "User-Agent": "aws-bedrock-quick-reference (+https://github.com/koyakimu/aws-bedrock-quick-reference)" }`。失敗は null
- 生データ: `data/raw/<日付>/features/toc-contents.json` と `<card>.md`。`--from-raw` はここから読む
- `previous` は既存の `data/features.json`（無ければ null）
- `guardTripped` なら書き出さず stderr に理由を書いて `process.exitCode = 1`
- `summary.md` は常に raw に書く。`--dry-run` でなければ `data/features.json` を書く（`JSON.stringify(v, null, 2) + "\n"`）
- stderr に `cards / with features / failed / unmatched / unknown` の件数

- [ ] Step 1: `tests/fetch-bedrock-features.test.js` に引数解析のテスト（既定日付、`--from-raw` と `--date` の形式検査、不明引数）と、fixture を一時ディレクトリに raw として置いて `--from-raw` 相当の関数（`buildFromRaw({ rawDir, dataDir })` を export）で features.json が出るテスト
- [ ] Step 2: FAIL 確認 → 実装 → PASS
- [ ] Step 3: 実取得 `node scripts/fetch-bedrock-features.mjs`（サンドボックス外で実行。`fetch failed` ならサンドボックスを外す）。`unmatchedCards` を見て、docs 本文で確認できたカードだけ `feature-model-map.json` に足し、`--from-raw <日付>` で作り直す。`unknownFeatures` が残れば内容を確認して `feature-names.json` を直す（推測で寄せない）
- [ ] Step 4: 2 回目の `--from-raw` で `generatedAt` が変わらないことを確認
- [ ] Step 5: `npm test` PASS、commit `feat(features): docs から機能表を取る CLI と初回データ (FEATURE-001)`

### Task 3 (ci): 定期取得の workflow

**Files:** Create `.github/workflows/refresh-features.yml`, `tests/helpers/mini-yaml.js`, `tests/refresh-features-workflow.test.js`; Modify `tests/deploy-workflow.test.js`

**Interfaces:** Consumes `node scripts/fetch-bedrock-features.mjs`（Task 2。未完でも workflow は書ける）と `data/raw/<JST日付>/features/summary.md`。

```yaml
name: Refresh model features

# docs のモデルカード (英語版 .md) から機能表を取り直し、差分があれば PR を作る (FEATURE-001 / D-016)。
# AWS の認証情報は使わない (D-002)。
on:
  schedule:
    - cron: "0 21 * * *"   # JST 06:00
  workflow_dispatch:

permissions:
  contents: write
  pull-requests: write

concurrency:
  group: refresh-features
  cancel-in-progress: false

jobs:
  refresh:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm
      - run: npm ci
      - run: node scripts/fetch-bedrock-features.mjs
      - run: npm test
      - name: Open or update PR
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
          BRANCH: bot/refresh-features
        run: |
          if git diff --quiet -- data/features.json; then
            echo "no changes"; exit 0
          fi
          DATE=$(TZ=Asia/Tokyo date +%F)
          git config user.name "github-actions[bot]"
          git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
          git switch -C "$BRANCH"
          git add data/features.json
          git commit -m "chore(features): docs のモデルカードから機能表を更新 ($DATE)"
          git push --force origin "$BRANCH"
          BODY="data/raw/$DATE/features/summary.md"
          if gh pr view "$BRANCH" --json state -q .state 2>/dev/null | grep -q OPEN; then
            gh pr edit "$BRANCH" --body-file "$BODY"
          else
            gh pr create --head "$BRANCH" --base main --title "chore(features): モデル機能表の更新 ($DATE)" --body-file "$BODY"
          fi
```
（パーサが扱えない構文 — `|` のブロックスカラー — を使うので、`mini-yaml.js` に `key: |` のブロックスカラー対応を足す。足すのは「インデントが深い行を改行で連結する」だけ）

- [ ] Step 1: `deploy-workflow.test.js` の極小パーサを `tests/helpers/mini-yaml.js`（`export function parseYaml(text)`）へ移し、元のテストが PASS のままであることを確認
- [ ] Step 2: `tests/refresh-features-workflow.test.js`（node）: `on.schedule[0].cron === "0 21 * * *"`、`workflow_dispatch` がある、`permissions` が `{contents:"write","pull-requests":"write"}` と完全一致、`npm test` が PR 作成より前、fetch のステップがある、`aws-` で始まる action / `AWS_` の env / `role-to-assume` が無い。既存の「どの YAML にも AWS 認証要素が無い」テストが新ファイルも対象にしていることを確認
- [ ] Step 3: FAIL → workflow を書く → PASS、`npm test` PASS
- [ ] Step 4: commit `ci: docs の機能表を毎日取り直して PR を作る (FEATURE-001 / D-016)`

### Task 4 (ui): 表の機能列・列ピッカー・脚注

**Files:** Create `src/scripts/feature-model.mjs`, `src/scripts/feature-picker.js`, `tests/feature-model.test.js`, `tests/feature-render.test.js`; Modify `src/scripts/table-view.js`, `src/scripts/app.js`, `src/scripts/main.js`, `src/i18n/ja.js`, `src/i18n/en.js`, `src/styles/table.css`

**Interfaces:**
- Consumes: `data/features.json` の形（設計 3）。Task 2 の完了前は `tests/fixtures/features/features.sample.json` を自分で作って使う（sonnet-5-5 / haiku-4-5 / 記載なしモデルの 3 件程度）
- Produces（`feature-model.mjs`、純関数）:
  ```js
  export const FEATURE_STATES = { YES: "yes", NO: "no", NONE: "none" };
  export function featureOptions(features)          // -> [{ key, label }]（features.features の順）
  export function defaultFeatureColumns(features)   // -> string[]（defaultColumns のうち features に在るもの）
  export function featureCell(features, modelId, key) // -> { runtime: "yes"|"no"|"none", mantle: ... }
  export function featureSortValue(cell)            // runtime(yes=2,no=1,none=0)*3 + mantle 同
  export function buildFeatureRows(features, modelId) // 詳細パネル用 [{ key, label, runtime, mantle }]（どちらかが none 以外の行のみ）
  ```
- `mountTableView` に引数 `features = {}` を足し、戻り値に `getFeatureColumns()` / `setFeatureColumns(keys, { silent })` を足す。変更時に `FEATURE_COLUMNS_EVENT = "bqr:feature-columns-changed"`（export）を dispatch（silent なら出さない）
- `buildColumns(regionNotes, { features, featureColumns })` が価格 2 列の右に `{ key: "feature:<k>", group: "feature", label: <docs名>, type: "number", sortValue: featureSortValue(...), format: セル }` を足す。既存の列定義の書き方（`labelKey`）に合わない場合は table-engine が受け付ける既存の仕組みを読んで合わせる（i18n を通さない生の見出しが要る）
- セルの描画: `<span class="feature-mark">runtime ✓</span> / <span>mantle ✕</span>`。記載なしは「—」。両方 none なら「—」1 つ。`aria-label` に「bedrock-runtime: 対応 / bedrock-mantle: 非対応」（i18n）
- ピッカー: 表の上（並べ替え UI の近く）に「機能の列」ボタン → チェックボックス一覧（`featureOptions` 全件）。既定に戻す操作つき
- 脚注: `features.generatedAt` と出典（`https://docs.aws.amazon.com/bedrock/latest/userguide/model-cards.html`）。`features` が空なら出さない
- `main.js` で `import features from "../../data/features.json"` し `mountApp` → `mountTableView` / `mountDetailView` に渡す。Task 2 前は `data/features.json` が無いので、`{}` の空ファイルではなく Task 2 の成果を待つか、sample をテストでだけ使う（**`data/features.json` を ui 担当が書いてはいけない**）

- [ ] Step 1: `tests/feature-model.test.js` に純関数のテスト（3 状態・並べ替え値・既定列・options の順）→ FAIL → 実装 → PASS
- [ ] Step 2: `tests/feature-render.test.js`（jsdom、既存 `price-render.test.js` と `tests/app-harness.js` の組み方に倣う）: 既定 4 列が価格の右に並ぶ／セルの 3 状態の文言／ピッカーで列を足す・外す／並べ替え／features 空で列も脚注も出ず例外にならない → FAIL → 実装 → PASS
- [ ] Step 3: `npm test` 全体 PASS（既存の列数を前提にしたテストが壊れたら、そのテストの期待を「価格の右に機能列が増える」に合わせて直す。既存の振る舞いは変えない）
- [ ] Step 4: commit `feat(ui): 表に選べる機能列を足す (FEATURE-001)`

### Task 5 (ui): URL の `cols=`

**Files:** Modify `src/scripts/url-state.mjs`, `src/scripts/share.js`, `tests/url-state.test.js`

- `PARAM_ORDER` の末尾に `"cols"`。`DEFAULT_STATE.cols = null`（null = 既定列）
- `parseState(search, { ..., featureKeys = [] })`: `cols` があれば `splitList` して `featureKeys` に在るものだけ採用、無いものは `ignored.push({ param: "cols", value })`。`cols=`（空文字）は `[]`（機能列なし）
- `serializeState(state, { defaultCols = [] } = {})`: `state.cols` が null か `defaultCols` と同じ並びなら省く。`[]` は `cols=`
- `share.js`: 復元時に `view.setFeatureColumns(state.cols ?? defaults, { silent: true })`、`FEATURE_COLUMNS_EVENT` で URL を書き換え（他の条件と同じ `replaceState`）
- [ ] Step 1: テスト（復元・省略・空・未知キーの通知）→ FAIL → 実装 → PASS、`npm test` PASS
- [ ] Step 2: commit `feat(share): 機能列を URL に載せる (FEATURE-001 / SHARE-001)`

### Task 6 (ui): 詳細パネルの「機能」節

**Files:** Modify `src/scripts/detail-view.js`, `src/i18n/ja.js`, `src/i18n/en.js`, `src/styles/detail.css`; Test `tests/feature-render.test.js`

- `mountDetailView({ ..., features = {} })`。`lanePanel` で `priceSection` の後に `featureSection(modelId, { features })`
- 中身: 見出し「機能（Capabilities and Features）」、`buildFeatureRows` の表（列: 機能 / bedrock-runtime / bedrock-mantle、値 ✓ / ✕ / —）、`promptCaching` があれば 5 項目の小表（見出しは i18n、値は docs の文字列のまま）、`computerUse` があれば Tool type / Beta header の表、`DOCS_BASE + card` へのリンク「公式 docs のモデルカード」
- `byModel[modelId]` が無ければ「公式 docs のモデルカードに機能の記載がありません」
- [ ] Step 1: テスト（sonnet-5-5 の行で Guardrails が runtime ✓ / mantle ✕、prompt caching 512、computer use、リンク先、記載なしの文言）→ FAIL → 実装 → PASS、`npm test` PASS
- [ ] Step 2: commit `feat(detail): 詳細パネルに機能の節を足す (FEATURE-001 / DETAIL-001)`

### Task 7 (docs): 仕様と運用の文書

**Files:** Create `docs/apd/spec-features.md`; Modify `docs/apd/decisions.md`, `docs/apd/spec-table.md`, `docs/apd/spec-detail.md`, `docs/apd/spec-share.md`, `CLAUDE.md`, `README.md`

- `spec-features.md`: `spec-price.md` と同じ frontmatter（`spec_id: "FEATURE-001"`, `context: "features"`, `version: 1`, `decision_refs: [D-015, D-016, D-009, D-003]`）、User Story、AC-001〜（取得対象 / 生データと再正規化 / 純関数 / 機能名の正規化と unknown / モデル ID の解決と unmatched / 3 状態 / generatedAt 据え置き / 安全弁 / 表の機能列 / 列ピッカー / セル表記 / 脚注 / 詳細パネル / Error Case: カード無し・features 空 / 定期 PR / workflow の権限）、AC Coverage。内容は設計の 3〜5 節から写す
- `decisions.md` の先頭（D-014 の上）に D-016（定期 PR で更新）と D-015（取得元を英語版 docs の `.md`）。形式は D-009 と同じ（Context / Options / AI Recommendation / Decision / Reason / Refs）。Options に「API（無い）」「HTML の scrape」「サードパーティ DB（models.dev / LiteLLM。Sonnet 5.5 の structured outputs で docs と食い違う実例）」「手書き転記（mantle.json 方式）」を挙げる。Decision 日付は 2026-10-06、オーナー承認
- `spec-table.md` v10（AC-006 の列構成に機能列、AC-016 機能列）、`spec-detail.md`（機能の節）、`spec-share.md`（AC-014 `cols`）の版上げ。既存 AC は消さず追記
- `CLAUDE.md`: 構成の木に新ファイル、「データ更新」に「機能表の取り直し方 (FEATURE-001 / D-015)」節（コマンド・`--from-raw`・対応表の直し方・安全弁・サンドボックス注意）。`README.md` の「データ更新」と「特徴」に 1〜2 行
- [ ] Step 1: 書く → `npm test` PASS（docs を読むテストがあれば）→ commit `docs: FEATURE-001 と D-015 / D-016`

### Task 8 (lead): 統合と動作確認

- [ ] `npm test` / `npm run build` が通る
- [ ] `npm run preview` を Playwright で開き、東京で既定 4 列が出る・ピッカーで列を増やすと URL に `cols=` が載る・Sonnet 5.5 の詳細に機能節が出る（スクショを `data/raw/` 外の一時ディレクトリに保存）
- [ ] fork（または push 権限があれば本体）に push し、`workflow_dispatch` で `refresh-features` を実行。差分なしで「no changes」、`data/features.json` を 1 行壊した状態で差分 PR が作られることを確認（確認後その PR は閉じる）
- [ ] 本体へ PR を作成
