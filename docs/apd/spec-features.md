---
spec_id: "FEATURE-001"
context: "features"
version: 1
issue_ref: null
title: "公式 docs のモデルカードにある機能表の取り込みと、表・詳細パネルでの表示"
decision_refs:
  - D-015
  - D-016
  - D-009
  - D-003
---

## User Story

**As a** Bedrock のモデルを選ぼうとしている開発者・アーキテクト
**I want** モデルごとに、`bedrock-runtime` / `bedrock-mantle` のそれぞれで Guardrails / Prompt caching / Structured outputs / Tool calling などの機能が使えるかを、比較表の列と詳細パネルで見たい
**So that** モデルカードを一枚ずつ開かずに「このモデルはこの接続先で、どの機能が使えるか」に答えられる

機能の対応可否を返す API も機械可読の配信も無いため、英語版の公式 docs のモデルカード（`.md`）を機械取得して正規化する（D-015）。
docs は頻繁に変わるので、手で転記せず **毎日取り直して差分を PR にする**（D-016）。

## Acceptance Criteria

### AC-001 (取得対象)
- **Given**: `https://docs.aws.amazon.com/bedrock/latest/userguide/toc-contents.json` が取得できる
- **When**: `node scripts/fetch-bedrock-features.mjs` を実行する
- **Then**: `toc-contents.json` を再帰でたどり、`href` が `model-card-*.html` のページを重複なしで列挙して、各ページの `.html` を `.md` に替えた URL を取得する（2026-10-06 時点で 134 本）
  - リクエストには `Accept-Language: en-US` を付ける。**英語版の docs だけを使い、日本語版は使わない**（翻訳の遅れがあるため。D-015）
  - 同時実行は 4 本まで
  - `--date YYYY-MM-DD` で `data/raw/<日付>/` の日付を上書きできる。既定は JST の今日
  - `--dry-run` は取得と生データの保存だけ行い `data/features.json` を書かない
  - 1 本の取得に失敗しても全体を止めない。失敗したカードは `failedCards` に数える
  - 不明な引数は例外にする

### AC-002 (生データの保存と再正規化)
- **Given**: AC-001 の取得が走っている
- **When**: 1 ファイル取得するたびに
- **Then**: `data/raw/<日付>/features/toc-contents.json` と `data/raw/<日付>/features/<カード名>.md` に保存する。このディレクトリは gitignore 対象で、リポジトリには入らない
- **And**: `--from-raw YYYY-MM-DD` を指定すると、ネットワークを一切使わずに `data/raw/<日付>/features/` から `data/features.json` を作り直せる（パースの規則や対応表を直したときの経路）
- **And**: 機能の増減の要約を `data/raw/<日付>/features/summary.md` に常に書く（AC-015 の PR 本文になる）

### AC-003 (パースと正規化は純関数)
- **Given**: `scripts/lib/features.mjs`
- **When**: そのモジュールを読む
- **Then**: I/O・時刻・ネットワークを一切持たない。取得日時は呼び出し側が渡す。ファイルの取得と書き出しは `scripts/fetch-bedrock-features.mjs` だけが行う（`prices.mjs` / `fetch-bedrock-prices.mjs` と同じ分け方、D-001 / D-009）

### AC-004 (機能表のパースと機能名の正規化)
- **Given**: モデルカードの `## Capabilities and Features` 節（2026-10-06 の取得で 134 本中 118 本にある）
- **When**: パースする
- **Then**: 次の 4 つの表を読む
  - 太字見出し「Features supported using `bedrock-runtime` endpoint」の直後の表 → `runtime`、同 `bedrock-mantle` → `mantle`。各セルを `<br />` で割り、`icon-yes.png` を true、`icon-no.png` を false とし、機能名は `[名前](リンク)` の名前
  - `Prompt Caching` を含む太字見出しの直後の表 → `promptCaching`（Explicit 対応 / Min tokens per checkpoint / Max checkpoints per request / Supported TTL / Fields）
  - `Computer use` を含む太字見出しの直後の表 → `computerUse`（Tool type / Beta header の行の配列）
