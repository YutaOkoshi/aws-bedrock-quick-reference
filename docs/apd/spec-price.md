---
spec_id: "PRICE-001"
context: "price"
version: 4
issue_ref: null
title: "公開価格表の取り込みと、同じ行で見える価格の目安"
decision_refs:
  - D-009
  - D-001
  - D-004
  - D-017
  - D-018
  - D-019
---

## User Story

**As a** 起点リージョンを決めて Bedrock のモデルを選ぼうとしている開発者・アーキテクト
**I want** そのリージョンでモデルを使ったときの入力・出力の単価を、In-Region / Geo / Global の判定と同じ行で見たい
**So that** 「どこで推論されるか」と「いくらか」を行き来せずに比べられ、Global を使うと安くなるかもその場で分かる

Design の「価格の目安が同じ行で分かる」に対応する。
**載せるのは公開価格表の単価だけで、利用量からの試算・請求額の計算はしない**（Design「What Not」1）。

## Acceptance Criteria

### AC-001 (取得対象)
- **Given**: `data/fetch-log.json` に `status: "ok"` のリージョンが 17 件ある
- **When**: `node scripts/fetch-bedrock-prices.mjs` を実行する
- **Then**: `AmazonBedrock` と `AmazonBedrockFoundationModels` の 2 つの offer について、その 17 リージョン分のリージョン別ファイルを
  `https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<offerCode>/current/<region>/index.json` から取得する
  - `--regions a,b` で対象を絞れる。省くと `fetch-log.json` の `status: "ok"` 全件
  - `--date YYYY-MM-DD` で `data/raw/<日付>/` の日付を上書きできる。既定は JST の今日
  - `--dry-run` は取得と生データの保存だけ行い `data/prices.json` を書かない
  - `AmazonBedrockService`（Mantle / cross-region / 予約 TPM）と `AmazonBedrockAgentCore` は**対象外**。トークンの単価を持たないため
  - 1 リージョン・1 offer の取得に失敗しても全体を止めない（その offer にそのリージョンが無いことがある）

### AC-002 (生データの保存と再正規化)
- **Given**: AC-001 の取得が走っている
- **When**: 1 ファイル取得するたびに
- **Then**: 生 JSON を `data/raw/<日付>/prices-<offerCode>-<region>.json` に保存する。このディレクトリは gitignore 対象で、リポジトリには入らない
- **And**: `--from-raw YYYY-MM-DD` を指定すると、ネットワークを一切使わずに `data/raw/<日付>/` から `data/prices.json` を作り直せる（正規化の規則や対応表を直したときの経路）

### AC-003 (正規化は純関数)
- **Given**: `scripts/lib/prices.mjs`
- **When**: そのモジュールを読む
- **Then**: I/O・時刻・ネットワークを一切持たない。取得日時は呼び出し側が渡す。ファイルの取得と書き出しは `scripts/fetch-bedrock-prices.mjs` だけが行う（`normalize.mjs` / `snapshot.mjs` と同じ分け方、D-001）

### AC-004 (USD / 100 万トークンに揃える)
- **Given**: `terms.OnDemand[sku][offerTermCode].priceDimensions[*].pricePerUnit.USD` に単価がある
- **When**: 正規化する
- **Then**: すべての単価を **USD / 100 万トークン** に揃えて `data/prices.json` に書く
  - 単位 `1K tokens`（`AmazonBedrock`）は **1000 倍**する。単位 `1M tokens`（`AmazonBedrockFoundationModels`）はそのまま
  - 小数 **6 桁**までで丸める（例: `$0.00384 /1K` → `3.84`、`$5.50 /1M` → `5.5`）
  - トークン以外の単位（`image` / `video` / `hour` / `1M TPM Hour` / `Search Units` / `Embeddings` など）は載せない
