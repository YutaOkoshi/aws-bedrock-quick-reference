# モデル別 Capabilities and Features の取り込み 設計

- 作成: 2026-10-06
- 状態: 承認済み（brainstorming で全節承認）
- 関連: PRICE-001 / D-009（同じ「認証なしの公開配信を取り込む」形を踏襲する）

## 1. 目的

公式 docs のモデルカードにある **Capabilities and Features**（Guardrails / Prompt caching /
Structured outputs / Tool calling などの対応可否）を、モデルごとに表と詳細パネルで見られるようにする。
docs は頻繁に変わるので、手で転記せず **定期的に機械取得して差分を PR にする**。

答えたい問い: 「このモデルは `bedrock-runtime` / `bedrock-mantle` のそれぞれで、どの機能が使えるか」。

## 2. 根拠にした事実（2026-10-06 に確認）

- 機能の対応可否を返す API は無い。`ListFoundationModels` / `GetFoundationModel` が返すのは
  モダリティ・`responseStreamingSupported`・`customizationsSupported`・`inferenceTypesSupported`・
  ライフサイクルだけ（us-east-1 で実際に呼んで確認。botocore の bedrock 108 操作・
  bedrock-runtime 11 操作にも該当なし）。Pricing の `index.json` に当たる機械可読の配信も無い。
- docs の各ページは `.html` を `.md` に替えると `text/markdown` で取れる（認証不要、
  `Last-Modified` / `ETag` 付き）。全ページは `https://docs.aws.amazon.com/bedrock/latest/userguide/toc-contents.json`
  で列挙できる。モデルカードは `model-card-*.html` の 134 本。
- 134 本中 116 本に `## Capabilities and Features` 節がある。中身は
  - `**Features supported using \`bedrock-runtime\` endpoint**` と同 `bedrock-mantle` の 2 表。
    各表は Supported / Not Supported の 2 セルで、項目は `icon-yes.png` / `icon-no.png` の画像 + `[機能名](リンク)`
  - `**Implicit and Explicit Prompt Caching ...**` の表（Explicit 対応 / Min tokens per checkpoint /
    Max checkpoints per request / Supported TTL / Fields）
  - `**Computer use ...**` の表（Tool type / Beta header）
- 機能名は表記が揺れる（`Knowledge base` / `Knowledge Bases`、`Structured outputs` /
  `Structured outputs (JSON Schema; see API configuration)`、`Server-side tool calling` / `Server-side tool use` など。
  観測 26 種）。
- モデル ID は `## Programmatic Access` 表の `bedrock-runtime` 行の **Model ID** 列にある。
  `N/A` のカード（Claude Haiku 4.5）は同じ行の Geo / Global inference ID から接頭辞を外すと引ける。
  これで `data/models.json` の 142 モデル中 129 が引けた（残りは docs にカードが無い旧モデル等）。
  文脈長違いの ID（`amazon.nova-2-lite-v1:0:256k`）は `<カードの ID>:` の前方一致で引ける。
- 一次情報は **英語版の公式 docs**。日本語版は翻訳の遅れがあるので使わない。

## 3. データ取得

既存の価格取得（`scripts/fetch-bedrock-prices.mjs` + `scripts/lib/prices.mjs`）と同じ分け方にする。

- `scripts/lib/features.mjs` — パースと正規化。**純関数**（I/O・時刻・ネットワークを持たない）
- `scripts/fetch-bedrock-features.mjs` — 引数・fetch・ファイル書き出しだけを持つ CLI

```
node scripts/fetch-bedrock-features.mjs [--date YYYY-MM-DD] [--dry-run]
node scripts/fetch-bedrock-features.mjs --from-raw YYYY-MM-DD
```

- `toc-contents.json` から `model-card-*.html` を列挙し、各 `.md` を `Accept-Language: en-US` で取る。
  同時実行は 4 本まで