- **And**: docs の機能名は表記が揺れる（`Knowledge base` / `Knowledge Bases`、`Structured outputs` / `Structured outputs (JSON Schema; see API configuration)` など）。手書きの `data/feature-names.json` の `names` で正規化キーに寄せ、キーごとの表示名を `labels`、既定で表に出す列を `defaultColumns` に持つ
- **And**: **対応表に無い機能名は推測で寄せない。** 名前から機械的に作ったキー `unknown:<slug>` で `features` に載せ、表示名は docs の英語名のまま、`unknownFeatures` に docs の名前を数える。新しい機能は自動で画面に出て、寄せるかどうかはメンテナが PR で判断する

### AC-005 (モデル ID の解決)
- **Given**: パースしたカード
- **When**: `data/models.json` のモデル ID に結びつける
- **Then**: 次の順で候補を作り、`models.json` の ID と**完全一致**か **`<候補>:` の前方一致**で引く。最初に 1 件以上当たった段で確定する
  1. 手書きの `data/feature-model-map.json` にカードの鍵があればその ID の配列
  2. `## Programmatic Access` 表の `bedrock-runtime` 行の **Model ID** 列（他の節の `| bedrock-runtime |` 行は拾わない）
  3. Model ID が `N/A` のカード（Claude Haiku 4.5 など）は、同じ行の Geo / Global inference ID から接頭辞（最初の `.` まで）を外したもの
- **And**: 前方一致で、文脈長違いの ID（`amazon.nova-2-lite-v1:0` に対する `amazon.nova-2-lite-v1:0:256k`）にも同じ機能表が入る
- **And**: どの段でも引けないカードは `byModel` に入らず `unmatchedCards` に `{ card, modelId }` で残る。複数のカードが同じ ID に当たったときは後勝ちにせず、`unmatchedCards` に `reason: "duplicate"` で積む
- **And**: `feature-model-map.json` の値に `null` と書いた鍵は「`models.json` に該当なしを確認済み」の意味で、`unmatchedCards` に数えない
- **And**: 2026-10-06 の取得では 110 モデルが `byModel` に入り、`unmatchedCards` は 24 件。内訳は `models.json` に未収録の新モデル 15 件と、`bedrock-runtime` の Model ID を持たない mantle 専用カード 9 件。**どちらも `models.json` を取り直せば自動で引けるので、`feature-model-map.json` に `null` は書かない**

### AC-006 (値は 3 状態)
- **Given**: 正規化キー K、モデル M の `runtime` / `mantle`
- **When**: `data/features.json` に書く
- **Then**: 値は **true（Supported）/ false（Not Supported）/ キーなし（記載なし）** の 3 状態。表そのものが無い側（mantle の表が無いカードなど）は `null`
- **And**: **「記載なし」を false に倒さない。**「提供なし」と「データなし」を区別する既存方針（D-003）に合わせる
- **And**: `promptCaching` / `computerUse` の値は docs の文字列のまま持つ（数値化しない。`N/A` や範囲表記がありうる）

### AC-007 (内容が同じなら generatedAt を据え置く)
- **Given**: 既存の `data/features.json`（`previous`）がある
- **When**: 作り直した結果が `generatedAt` を除いて `previous` と同じ
- **Then**: `generatedAt` は `previous.generatedAt` のまま。内容が変わったときだけ新しい取得日時になる
- **And**: これで定期実行（AC-015）が空の差分を作らない

### AC-008 (Error Case: パースの空振りを書き出さない安全弁)
- **Given**: 既存の `data/features.json` の `cardsWithFeatures` が N
- **When**: 新しい結果の `cardsWithFeatures` が N の半分未満
- **Then**: `data/features.json` を書き出さず、stderr に理由を書いて終了コード 1 で終わる
- **And**: docs の書式が変わってパースが空振りしたときに、全データを消す PR を作らないため

### AC-009 (表の機能列)
- **Given**: 起点リージョン R で表が描画されている
- **When**: 列を見る
- **Then**: **価格 2 列（入力 $/1M / 出力 $/1M）の右**に機能列が並ぶ。既定は `defaultColumns` の 4 列（Explicit Prompt Caching / Structured outputs / Client-side tool calling / Guardrails）で、`features` に在るものだけ
  - 列見出しは **docs の英語名**。**ja / en のどちらでも機能名は訳さない**（訳すと解釈が入る）
  - 並べ替えられる。順序は runtime（✓ > ✕ > 記載なし）、同順なら mantle（同じ順）
  - 機能列は判定（In-Region / Geo / Global）にも絞り込みにも影響しない。機能での絞り込みはこの仕様の範囲外