- **And**: 種別は次の 7 つ。判定は 軸（input / output / cacheRead / cacheWrite）と 旗（global / batch / priority / flex）から決める

  | 種別 | 意味 | 持つ軸 |
  |---|---|---|
  | `standard` | 起点リージョン内の標準価格 | input / output |
  | `global` | Global（世界中で推論する使い方）の価格 | input / output |
  | `batch` | バッチ推論 | input / output |
  | `cacheRead` | プロンプトキャッシュの読み取り | input |
  | `cacheWrite` | プロンプトキャッシュの書き込み（既定 TTL） | input |
  | `priority` | 優先（priority）階層 | input / output |
  | `flex` | Flex 階層 | input / output |

  - 軸は `AmazonBedrock` では `inferenceType`（空なら `usagetype` の末尾）、`AmazonBedrockFoundationModels` では `usagetype` の寸法部分（`APN1-MP:APN1_<寸法>-Units`）から読む。`input_tokens_global_standard` の snake_case と `InputTokenCount_Global` の CamelCase の両方を扱う
  - 旗は `usagetype`（`cross-region-global` / `-batch` / `-flex` / `-priority`）、`service_tier`（`standard` / `flex` / `priority` / `batch` / `global-*`）、`feature`（`Batch Inference`）から読む
  - **v1 の範囲外**（`outOfScope` に数え、`byModel` には載せない）: Global と batch / flex / priority の組み合わせ、1 時間 TTL のキャッシュ書き込み、音声・画像・動画のトークン、Speech Understanding、latency optimized、カスタムモデル

### AC-005 (SKU → モデル ID の対応)
- **Given**: 価格表のモデル名（`AmazonBedrock` は `model` 属性、`AmazonBedrockFoundationModels` は `servicename`）
- **When**: `data/models.json` のモデル ID に結びつける
- **Then**: 次の順で引く
  1. 手書きの `data/price-model-map.json` に鍵があればそれを使う
  2. 無ければ、`servicename` から `(Amazon Bedrock Edition)` を外したうえで、`models.json` の `name` と**大文字小文字・記号を無視して**一致させる
- **And**: 同じ `name` のモデル ID が複数ある場合（`Nova Pro` の文脈長違いなど）は**全件に同じ単価を入れる**
- **And**: `model` 属性を持たない SKU（Titan 系）は、`usagetype` からリージョン接頭辞と寸法を落とした `usagetype:<token>` を鍵にする（例: `APN1-TitanEmbeddingsG1-Text-input-tokens` → `usagetype:TitanEmbeddingsG1-Text`）
- **And**: `price-model-map.json` の値に `null` と書いた鍵は「`models.json` に該当モデルが無いと確認済み」の意味で、`unmapped` には数えない（`ignored` に数える）

### AC-006 (Error Case: 未マッピングの SKU)
- **Given**: AC-005 のどちらでも引けないモデル名がある
- **When**: 正規化する
- **Then**: その SKU は `byModel` に入らず、名前・offer・件数・例の `usagetype` が `data/raw/<日付>/prices-unmapped.json` に書き出され、`data/prices.json` の `unmapped`（名前の件数）に数えられる
- **And**: 例外にして取得を止めない。メンテナは一覧を見て `price-model-map.json` を足し、`--from-raw` で作り直す

### AC-007 (表の価格列)
- **Given**: 起点リージョン R で表が描画されている
- **When**: 列を見る
- **Then**: **Global 列の右**に「入力 $/1M」「出力 $/1M」の 2 列が並ぶ（列の並びは プロバイダ / モデル名 / モダリティ / In-Region / Geo / Global / **入力 $/1M** / **出力 $/1M** / 備考）
  - 値は `prices.json.byModel[M][R].standard` の `input` / `output`（**起点リージョンの標準価格**）
  - 数値は**右寄せ**（`num` クラス）で、`$1` 以上は**小数 2 桁**、`$1` 未満は**有効数字 3 桁・末尾の 0 は落とす**（例: `$16.50` / `$0.288` / `$0.072` / `$0.2`）
  - 単価が無いモデルは **「—」**（TABLE-001 の「値なし」と同じ見た目）
  - 数値として並べ替えられる

