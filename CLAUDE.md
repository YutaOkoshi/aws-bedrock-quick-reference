# CLAUDE.md

Amazon Bedrock の **モデル × リージョン × 推論が実際に行われる場所** を 1 つの表で確認できる静的サイト。
公式 docs のモデル別リージョン表にある **In-Region / Geo / Global** の 3 区分を表の中心に置く。

先例は `~/workspace/personal/aws-gpu-quick-reference`。構成・規約はそちらを踏襲する (D-001)。

## 構成

- Vite + vite-plugin-singlefile でビルドし、`dist/index.html` に単一 HTML を出力する
- フレームワーク無しの DOM 描画。`package.json` の `dependencies` は**空のまま**にする (AC-009)
- テストは vitest。DOM を触るテストは jsdom、ファイルを読むテストは先頭に
  `// @vitest-environment node` を書いて node 環境で走らせる
- **実データ (`data/*.json`) を読むテストに件数・モデル名・単価の固定値を書かない**。取り直しで変わるので、
  性質 (行数がビューモデルと一致、並びが日時の降順、価格の無いモデルはどのリージョンにも単価が無い、
  確かめた件数が 0 より多い など) で確かめる。固定値は fixture (`tests/fixtures/`) を使うテストに書く (2026-10-08)

```
data/
├── region-notes.json   # 手書き。対象リージョンの正 (ja/en/optIn/endpoint/country/geo)
├── overrides.json      # 手書き。モデル ID / プロファイル ID ごとの備考 (ja/en)
├── mantle.json         # 手書き。bedrock-mantle の提供リージョンと対応モデル (D-010)
├── price-model-map.json # 手書き。価格表のモデル名 → モデル ID (D-009)
├── marketplace-prices.json # 生成物。手編集禁止。Marketplace の offer の単価 (D-018)
├── feature-names.json  # 手書き。docs の機能名 → 正規化キー・表示名・既定の列 (D-015)
├── feature-model-map.json # 手書き。自動で引けないモデルカード → モデル ID (D-015)
├── models.json         # 生成物。手編集禁止
├── profiles.json       # 生成物。手編集禁止
├── fetch-log.json      # 生成物。手編集禁止
├── prices.json         # 生成物。手編集禁止
├── features.json       # 生成物。手編集禁止 (FEATURE-001)
└── raw/<日付>/         # 取得した生 JSON と stderr。gitignore 対象
scripts/
├── fetch-bedrock-snapshot.mjs  # 薄い CLI。引数を読んで lib/ を呼ぶだけ
├── fetch-bedrock-prices.mjs    # 価格の CLI。引数・fetch・書き出しだけを持つ
├── fetch-bedrock-marketplace-prices.mjs # Marketplace の offer の CLI (SSO 必須。D-018)
├── fetch-bedrock-features.mjs  # 機能表の CLI。同上
└── lib/
    ├── cli-args.mjs    # 引数解析 (純関数)
    ├── normalize.mjs   # 正規化 (純関数。I/O・時刻・ネットワークを持たない)
    ├── prices.mjs      # 価格の正規化 (純関数。同上)
    ├── marketplace-prices.mjs # Marketplace の rateCard の正規化 (純関数。同上)
    ├── features.mjs    # モデルカードのパースと機能表の正規化 (純関数。同上)
    ├── aws-cli.mjs     # aws を子プロセスで起動する唯一のモジュール
    └── snapshot.mjs    # 取得の段取りとファイル書き出し (唯一の I/O 層)
src/
├── index.html
└── scripts/main.js
tests/
├── normalize.test.js
├── fetch-bedrock-snapshot.test.js
├── prices.test.js          # 価格の正規化 (node 環境)
├── price-render.test.js    # 価格列・Global の単価・詳細の価格 (jsdom)
├── features.test.js        # モデルカードのパースと機能表の正規化 (node 環境)
├── fetch-bedrock-features.test.js # 機能表の CLI の引数と --from-raw (node 環境)
├── feature-model.test.js   # 機能列の純関数
├── feature-render.test.js  # 機能列・列ピッカー・詳細の機能の節 (jsdom)
├── refresh-features-workflow.test.js # 定期取得 workflow の権限とトリガー (node 環境)
├── pr-preview-workflow.test.js # PR プレビュー workflow の権限とトリガー (node 環境)
├── helpers/mini-yaml.js    # workflow のテストが使う極小 YAML パーサ
├── no-runtime-deps.test.js
├── fixtures/bedrock/   # spike 出力を 5 モデル・4 プロファイルに間引いた固定入力
├── fixtures/prices/    # 東京の価格表を 20 SKU に間引いた固定入力
└── fixtures/features/  # モデルカード 5 本と toc-contents.json の固定入力
.github/workflows/
├── deploy.yml              # main への push で test → build → GitHub Pages
├── refresh-features.yml    # 週 1 回 docs から機能表を取り直し、差分を PR にする (D-016)
└── pr-preview.yml          # main 向けの PR で test → build し、dist/index.html を artifact に添付する
```