### AC-010 (機能の列ピッカー)
- **Given**: 表が描画されている
- **When**: 表の上の「機能の列」を開く
- **Then**: `features` の全キーがチェックボックスの一覧で並び（`features` の順）、チェックした列が表に出る。既定の列に戻す操作がある
- **And**: 選んだ列は URL の `cols=` に載る（SHARE-001 AC-014）

### AC-011 (セルの表記)
- **Given**: 機能列のセル
- **When**: 描画する
- **Then**: `runtime ✓ / mantle ✕` のように両方の接続先を並べる。記載なしの側は「—」。両方とも記載なし（カードが無い等）なら「—」1 つ
- **And**: 読み上げ用に「bedrock-runtime: 対応 / bedrock-mantle: 非対応」の形のラベルを持つ（文言は I18N-001 の辞書）

### AC-012 (脚注)
- **Given**: `data/features.json` に中身がある
- **When**: 表の下の脚注を見る
- **Then**: 出典（公式 docs のモデルカード）へのリンクと、`features.json` の `generatedAt` が出る
- **And**: `features.json` が空のときは機能の脚注を出さない

### AC-013 (詳細パネルの機能の節)
- **Given**: 起点リージョン R でモデル M の行を開く
- **When**: 詳細パネルを見る
- **Then**: レーンのタブパネル群の下に **機能** の節が 1 回だけ出る（DETAIL-001 AC-023）。レーンのパネルごとには繰り返さない
  - 機能 × `bedrock-runtime` / `bedrock-mantle` の表（✓ / ✕ / —）。行は `features` の順で、どちらかの側に記載がある機能だけ
  - `promptCaching` があれば Prompt caching の表（docs の値のまま）
  - `computerUse` があれば Computer use の表（Tool type / Beta header）
  - 公式 docs のモデルカードへのリンク
- **And**: 機能の対応可否はモデルと接続先で決まり、起点リージョンとレーンには依らない

### AC-014 (Error Case: カードが無いモデル / features が空)
- **Given**: `features.json.byModel` に M が無い、または `features.json` そのものが空
- **When**: 表と詳細パネルを描画する
- **Then**: 機能列のセルは「—」、詳細パネルは「公式 docs のモデルカードに機能の記載がありません」と出し、**例外で描画が止まらない**。`features.json` が空なら機能列も脚注も出ない。行数・判定・絞り込み・価格は機能データの有無に影響されない

### AC-015 (定期取得と差分の PR)
- **Given**: `.github/workflows/refresh-features.yml`
- **When**: `schedule`（毎日 UTC 21:00 = JST 06:00）または `workflow_dispatch` で起動する
- **Then**: checkout → setup-node 22 → `npm ci` → `node scripts/fetch-bedrock-features.mjs` → `npm test` の順に走り、`data/features.json` に差分があれば固定ブランチ `bot/refresh-features` に commit して force push し、PR を作る（既に開いていれば本文だけ更新する）。差分が無ければ何もしない
  - PR 本文は AC-002 の `summary.md`（モデルごとの機能の増減、`unknownFeatures`、`unmatchedCards`）
  - `npm test` が PR 作成より前にあるので、テストが落ちれば PR は作られない
  - 公開は従来どおり、メンテナが PR を main に merge したときに `deploy.yml` が行う。**docs の変化が自動で公開されることは無い**

### AC-016 (workflow の権限)
- **Given**: `.github/workflows/refresh-features.yml`
- **When**: 中身を読む
- **Then**: `permissions` は `contents: write` と `pull-requests: write` の 2 つだけ。**AWS の認証要素を一切持たない**（`aws-` で始まる action、`AWS_` の env、`role-to-assume` が無い。D-002）
- **And**: 前提として、リポジトリ設定 *Allow GitHub Actions to create and approve pull requests* が有効になっている（オーナー作業。D-016）

## UI Description

- **表**: 価格 2 列の右に機能列（既定 4 列）。見出しは docs の英語名。セルは `runtime ✓ / mantle ✕`、記載なしは「—」
- **列ピッカー**: 表の上、並べ替えの UI の近くに「機能の列」ボタン。開くと `features` の全キーのチェックボックス一覧と「既定に戻す」
- **詳細パネル**: レーンのタブパネル群の下に 1 回だけ「機能（Capabilities and Features）」の節。機能 × 接続先の表 → Prompt caching の表 → Computer use の表 → モデルカードへのリンク
- **脚注**: 既存の脚注の下に、機能表の取得日（`generatedAt`）と出典リンク
- 375px 幅では機能列も表の横スクロールの中に収まる（TABLE-001 AC-NFR-001 の枠組みをそのまま使う）