- 生データは `data/raw/<日付>/features/toc-contents.json` と `<カード名>.md`（gitignore 対象）。
  `--from-raw` はネットワークを使わずに作り直す
- 1 本の取得失敗で全体を止めない。失敗したカードは `failedCards` に数える
- 出力は `data/features.json`（生成物・手編集禁止）

```jsonc
{
  "generatedAt": "2026-10-06T00:00:00.000Z",   // 内容が変わったときだけ更新する
  "source": "https://docs.aws.amazon.com/bedrock/latest/userguide/toc-contents.json",
  "cards": 134, "cardsWithFeatures": 116, "failedCards": 0,
  "features": { "<featureKey>": { "label": "Guardrails", "docs": "guardrails.html" } },
  "byModel": {
    "anthropic.claude-sonnet-5-5": {
      "card": "model-card-anthropic-claude-sonnet-5-5.html",
      "runtime": { "guardrails": true, "structuredOutputs": false },
      "mantle":  { "guardrails": false, "countTokens": true },   // 表が無ければ null
      "promptCaching": { "explicit": true, "minTokens": "512", "maxCheckpoints": "4",
                          "ttl": "5 minutes, 1 hour", "fields": "system, messages, and tools" },
      "computerUse": [{ "toolType": "computer_20251124", "betaHeader": "computer-use-2025-11-24" }]
    }
  },
  "unmatchedCards": [{ "card": "...", "modelId": "..." }],
  "unknownFeatures": ["<docs の機能名>"]
}
```

- 値は **true（Supported）/ false（Not Supported）/ キーなし（記載なし）** の 3 状態。
  「提供なし」と「データなし」を区別する既存方針（D-003）に合わせる
- `promptCaching` / `computerUse` の値は docs の文字列のまま持つ（数値化しない。`N/A` や範囲表記がありうる）
- **`generatedAt` は内容（`generatedAt` を除く全体）が前回と同じなら据え置く。** 定期実行で空の差分を作らないため

### 3.1 手書きの対応表（price-model-map と同じ規約）

- `data/feature-names.json` — docs の機能名 → 正規化キー、キーごとの表示名、既定で表に出す列

  ```jsonc
  {
    "names": { "Knowledge base": "knowledgeBase", "Knowledge Bases": "knowledgeBase", ... },
    "defaultColumns": "all"   // 全機能。features.json には全キーの配列に展開して書く
  }
  ```

  **対応表に無い機能名は推測で寄せない。** 名前から機械的に作ったキー（`unknown:<slug>`）で
  `features` に載せ、表示名は docs の英語名のまま出し、`unknownFeatures` に数える。
  新しい機能は自動で画面に出て、寄せるかどうかはメンテナが PR で判断する
- `data/feature-model-map.json` — 自動で引けないカード → モデル ID の配列。値 `null` は
  「`models.json` に該当なしを確認済み」で、`unmatchedCards` に数えない
- モデル ID の決め方: (1) 対応表 (2) Programmatic Access の Model ID 列 (3) 同じ行の Geo / Global
  inference ID から接頭辞（最初の `.` まで）を外したもの。`models.json` の ID と完全一致か `<ID>:` 前方一致で引く。
  引けなければ `unmatchedCards` に残す

### 3.2 安全弁

`cardsWithFeatures` が前回の `data/features.json` の半分未満になったら、書き出さずに終了コード 1 で終わる。
docs の書式が変わってパースが空振りしたときに、全データを消す PR を作らないため。

## 4. 画面

### 4.1 表の機能列

- 列の並び: プロバイダ / モデル名 / モダリティ / In-Region / Geo / Global / 入力 $/1M / 出力 $/1M / **機能列…**
- 既定の列は**全機能**（`defaultColumns: "all"`。`unknown:<slug>` を含む。2026-10-06 時点で 23 列）。
  モバイル幅での見やすさは考慮しない（2026-10-06 ユーザー指示で 4 列から変更）