### AC-008 (Global セルに Global の単価を添える)
- **Given**: モデル M に `prices.json.byModel[M][R].global` がある
- **When**: Global セルを描画する
- **Then**: ✓ と「全世界の対応リージョン」の注記（TABLE-001 AC-005）に加えて、**「$入力 / $出力」**が同じセルに出る（例: `$3.00 / $15.00`）。Global の価格が無ければ何も足さない
- **And**: TABLE-001 AC-005 の判定（`global.` プロファイルの有無）そのものは変えない。価格の有無で ✓ / ✕ は変わらない

### AC-009 (脚注)
- **Given**: ページを開く
- **When**: 表の下の脚注を見る
- **Then**: `prices.json` の `generatedAt`（価格の取得日）と `publicationDate`（価格表の発行日）が出て、出典として AWS Price List Bulk API の index へのリンクが付く
- **And**: 価格データが無い（`prices.json` が空）ときは、価格の脚注を出さない

### AC-010 (詳細パネルの価格)
- **Given**: 起点リージョン R でモデル M の行を開く
- **When**: 詳細パネルを描画する
- **Then**: 「使い方」の下に **価格** の節が入り、**種別 × 入力 / 出力** の小さな表が出る。行は 標準 / Global / バッチ / キャッシュ読み / キャッシュ書き / 優先 / Flex のうち R に単価があるものだけを、この順で並べる
  - キャッシュ読み / キャッシュ書き のように出力側の単価が無い種別は「—」
  - 表の下に単位の注記（`USD / 100 万トークン。標準価格で、割引・契約価格・無料枠は含まない`）を置く
- **And**: R に単価が 1 つも無ければ、空欄にせず「この起点リージョンの価格データがありません」と表示する

### AC-011 (Error Case: 価格が無いモデル / リージョン)
- **Given**: `prices.json` に M も R も無い、または `prices.json` そのものが空
- **When**: 表と詳細パネルを描画する
- **Then**: 価格列は「—」、詳細パネルは AC-010 の「価格データなし」になり、**例外で描画が止まらない**。行数・判定・絞り込みは価格の有無に影響されない

### AC-012 (識別子を画面に足さない)
- **Given**: 価格の表示
- **When**: 表・Global セル・詳細パネルを見る
- **Then**: SKU・`usagetype`・offer code といった価格表側の識別子は**画面に一切出さない**。出るのは単価と単位と種別だけ（TABLE-001 AC-007 / D-008 と同じ方針。識別子はメンテナ向けの情報で `data/raw/` にのみ残る）

### AC-NFR-001 (認証なしで取得できる)
- **Given**: AWS の認証情報（SSO のセッション、環境変数、`~/.aws`）が一切無い環境
- **When**: `node scripts/fetch-bedrock-prices.mjs` を実行する
- **Then**: 17 リージョン × 2 offer の取得が成功し `data/prices.json` が生成される。`aws` CLI も AWS SDK も使わず、Node の組み込み `fetch` だけで取る（`package.json` の `dependencies` は空のまま）

### AC-NFR-002 (生成物の大きさ)
- **Given**: 17 リージョン分の `data/prices.json`
- **When**: ビルドする
- **Then**: 単一 HTML の `dist/index.html` が 1 MB を超えない（価格データの追加でページが重くならない）

## UI Description

- **表**: Global 列の右に「入力 $/1M」「出力 $/1M」の 2 列。右寄せ・等幅・`$` 付き。値なしは「—」
- **Global セル**: ✓ と注記の間に、淡色・小さめの 1 行で `$入力 / $出力`
- **詳細パネル**: 「モデル ID」→「この起点からの使い方」→ **「価格」** →「提供状況」→「推論プロファイル」→「エンドポイント」の順。価格は 3 列（種別 / 入力 / 出力）の小さな表 + 単位の注記
- **脚注**: 既存の「データ取得日時 / accountKind / 未取得のリージョン」の下に「価格の取得日」「価格表の発行日 + 出典リンク」の 2 行
- 375px 幅では価格列も横スクロールの中に収まる（TABLE-001 AC-NFR-001 の枠組みをそのまま使う）

## Context Boundary