## Context Boundary

### Inputs
- **From**: 外部（AWS 公式 docs、英語版）— `toc-contents.json` と `model-card-*.md`
- **From**: DATA-001 — `data/models.json`（モデル ID の集合）
- **From**: 手書き — `data/feature-names.json`（機能名 → 正規化キー・表示名・既定の列）、`data/feature-model-map.json`（自動で引けないカード → モデル ID）

### Outputs
- **To**: TABLE-001 — `data/features.json` の `features` / `defaultColumns` / `byModel[M].runtime` / `.mantle` と、脚注に出す `generatedAt`
- **To**: DETAIL-001 — `byModel[M]` の全項目と `card`
- **To**: SHARE-001 — 有効な機能キーの集合と既定の列（`cols=` の検査と省略）
- **To**: メンテナ — `data/raw/<日付>/features/summary.md` と `features.json` の `unmatchedCards` / `unknownFeatures` / `failedCards`

### Dependencies
- **DATA-001**: モデル ID の集合。機能は後から重ねるだけで、判定ルール（D-003）には一切関与しない
- **I18N-001**: ピッカー・セルの読み上げラベル・詳細の節見出し・脚注の文言。**機能名そのものは辞書に置かない**（docs の英語名のまま）

## Test Strategy

### AC Coverage

| AC ID | Test Type | Description |
|-------|-----------|-------------|
| AC-001 | unit (vitest, node) | `listModelCards(toc)` が fixture の `toc-contents.json` から 134 件を重複なし昇順で返すこと、`cardMarkdownUrl` の文字列、`parseFeatureArgs` が既定日付・`--date` / `--from-raw` の形式・不明な引数を扱うことを検証（`tests/features.test.js` / `tests/fetch-bedrock-features.test.js`） |
| AC-002 | unit (vitest, node) | fixture を一時ディレクトリに raw として置き、`buildFromRaw({ rawDir, dataDir })` がネットワークなしで `features.json` を書くことを検証。`.gitignore` に `data/raw/` があること |
| AC-003 | 目視 + 構成 | `features.mjs` が `node:fs` / `fetch` / `Date` を import しないこと（`fetch-bedrock-features.mjs` だけが持つ） |
| AC-004 | unit (vitest, node) | Sonnet 5.5 の fixture で runtime / mantle / promptCaching / computerUse の値、GPT-6 Luna の `Knowledge Bases` が `knowledgeBase` に寄ること、対応表に無い `Foo bar` が `unknown:foo-bar` になり `unknownFeatures` に載ることを検証 |
| AC-005 | unit (vitest, node) | Sonnet 5.5（Model ID 列）、Haiku 4.5（`N/A` → inference ID から接頭辞を外す）、Nova 2 Lite（`:256k` の前方一致で 2 件）、機能節の無い Titan Text Embeddings V2（ID は取れる）の 4 経路を検証 |
| AC-006 | unit (vitest, node) | true / false / キーなし が区別されて出ること、表の無い側が `null` になることを検証 |
| AC-007 | unit (vitest, node) | 同内容の `previous` を渡すと `generatedAt` が据え置かれ、内容が違えば新しい値になることを検証 |
| AC-008 | unit (vitest, node) | `previous.cardsWithFeatures = 100` に対し新しい値 40 で `guardTripped` が true になることを検証 |
| AC-009 | unit + integration (vitest, jsdom) | `defaultFeatureColumns` / `featureSortValue` を検証。描画側で既定 4 列が価格の右に並ぶこと、見出しが ja / en とも docs の英語名であること、並べ替えを検証（`tests/feature-model.test.js` / `tests/feature-render.test.js`） |
| AC-010 | integration (jsdom, vitest) | ピッカーで列を足す・外す・既定に戻すと表の列が追随することを検証 |
| AC-011 | unit + integration (vitest, jsdom) | `featureCell` の 3 状態と、描画された文言（片側「—」・両方記載なしで「—」1 つ）を検証 |
| AC-012 | integration (jsdom, vitest) | 脚注に `generatedAt` と出典リンクが出ること、`features` が空なら出ないことを検証 |
| AC-013 | unit + integration (vitest, jsdom) | `buildFeatureRows` の並びと絞り方を検証。Sonnet 5.5 で Guardrails が runtime ✓ / mantle ✕、Prompt caching の 512、Computer use の行、モデルカードへのリンク先を検証 |
| AC-014 | integration (jsdom, vitest) | `byModel` に無いモデルで「記載がありません」が出ること、`features` が空で列も脚注も出ず例外にならず、行数が変わらないことを検証。取得失敗（カードの値 `null`）が `failedCards` に数えられ例外にならないことを検証（node） |
| AC-015 | unit (vitest, node) | `tests/refresh-features-workflow.test.js` で `on.schedule[0].cron === "0 21 * * *"`、`workflow_dispatch` があること、fetch のステップがあり `npm test` が PR 作成より前にあることを検証 |
| AC-016 | unit (vitest, node) | 同ファイルで `permissions` が `{ contents: "write", "pull-requests": "write" }` と完全一致し、AWS の認証要素が無いことを検証。既存の「どの YAML にも AWS 認証要素が無い」テストが新ファイルも対象にすることを確認 |