- 表の上の「機能の列」ピッカーで、`features` の全キーから表に出す列を選べる（チェックボックスの一覧）
- セルは `runtime ✓ / mantle ✕` のように両方を並べる。記載なしの側は「—」。
  両方とも記載なし（カードが無い等）なら「—」1 つ
- 並べ替え可能。順序は runtime（✓ > ✕ > 記載なし）、同順なら mantle
- 列見出しは docs の英語名。**ja / en のどちらでも機能名は訳さない**（訳すと解釈が入る）
- 脚注に出典（docs のモデルカード）と `generatedAt` を出す

### 4.2 URL（SHARE-001 に追加）

- `cols=<key>,<key>` に選んだ機能列を載せる。既定と同じなら省く。`cols=` （空）は「機能列なし」
- 未知のキーは AC-008 と同じく無視して通知する

### 4.3 詳細パネル（DETAIL-001 に追加）

- 価格の下に **機能** の節
  - 機能 × `bedrock-runtime` / `bedrock-mantle` の表（✓ / ✕ / —）。行は `features` の順
  - Prompt caching の表（docs の値のまま）、Computer use の表（あれば）
  - docs のモデルカードへのリンク
- `byModel` にモデルが無ければ「公式 docs のモデルカードに機能の記載がありません」と出す。例外で止めない

## 5. 定期実行（GitHub Actions）

`.github/workflows/refresh-features.yml`

- `schedule`（毎日 UTC 21:00 = JST 06:00）と `workflow_dispatch`
- 手順: checkout → setup-node 22 → `npm ci` → `node scripts/fetch-bedrock-features.mjs` → `npm test` →
  `data/features.json` に差分があれば、固定ブランチ `bot/refresh-features` に commit して force push し、
  `gh pr create`（既に開いていれば本文だけ `gh pr edit`）
- PR 本文は CLI が `data/raw/<日付>/features/summary.md` に書く（モデルごとの機能の増減、
  `unknownFeatures`、`unmatchedCards`）
- `permissions` は `contents: write` と `pull-requests: write` だけ。**AWS の認証要素は持たない**（D-002）
- 前提: リポジトリ設定 *Allow GitHub Actions to create and approve pull requests* を有効にする（オーナー作業）
- GITHUB_TOKEN で作った PR は他の workflow を起動しないが、テストはこの job の中で走らせ済み。
  公開は従来どおり main への merge で `deploy.yml` が行う

## 6. テスト

- `tests/features.test.js`（node）: fixture のカード 5 本（Sonnet 5.5 / 機能節なし / Haiku 4.5 の `N/A` /
  表記揺れ / 文脈長違い）でパース・正規化・ID 解決・未知の機能名・安全弁・`generatedAt` 据え置き
- `tests/fetch-bedrock-features.test.js`（node）: 引数解析と `--from-raw`
- `tests/feature-render.test.js`（jsdom）: 機能列・ピッカー・セルの 3 状態・並べ替え・詳細パネル・データ無し
- `tests/url-state.test.js` に `cols=` を追加
- `tests/refresh-features-workflow.test.js`（node）: 権限・トリガー・AWS 認証要素が無いこと
  （`deploy-workflow.test.js` の極小 YAML パーサを再利用）

## 7. ドキュメント

- `docs/apd/spec-features.md`（FEATURE-001）を新設
- `docs/apd/decisions.md` に D-015（取得元を英語版 docs の `.md` にする）と D-016（定期 PR で更新する）
- `spec-table.md` / `spec-detail.md` / `spec-share.md` の版を上げる。`CLAUDE.md` と `README.md` にデータ更新手順を追記

## 8. 範囲外

- Model Details の値（Context window / Max output / Reasoning / Knowledge cutoff）
- 機能での絞り込み（列ピッカーとは別機能）
- 日本語版 docs
- 判定データ（`models.json` 等）の自動取得。従来どおり手元の SSO で行う