### 開発コマンド

- `npm run dev` — Vite 開発サーバー
- `npm run build` — `dist/index.html` に単一 HTML を出力
- `npm run preview` — ビルド結果のプレビュー
- `npm test` — vitest で単体・結合テスト

## データ更新

### 生成物は手で書かない

`data/models.json` / `data/profiles.json` / `data/fetch-log.json` は
`scripts/fetch-bedrock-snapshot.mjs` の、`data/prices.json` は
`scripts/fetch-bedrock-prices.mjs` の、`data/features.json` は
`scripts/fetch-bedrock-features.mjs` の出力。**手編集は禁止**。値が間違っていると思ったら、
生成物ではなく取得スクリプトか `data/region-notes.json` を直してから取り直す。
表示上の補足を足したいときは `data/overrides.json` に書く。

### 取り直し方

手元の SSO で手動実行する。CI に AWS 認証情報は置かない (D-002)。

```
aws sso login --profile <名前>
node scripts/fetch-bedrock-snapshot.mjs --profile <名前> --account-kind sandbox
```

- `--profile` と `--account-kind` は必須。`--account-kind` は `fetch-log.json` に載る
  表示用の種別で、アカウント ID は記録しない (AC-011)
- `--regions a,b` で対象を絞れる。省くと `data/region-notes.json` のキー全件 (33 リージョン)
- `--date YYYY-MM-DD` で `data/raw/<日付>/` の日付を上書きできる。既定は JST の今日
- `--dry-run` は取得と生データの保存だけ行い、`data/*.json` を書かない
- 正規化の規則を変えたときは、取り直さずに `data/raw/<日付>/` から作り直せる。`aws` は呼ばない:

  ```
  node scripts/fetch-bedrock-snapshot.mjs --from-raw 2026-09-14 --account-kind sandbox
  ```

  `--from-raw` では `--profile` は要らない（`--account-kind` は必須）。既存の
  `fetch-log.json` に `generatedAt` があれば、取得し直していないのでその値を引き継ぐ
- 更新のタイミングは新しいモデルや推論プロファイルが出たとき。取得日時を画面に出すので、
  古さは読み手が判断できる

`aws` CLI は SSO のトークンキャッシュを書くので、エージェントから実行するときは
Bash のサンドボックスを外す必要がある。

### 価格の取り直し方 (PRICE-001 / D-009)

Price List の JSON の構造と、Bedrock の価格表での書き方 (usagetype・unit の揺れ、検証のしかた) は
`docs/price-list-api.md` にまとめてある。読み方を変える前に読む。

Price List に bedrock-runtime の単価が無いモデルは、AWS Marketplace の offer の単価で補う (D-018)。
こちらは**認証が要る**ので、Price List の取り直しの前に手元の SSO で走らせる:

```
node scripts/fetch-bedrock-marketplace-prices.mjs --profile <名前>
node scripts/fetch-bedrock-prices.mjs
```

`aws` を呼ぶので、エージェントから実行するときは Bash のサンドボックスを外す。Marketplace 経由でないモデルは
`Agreement not supported for this model` になり、数えるだけで失敗にしない。

価格は AWS Price List Bulk API から取る。**認証は要らない**ので `aws sso login` も
`--profile` も不要。判定データ (`models.json` 等) を取り直した後に走らせる。

```
node scripts/fetch-bedrock-prices.mjs
```