## Deliverable Previews

`data/features.json`（形。値は設計 3 節の例）:

```jsonc
{
  "generatedAt": "2026-10-06T00:00:00.000Z",
  "source": "https://docs.aws.amazon.com/bedrock/latest/userguide/toc-contents.json",
  "cards": 134, "cardsWithFeatures": 118, "failedCards": 0,
  "features": { "guardrails": { "label": "Guardrails", "docs": "guardrails.html" } },
  "defaultColumns": ["explicitPromptCaching", "structuredOutputs", "clientToolCalling", "guardrails"],
  "byModel": {
    "anthropic.claude-sonnet-5-5": {
      "card": "model-card-anthropic-claude-sonnet-5-5.html",
      "runtime": { "guardrails": true, "structuredOutputs": false },
      "mantle":  { "guardrails": false, "countTokens": true },
      "promptCaching": { "explicit": true, "minTokens": "512", "maxCheckpoints": "4",
                          "ttl": "5 minutes, 1 hour", "fields": "system, messages, and tools" },
      "computerUse": [{ "toolType": "computer_20251124", "betaHeader": "computer-use-2025-11-24" }]
    }
  },
  "unmatchedCards": [{ "card": "...", "modelId": "..." }],
  "unknownFeatures": []
}
```

- 起点 `ap-northeast-1` で既定 4 列の機能列が出た表のスクリーンショット
- Sonnet 5.5 の詳細パネルの機能の節のスクリーンショット

## 委譲する非機能要件

- **セキュリティレビュー: 不要。** 取得先は認証不要の公開 URL（英語版の公式 docs）で、取り込む値は機能名・対応可否・docs の文字列だけ。workflow は AWS の認証要素を持たず、GitHub の権限は `contents: write` / `pull-requests: write` に限る（AC-016）
- **a11y**: 列ピッカーはチェックボックスの一覧で、Tab で到達し Space で切り替えられることを**手動チェック**で確認する。機能列のセルは AC-011 の読み上げラベルを持つ

## Notes

- 一次情報は**英語版の公式 docs**。日本語版は翻訳の遅れがあるので使わない。サードパーティの DB（models.dev / LiteLLM など）も使わない（D-015）
- 機能名は表記が揺れる。2026-10-06 の取得では docs 上の表記が 26 種で、正規化後のキーは 23。`Server-side tool use` は本文で同じ機能と確認して `serverToolCalling` に寄せ、`Projects (default project only)` は限定を消さないため別キー `projectsDefaultOnly` にした。`unknownFeatures` は 0 件。新しい表記は `unknown:<slug>` として自動で画面に出るので、`summary.md` の `unknownFeatures` を見て `feature-names.json` に寄せるかをメンテナが判断する
- 範囲外: Model Details の値（Context window / Max output / Reasoning / Knowledge cutoff）、機能での絞り込み、日本語版 docs、判定データ（`models.json` 等）の自動取得（従来どおり手元の SSO で行う。D-002）

## 変更履歴

- **version 1** (2026-10-06): 初版。設計 `docs/superpowers/specs/2026-10-06-model-features-design.md`