### Inputs
- **From**: 外部（AWS Price List Bulk API）— offer ごと・リージョンごとの価格表 JSON
- **From**: DATA-001 — `data/models.json`（モデル ID と `name`）、`data/fetch-log.json`（取得対象のリージョン）
- **From**: 手書き — `data/price-model-map.json`（価格表のモデル名 → モデル ID）

### Outputs
- **To**: TABLE-001 — `data/prices.json` の `byModel[M][R].standard` / `.global` と、脚注に出す `generatedAt` / `publicationDate` / `source`
- **To**: DETAIL-001 — `byModel[M][R]` の全種別
- **To**: メンテナ — `data/raw/<日付>/prices-unmapped.json` と `prices.json` の `unmapped` / `outOfScope` / `ignored`

### Dependencies
- **DATA-001**: モデル ID の集合（`models.json`）と取得できたリージョンの集合（`fetch-log.json`）。価格は後から重ねるだけで、判定ルール（D-003）には一切関与しない
- **I18N-001**: 列ヘッダ・種別名・単位の注記。辞書の `price.*` に置き、ja / en で同じキー集合を持つ

## Test Strategy

### AC Coverage

| AC ID | Test Type | Description |
|-------|-----------|-------------|
| AC-001 | unit (vitest, node) | `okRegions(fetchLog)` が `status: "ok"` だけを昇順で返すこと、実データで 17 件になること、`parsePriceArgs` が `--regions` / `--date` / 不正な引数を扱うこと、`PRICE_OFFERS` が 2 つであることを検証 |
| AC-002 | unit (vitest, node) | `rawName(offer, region)` と `priceFileUrl(offer, region)` の文字列、`.gitignore` に `data/raw/` があること、`--from-raw` が `--regions` と併用できないことを検証 |
| AC-003 | 目視 + 構成 | `prices.mjs` が `node:fs` / `fetch` / `Date` を import しないこと（`fetch-bedrock-prices.mjs` だけが持つ） |
| AC-004 | unit (vitest, node) | `toPerMillion` の 1K / 1M / 非トークン単位、`roundPrice` の 6 桁、`axisOf` の 4 軸と範囲外 5 種、`kindOf` の 7 種別と組み合わせ、`readProduct` が 2 つの offer それぞれで 軸・種別・mantle・latency optimized を正しく読むことを検証 |
| AC-005 | unit (vitest, node) | `stripEdition` / `buildNameIndex` / `resolveModelIds` を、自動一致・地図優先・同名複数・`usagetype:` 鍵・`null`（該当なし）の 5 経路で検証 |
| AC-006 | unit (vitest, node) | 地図を空にして正規化し `unmapped` が 1 以上になること、返る一覧が `name` / `offer` / `count` を持つこと、地図が揃えば `unmapped` が 0 になることを検証。実データの `data/prices.json` でも `unmapped` が 0 であることを検証 |
| AC-007 | integration (jsdom, vitest) | 列ヘッダの並びとキー、`$3.30` / `$0.072` の表示、`num` クラス、並べ替え、`formatPrice` の境界（$1 / 0 / null）を検証 |
| AC-008 | integration (jsdom, vitest) | Global 価格があるモデルで `.global-price` が `$3.00 / $15.00` になること、無いモデルでは `.global-price` が出ないこと、✓ と注記が残ることを検証 |
| AC-009 | integration (jsdom, vitest) | 脚注に取得日・発行日・出典リンクが出ること、`prices` が空なら価格の脚注が出ないことを検証 |
| AC-010 | unit + integration (vitest, jsdom) | `buildPriceRows` の並びと 0 件、描画された 3 列の小表の中身（ja / en）、単位の注記を検証 |
| AC-011 | unit + integration (vitest, jsdom) | 空の `prices` で列が「—」+ `dim` になること、詳細が「価格データなし」になること、行数が変わらないこと、`normalizePrices({files:{}})` が例外にならないことを検証 |
| AC-012 | integration (jsdom, vitest) | `byModel` の JSON に `mantle` が現れないこと（正規化側）と、描画された表に SKU / usagetype が出ないこと |
| AC-NFR-001 | 手動実行 | 17 リージョンの実取得を 1 度行い、`aws` を呼ばずに `data/prices.json` が生成されることを確認。`tests/no-runtime-deps.test.js` が `dependencies` の空を担保する |
| AC-NFR-002 | 手動確認 | `npm run build` の出力サイズを確認（2026-09-14 時点 324 kB） |