- 対象リージョンは `data/fetch-log.json` の `status: "ok"` 全件 (現在 17)。
  `--regions a,b` で絞れる
- `--date YYYY-MM-DD` で `data/raw/<日付>/` の日付を上書きできる。既定は JST の今日
- `--dry-run` は取得と生データの保存だけ行い `data/prices.json` を書かない
- 生 JSON は `data/raw/<日付>/prices-<offer>-<region>.json` (gitignore 対象)。
  正規化の規則や対応表を変えたときは、取り直さずに作り直せる:

  ```
  node scripts/fetch-bedrock-prices.mjs --from-raw 2026-09-14
  ```

- **Node の組み込み `fetch` を使うので、エージェントから実行するときは Bash の
  サンドボックスを外す必要がある** (サンドボックス下では `fetch failed` になる)。
  `curl` は通るが、スクリプトは `fetch` で取る
- 単価はすべて **USD / 100 万トークン**に揃う。`AmazonBedrock` の `1K tokens` は 1000 倍、
  `AmazonBedrockFoundationModels` の `1M tokens` はそのまま
- 取り込むのは 2 offer (`AmazonBedrock` / `AmazonBedrockFoundationModels`)。
  `AmazonBedrockService` と `AmazonBedrockAgentCore` はトークン単価を持たないので対象外
- **価格は Price List を優先し、手書きの補完 JSON は作らない**。Price List に bedrock-runtime の単価が無いモデルは
  Marketplace の offer で補い出典を出す (D-018)。それでも無いモデルは「価格未収録」と docs のリンクにし、
  なぜ無いかは生 JSON の全文検索で確かめる (Marketplace 製品は掲載が遅れることがある)。`-mantle-` の SKU は
  `byModel[M][R].mantle` に Runtime と分けて入れ (D-017)、`long_ctx` は `longContext` として読む
  (spec-price.md の「Price List の書き方の揺れ」)。価格のあるモデルが前回の半分未満なら書き出さずに失敗する

#### price-model-map.json を直すとき

価格表のモデル名と `models.json` の `name` は一致しないことがある
(`Claude Opus 5 (Amazon Bedrock Edition)` / `NVIDIA Nemotron Nano 2 VL` / `Gemma 3 12B` など)。
自動一致 (接尾辞 `(Amazon Bedrock Edition)` を外して大文字小文字・記号を無視した比較) で
当たらない名前だけをこの手書きファイルに書く。

- 実行後に `data/prices.json` の `unmapped` が 0 でなければ、
  `data/raw/<日付>/prices-unmapped.json` を開いて名前を確認し、地図に足す。
  **推測で結び付けない。** `models.json` に該当が無いと確認できたものは値を `null` にする
  (`unmapped` ではなく `ignored` に数えられる)
- 地図を直したら `--from-raw <日付>` で作り直す。取り直しは要らない
- `model` 属性を持たない SKU (Titan 系) の鍵は `usagetype:<token>` の形

### 機能表の取り直し方 (FEATURE-001 / D-015)

機能表 (`data/features.json`) は英語版の公式 docs のモデルカード (`model-card-*.md`) から取る。
**認証は要らない**。機能の対応可否を返す API は無く、日本語版 docs とサードパーティの DB
(models.dev / LiteLLM など) は使わない。通常は GitHub Actions が週 1 回取り直して差分を PR に
するので (D-016)、手で走らせるのは対応表を直したときや PR の中身を確かめたいとき。

```
node scripts/fetch-bedrock-features.mjs
```

- `toc-contents.json` から `model-card-*.html` を列挙し、各ページの `.md` を
  `Accept-Language: en-US` で取る (同時 4 本)。1 本の失敗で全体を止めず `failedCards` に数える
- `--date YYYY-MM-DD` で `data/raw/<日付>/` の日付を上書きできる。既定は JST の今日
- `--dry-run` は取得と生データの保存だけ行い `data/features.json` を書かない
- 生データは `data/raw/<日付>/features/` (`toc-contents.json` と `<カード名>.md`、gitignore 対象)。
  機能の増減の要約は同じ場所の `summary.md` に書かれ、定期実行の PR 本文になる。
  パースの規則や対応表を変えたときは、取り直さずに作り直せる:

  ```
  node scripts/fetch-bedrock-features.mjs --from-raw 2026-10-06
  ```