## Deliverable Previews

`data/prices.json`（抜粋。実データ、2026-09-11 発行の価格表）:

```json
{
  "generatedAt": "2026-09-14T14:20:00.000Z",
  "publicationDate": "2026-09-11T12:44:10Z",
  "source": {
    "index": "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/index.json",
    "offers": {
      "AmazonBedrock": "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrock/current/<region>/index.json",
      "AmazonBedrockFoundationModels": "https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonBedrockFoundationModels/current/<region>/index.json"
    }
  },
  "unmapped": 0,
  "outOfScope": 5752,
  "ignored": 447,
  "byModel": {
    "anthropic.claude-opus-5": {
      "ap-northeast-1": {
        "standard": { "input": 5.5, "output": 27.5 },
        "global": { "input": 5, "output": 25 },
        "batch": { "input": 2.75, "output": 13.75 },
        "cacheRead": { "input": 0.55 },
        "cacheWrite": { "input": 6.875 }
      }
    },
    "amazon.nova-pro-v1:0": {
      "ap-northeast-1": {
        "standard": { "input": 0.96, "output": 3.84 },
        "batch": { "input": 0.48, "output": 1.92 },
        "cacheRead": { "input": 0.24 },
        "priority": { "input": 1.68, "output": 6.72 },
        "flex": { "input": 0.48, "output": 1.92 }
      }
    }
  }
}
```

- 起点 `ap-northeast-1` での価格列付きの表のスクリーンショット
- 価格の節を含む詳細パネルのスクリーンショット

## 委譲する非機能要件

- **セキュリティレビュー: 不要。** 取得先は認証不要の公開 URL で、取り込む値は単価（数値）と AWS が公開しているモデル名だけ。アカウント ID・ARN・認証情報は経路のどこにも現れない（D-008 と同じ理由で、生成物に識別子を持ち込まない）
- **a11y**: 価格列は数値のセル、詳細の価格表は通常の `table` で、新しい操作要素を足さない。TABLE-001 / DETAIL-001 の手動チェックの範囲に含める

## Notes

- 価格は**公開価格表の単価のみ**。利用量からの試算、プロビジョンドスループットの費用、割引・契約価格・無料枠は載せない（Design「What Not」1、FAQ Q13）
- 価格表の発行日（`publicationDate`）と、このサイトが取り込んだ日（`generatedAt`）は別物なので両方を脚注に出す
- `-mantle-` の SKU は bedrock-mantle の単価として `byModel[M][R].mantle` に別に入れる。Runtime の単価には混ぜない（D-017）。Mantle で使えるかどうかは別の列が扱う
- `AmazonBedrockService` は Mantle / cross-region / 予約 TPM の offer で、トークン単価を持たないため v1 では取得しない
- 価格表の SKU 構成は AWS 側の都合で変わる。未マッピングが増えたら `prices-unmapped.json` を見て `price-model-map.json` を直し、`--from-raw` で作り直す（取り直しは要らない）

## 変更履歴

- **version 1** (2026-09-14): 初版
- **version 4** (2026-10-08): Global のバッチ・キャッシュ (`globalBatch` / `globalCacheRead` / `globalCacheWrite`) を取り込み、詳細の Global のタブに出す (D-019)
- **version 3** (2026-10-08): Price List に bedrock-runtime の単価が無いモデルだけ AWS Marketplace の offer の rateCard で補い、出典を出す。価格未収録のモデルに docs のリンクを出す (D-018)
- **version 2** (2026-10-08): 手書きの補完 (`price-supplements.json`) を廃止し、Price List の書き方の揺れを取り込み側で吸収する。bedrock-runtime と bedrock-mantle の単価を分けて持つ (D-017)

## Price List の書き方の揺れ (2026-10-07)

価格は Price List API の値だけを使う。公式モデルカードからの手書きの補完 (`data/price-supplements.json`) は
2026-10-07 に廃止した。取り込みでは次の揺れを吸収する。

- 単位の大文字小文字は問わない (Nova 2.5 Sonic は `1k tokens`)
- `model` 属性がモデル ID そのもの (`xai.grok-4.6`、`google.gemma-4-*`) でも引く。名前の先頭にプロバイダ名が付くもの (`OpenAI GPT-6 Astra`) も自動で引く
- `-mantle-` の SKU は bedrock-mantle の単価として `byModel[M][R].mantle` に入れ、Runtime の単価とは混ぜない (D-017。Qwen3 Next 80B は値が違う)。
  Grok 4.6 / 4.7・Kimi K3 は Mantle の SKU しか無いので、表の価格列 (Runtime) は価格未収録、詳細には Mantle の表だけが出る。
  `models.json` に無い Mantle 専用モデルの SKU は `unmapped` に数えない
- 単位が読めない SKU (`Units` など) と、地図が `models.json` に無い ID を指すもの (API から消えたモデル) は書き出さない
- 安全弁: 価格のあるモデルが前回の `prices.json` の半分未満になったら、書き出さずに終了コード 1 で終わる
- `long_ctx` の SKU は standard / global の `longContext` として読む。キャッシュの `long_ctx` は範囲外。境界のトークン数は Price List に無いので表示しない

Price List に載っていないモデルは推測で埋めない。2026-10-07 時点で商用リージョンの AmazonBedrock / AmazonBedrockFoundationModels の全リージョンに
無いと確認したもの: GPT-5.4 / 5.5 / 5.6 Luna / 5.6 Sol / 5.6 Terra / 6 Luna / 6 Sol / 6.1 Sol (Marketplace 製品。GPT-5.4 は GovCloud にだけある)、
GLM-5.3、Stability の画像編集系 13 モデル。`amazon.titan-embed-g1-text-02` は API の名前が `amazon.titan-embed-text-v2:0` と同じで、
Price List に別の SKU が無い (`TitanEmbeddingV2-Text` は `v2:0` に結び付く)。

## AWS Marketplace の offer による補完 (D-018)

Price List に bedrock-runtime の単価が 1 つも無いモデルだけ、Bedrock の `ListFoundationModelAgreementOffers` が返す
rateCard の単価で埋める。Price List に単価があるモデルは触らない。

- 取得: `node scripts/fetch-bedrock-marketplace-prices.mjs --profile <名前>` (SSO 必須) → `data/marketplace-prices.json`。
  生データは `data/raw/<日付>/marketplace/` (gitignore 対象)。`--from-raw <日付>` で作り直せる
- 反映: `node scripts/fetch-bedrock-prices.mjs` (または `--from-raw`) が読み込んで `data/prices.json` に入れる
- dimension の読み方: `[略号_]<軸>_tokens_[30m_|1h_][long_ctx_][global_]<階層>`。種別の規則は Price List と同じ。
  ultrafast と 1 時間 TTL のキャッシュ書き込みは範囲外。画像の課金 (`CreatedImage<名前>`) は、13 モデルで 1 つの offer を共有する
  Stability に合わせ、名前の語で 1 つに決まるモデルにだけ入れる (決まらなければ `unmatchedImages` に残す)
- 当てるリージョン: 略号付きはそのリージョン。略号無しの標準系は In-Region (ON_DEMAND) か Geo のプロファイルの起点、global は Global の
  プロファイルの起点。いずれも Price List の取得対象リージョンに限る
- 画面: 一覧の価格に「出典: Marketplace」、詳細に offer ID 付きの出典を出す
- それでも単価が無いモデル (2026-10-08 時点で Grok 4.6 / 4.7・Kimi K3 の Runtime、GLM-5.3、Titan Embeddings g1-text-02) は、
  一覧の「価格未収録」と詳細の「価格データがありません」に、docs のモデルカード (features.json の `card`。無ければ料金ページ) へのリンクを付ける