- 内容が前回と同じなら `generatedAt` は据え置かれる (空の差分を作らない)
- 機能一覧に `Explicit Prompt Caching` が無いカードは、Prompt caching の表の見出しにある接続先に限って
  `Explicit Prompt Caching supported` の値で補う (見出しに接続先が無ければ補わない。一覧の値を優先し、
  食い違いは summary の Conflicts に出す。Implicit は補わない。FEATURE-001 AC-017)
- **安全弁**: `cardsWithFeatures` が前回の `data/features.json` の半分未満になったら、
  書き出さずに終了コード 1 で終わる。docs の書式が変わってパースが空振りした兆候なので、
  `data/raw/<日付>/features/` の `.md` を開いて書式の変化を確かめ、パーサ
  (`scripts/lib/features.mjs`) を直してから `--from-raw` で作り直す
- **Node の組み込み `fetch` を使うので、エージェントから実行するときは Bash の
  サンドボックスを外す必要がある** (サンドボックス下では `fetch failed` になる)

#### feature-names.json / feature-model-map.json を直すとき

- 実行後に `data/features.json` の `unknownFeatures` が空でなければ、docs に対応表に無い
  機能名が出ている。画面には `unknown:<slug>` のキーで docs の英語名のまま出ている。
  該当カードの本文を読んで既存の機能と同じものを指すと確認できたときだけ
  `feature-names.json` の `names` に寄せる。新しい機能なら `labels` にキーと表示名を足す。
  **推測で寄せない**。限定の付いた表記 (`Projects (default project only)`) は限定を消さないよう
  別キー (`projectsDefaultOnly`) にする。2026-10-06 の取得では docs 上 26 種 → 正規化後 23 キー
- `unmatchedCards` に残ったカードは、`models.json` の ID に自動で引けなかったもの。
  docs の本文で ID を確かめたものだけ `feature-model-map.json` にカード名 → ID の配列で足す。
  `models.json` に該当が無いと確認できたものは値を `null` にする (`unmatchedCards` に数えない)。
  ただし **`models.json` に未収録の新モデルと、`bedrock-runtime` の Model ID を持たない mantle 専用カードには
  `null` を書かない**。`models.json` を取り直せば自動で引けるため
  (2026-10-06 の取得では unmatched 24 件 = 新モデル 15 + mantle 専用 9)
- 既定で表に出す列は `feature-names.json` の `defaultColumns`。現在は `"all"` (全機能、unknown を含む。
  2026-10-06 時点で 23 列) で、`features.json` には全キーの配列に展開されて書かれる
- 直したら `--from-raw <日付>` で作り直す。取り直しは要らない

#### 定期実行 (D-016)

`.github/workflows/refresh-features.yml` が毎週日曜 UTC 21:00 (月曜 JST 06:00) と `workflow_dispatch` で
走り、`npm test` の後、`data/features.json` に差分があれば固定ブランチ `bot/refresh-features`
に force push して PR を作る (既に開いていれば本文だけ更新)。公開は PR を main に merge した
ときに `deploy.yml` が行う。workflow は AWS の認証要素を持たない (D-002)。

- 前提: リポジトリ設定 *Allow GitHub Actions to create and approve pull requests* が有効
  (オーナー作業。無効だと PR 作成の段で失敗する)
- `bot/refresh-features` は毎回 force push されるので、手でコミットを積まない。
  対応表を直したいときは別のブランチで直す

### denied リージョンは消さない

取得に失敗したリージョンは **`fetch-log.json` に `status: "denied"` と `cause` (取得失敗の分類) を
残したまま**にする。「提供なし」と「データなし」は画面で区別して表示するため、
denied の行を消すと区別が壊れる (D-003)。

- sandbox アカウントは Organizations の SCP で `us-east-1` などが明示 Deny される。これは想定内
- opt-in リージョン (`region-notes.json` の `optIn: true`) を有効化していないアカウントでも失敗する
- 全リージョンを取れるようにするには `bedrock:ListFoundationModels` と
  `bedrock:ListInferenceProfiles` だけを許可した読み取り専用ロールを aws-foundation 側に
  用意する (D-005)。それまでは取れたリージョンだけで公開してよい
- **API のエラー原文は生成物に一切入れない** (D-008)。原文には principal ARN・アカウント ID・
  組織 ID・SCP ポリシー ID・permission set 名・IAM セッション名が入り、生成物は公開リポジトリに
  載って公開サイトにも描画されるため。代わりに `cause` (分類) だけを残す:
  `scp-deny` / `access-denied` / `not-opted-in` / `timeout` / `other`。
  分類は `scripts/lib/normalize.mjs` の `classifyFetchError` が原文から機械的に決める
- 原文を読みたいときは gitignore 対象の `data/raw/<日付>/*.err` を見る。`cause` はメンテナ向けの
  情報なので**画面には出さない**。未取得のリージョンは「未取得」とだけ表示する
  (TABLE-001 v5 AC-009 / DETAIL-001 v5 AC-008)

### mantle.json を直すとき

`bedrock-mantle` の提供リージョンとモデル別の対応は API から取れないので、公式 docs の
Endpoint availability を転記した手書きファイルが正 (D-010)。出典は `_source` の 3 つの URL。
**region-notes.json と同じく、記憶で足さず必ず doc を読んでから転記する。**

- `models` のキーは `models.json` のモデル ID。docs のモデル名は `name` と大文字小文字を
  無視した完全一致で引き、**突き合わなかった名前は推測で結び付けず `_unmatched` に残す**
- `models.json` に無い mantle 専用モデルは `mantleOnly` に docs のモデル名で残す
- `us-gov-west-1` は転記どおり `regions` に残すが、`region-notes.json` に無いので
  起点リージョンとしては選べない

### region-notes.json を直すとき

対象リージョンの列挙はこのファイルが正 (D-004)。出典は `_source` に書いてある 2 つの URL。
**記憶で足さず、必ず doc を読んでから転記する。**

- `geo` は推論プロファイルの接頭辞の地理圏に合わせる
  (`jp` = ap-northeast-1/3、`au` = ap-southeast-2/4/6、`us` / `eu` = 各リージョン、
  それ以外のアジア太平洋が `apac`、どの接頭辞にも属さないものが `other`)
- GovCloud (`us-gov-*`) は `aws-us-gov` パーティションで商用アカウントから呼べないため対象外

## 判定ルール (技術設計 §3)

source region R、モデル M について:

| 列 | 判定 |
|---|---|
| In-Region | R の `models.json[M].availability[R]` が `ON_DEMAND` を含む |
| Geo | `profiles.json` に接頭辞が `global` **以外**で M を対象とし `sources[R]` を持つものがある（接頭辞の固定リストは持たない、D-012） |
| Global | 同じく接頭辞 `global`。destination は API から取れないので `["*"]` で、画面では注記にする |
| 接続先 (セルの下段) | Runtime は上の判定と同じ API。Mantle は `features.json` の `regions["bedrock-mantle"]` (無ければ `shared`)、Programmatic Access に mantle の行が無ければ不可、地域の表が無ければ In-Region だけ `mantle.json`。記載なしは「—」(D-020) |
| docs と相違 | Geo / Global の推論 ID が、`features.json` の `endpoints` (docs のモデルカードの Programmatic Access の bedrock-runtime の行) と食い違う。判定は API のまま変えず、注釈だけ出す (D-019) |
| データなし | `fetch-log.json.regions[R].status` が `denied` |
| 入力 / 出力 $/1M | `prices.json.byModel[M][R].standard` の `input` / `output` (bedrock-runtime)。無ければ「—」。`.mantle` の下は bedrock-mantle の単価で、詳細パネルにだけ出す (D-017) |
| 機能列 | `features.json.byModel[M].runtime[K]` / `.mantle[K]` が true / false / キーなし (記載なし)。記載なしを false に倒さない。起点リージョンには依らない |

`PROVISIONED` は `availability` に保持するが、3 列の判定には使わない。
`inferenceTypesSupported` には API Reference の enum に無い `INFERENCE_PROFILE` が返るので、
enum で弾かず未知の値も素通しする。

## 参照

- 仕様: `docs/apd/spec-*.md`、判断の記録: `docs/apd/decisions.md`
- 技術設計: `docs/superpowers/specs/2026-09-14-bedrock-quick-reference-design.md`
