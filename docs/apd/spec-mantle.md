---
spec_id: "MANTLE-001"
context: "mantle"
version: 2
issue_ref: null
title: "もう一つの接続先 bedrock-mantle と対応モデルの表示"
decision_refs:
  - D-004
  - D-010
---

## User Story

**As a** 起点リージョンから Bedrock を呼ぶ開発者・アーキテクト
**I want** `bedrock-runtime` の隣に **もう一つの接続先 `bedrock-mantle`** があること、その起点で使えるか、どのモデルが載っているか、指定するモデル ID は何かを同じ画面で知りたい
**So that** OpenAI SDK / Anthropic SDK のコードを持ち込むときに、どの接続先へ向ければよいかをモデルカードを開かずに決められる

## 前提となる事実（2026-09-14 に公式 docs で確認）

- 推論のエンドポイントは 2 つ。`bedrock-runtime.{region}.amazonaws.com` と `bedrock-mantle.{region}.api.aws`。
  裏側の推論エンジンは同じで、**同一モデルのトークン単価も同じ**
- `bedrock-mantle` が提供する API は **OpenAI Responses / OpenAI Chat Completions / Anthropic Messages** の 3 本。
  `InvokeModel` / `Converse` は提供しない
- **`bedrock-mantle` では cross-region inference（地理圏プロファイル・グローバルプロファイル）が使えない**。
  Guardrails・application inference profile・intelligent prompt routing も使えない
- `bedrock-mantle` で指定するモデル ID は **接頭辞の付かない素のモデル ID**（`us.` / `global.` を付けない）
- 提供リージョンは 14（`us-east-1` / `us-east-2` / `us-west-2` / `ap-northeast-1` / `ap-south-1` /
  `ap-southeast-2` / `ap-southeast-3` / `eu-central-1` / `eu-west-1` / `eu-west-2` / `eu-south-1` /
  `eu-north-1` / `sa-east-1` / `us-gov-west-1`）
- モデルごとの対応はエンドポイント別に分かれており、**mantle だけにあるモデル**と **runtime だけにあるモデル**が両方ある

出典（`data/mantle.json` の `_source` と同じ）:

- <https://docs.aws.amazon.com/bedrock/latest/userguide/endpoints.html>
- <https://docs.aws.amazon.com/bedrock/latest/userguide/endpoints-region-availability.html> (旧 `bedrock-mantle.html`。2026-10-26 時点で Responses API のページへ転送されるため差し替えた)
- <https://docs.aws.amazon.com/bedrock/latest/userguide/models-endpoint-availability.html>

## Acceptance Criteria

### AC-001 (Mantle 提供リージョンのエンドポイント表示)
- **Given**: 起点リージョン R が `data/mantle.json` の `regions` に含まれる（例: `ap-northeast-1`）
- **When**: 起点リージョンセレクタの近くを見る
- **Then**: `bedrock-runtime` のエンドポイント行（TABLE-001 AC-002）の下に「**Mantle: `bedrock-mantle.<region>.api.aws`**」が表示され、コピーボタンが付く。起点を切り替えると同じ位置の値も切り替わる

### AC-002 (Mantle 提供外のリージョン)
- **Given**: 起点リージョン R が `regions` に含まれない（例: `ap-northeast-3` / `eu-west-3`）
- **When**: 同じ位置を見る
- **Then**: 「**Mantle: このリージョンでは提供なし**」の 1 行だけが出る。FQDN もコピーボタンも出さない（呼べない宛先を見せないため）。`bedrock-runtime` の行は変わらず出る

### AC-003 (メイン表の Mantle 列)
- **Given**: 起点リージョン R、モデル M
- **When**: 表を描画する
- **Then**: **備考の 1 つ手前**（= 最後から 2 番目）に「Mantle」列が出る。`mantle.json.models[M].mantle` が `true` **かつ** R が `regions` に含まれるときだけ ✓ になり、それ以外は「—」になる
  - ✓ のセルは、**mantle で指定する素のモデル ID** をツールチップに持ち、`data-mantle-model-id` として残す。接頭辞（`us.` / `global.`）を付けた ID は出さない
  - 「—」のセルは理由をツールチップに出す。**「このモデルは `bedrock-mantle` では提供されていません」/「Mantle: このリージョンでは提供なし」/「公式 docs の対応表にこのモデルの記載がありません」** の 3 通りで、モデル未対応・リージョン未提供・記載なしを混同させない

### AC-004 (cross-region inference が使えないことの注記)
- **Given**: 任意の起点リージョン
- **When**: エンドポイント行の近くを見る
- **Then**: 「**Mantle では地理圏・全世界への振り分け（cross-region inference）は使えません**」の 1 行が表示される。文言は I18N-001 の辞書（`mantle.noCris`）に置き、ja / en の両方を持つ。Mantle 提供外のリージョンでもこの注記は消えない

### AC-005 (詳細パネルの見出し行に出す接続先)
- **Given**: 起点リージョン R でモデル M の行を開く（DETAIL-001 v8 AC-001）
- **When**: パネル先頭の**共通の見出し行**（DETAIL-001 v8 AC-010 の `div.head-grid`）を見る
- **Then**: 見出し行の項目 2 と項目 3 が接続先になる。**末尾に独立した「接続先」節は置かない**
  - **項目 2「接続先 (bedrock-runtime)」**: R の FQDN と、そこで呼べる API（InvokeModel / Converse / OpenAI Responses / Chat Completions / Anthropic Messages）。どの起点でも必ず出る
  - **項目 3「接続先 (bedrock-mantle)」**: **R に mantle があるときだけ出る**。中身は次の 3 つ
    1. `bedrock-mantle` の FQDN
    2. そこで呼べる API（**OpenAI Responses / Chat Completions / Anthropic Messages** のみ）
    3. **Mantle で指定するモデル ID**（コピーボタン付き）。✓ にならない組み合わせでは ID の代わりに AC-003 と同じ理由の文言を出す
  - R に mantle が無いときは**この項目ごと出さない**。「提供なし」の行も置かない（呼べない宛先を見せないため。起点バーの AC-002 の表示は変わらない）
- **And**: AC-004 の注記が項目 3 の中に 1 行で出る。DETAIL-001 v8 AC-010 の「起点の `bedrock-runtime` エンドポイント」は項目 2 そのもの

### AC-006 (出典リンク)
- **Given**: 詳細パネルの見出し行の「接続先 (bedrock-mantle)」の項目
- **When**: 項目の末尾を見る
- **Then**: 転記元の公式 docs（Endpoint availability）へのリンクが脚注として出る。`target="_blank"` と `rel="noreferrer"` を持つ

### AC-007 (Error Case: mantle のデータが無い / モデルの記載が無い)
- **Given**: `data/mantle.json` を渡さずに画面を組み立てる、または `models` に M のキーが無い
- **When**: 表と詳細パネルを描画する
- **Then**: 例外を投げず、Mantle 列は全て「—」、エンドポイント行は AC-002 の「提供なし」になる。**「記載なし」を「非対応」と表示しない**（D-003 の「提供なし」と「未取得」を分ける方針と同じ理由）

## UI Description

- **上部（起点バー）**: `bedrock-runtime` のエンドポイント行の下に Mantle の行を置く。提供リージョンなら
  `Mantle:` + FQDN + コピーボタン、提供外なら「Mantle: このリージョンでは提供なし」の 1 行。
  その下に AC-004 の注記を淡色・小サイズで 1 行
- **本体（表）**: 備考の 1 つ手前に「Mantle」列。✓ / 「—」だけの狭い列で、ID はセルに出さない
  （TABLE-001 AC-007 の「表の中に ID とコピーボタンを置かない」を守る。ID はツールチップと詳細パネル）
- **詳細パネル**: パネル先頭の共通の見出し行（`div.head-grid`）の 2 列目が
  `接続先 (bedrock-runtime)`、3 列目が `接続先 (bedrock-mantle)`。3 列目は起点に mantle が
  あるときだけ出て、FQDN / 呼べる API / Mantle のモデル ID / AC-004 の注記 / 出典リンクを
  この順に縦に積む。**パネル末尾の「接続先」節は無い**（DETAIL-001 v8）

## Context Boundary

### Inputs
- **From**: DATA-001 — `data/models.json`（モデル ID の正）
- **From**: 手書きデータ `data/mantle.json`（D-010）— `regions` / `models` / `mantleOnly` / `_unmatched` / `_source`
- **From**: TABLE-001 — 現在の起点リージョン
- **From**: I18N-001 — `mantle.*` の辞書（ja / en）

### Outputs
- **To**: TABLE-001 — 表に足す 1 列ぶんの列定義とセル
- **To**: DETAIL-001 — 詳細パネルの「接続先」節

### Dependencies
- **DATA-001**: モデル ID の集合。`mantle.json` のキーはここに実在するものだけ
- **TABLE-001 / DETAIL-001**: 表示場所。判定ルール（In-Region / Geo / Global）は変更しない
- **FILTER-001**: **依存しない。** 推論先の限定（D-007）は cross-region inference の destination に対する条件で、
  Mantle は cross-region inference を持たないため、Mantle 列に「限定外」の印は付けない

## データ

`data/mantle.json` は**手書き**。公式 docs から転記し、**記憶で足さない**（`data/region-notes.json` と同じ規約 / D-004）。

```json
{
  "_source": { "urls": ["...", "...", "..."], "date": "2026-09-14" },
  "_unmatched": ["Nova Premier", "..."],
  "regions": ["ap-northeast-1", "..."],
  "mantleOnly": { "Gemma 4 31B": { "runtime": false, "mantle": true } },
  "models": { "<modelId>": { "runtime": true, "mantle": true, "mantleModelId": "..." } }
}
```

- `models` のキーは `models.json` のモデル ID。docs のモデル名から**大文字小文字を無視した完全一致**で引く
- 突き合わなかった docs のモデル名は `_unmatched` に残す。オーナーが見て手当てできるようにするためで、
  推測で別のモデル ID に結び付けない
- `models.json` に無い **mantle 専用モデル**は `mantleOnly` に docs のモデル名をキーにして置く。
  表には出ない（表の母集団は `ListFoundationModels` の結果なので）が、転記の欠落と区別できる
- `mantleModelId` は docs が本文で明示しているときだけ書く。無ければ素のモデル ID をそのまま使う

## Test Strategy

### AC Coverage

| AC ID | Test Type | Description |
|-------|-----------|-------------|
| AC-001 | unit + integration (vitest, jsdom) | `mantleEndpointOf` / `isMantleRegion` を検証。描画側で FQDN とコピーボタンが出ること、起点切り替えで値が追随することを検証 |
| AC-002 | integration (jsdom, vitest) | 提供外リージョン（`ap-northeast-3`）で「提供なし」の文言だけが出て、FQDN もコピーボタンも出ないことを検証 |
| AC-003 | unit + integration (vitest, jsdom) | `judgeMantle` を 4 ケース（対応 × 提供 / 対応 × 提供外 / 非対応 × 提供 / 記載なし）で検証。描画側で列位置（備考の 1 つ手前）、✓ と「—」、ツールチップの 3 通りの文言、素のモデル ID を検証 |
| AC-004 | integration (jsdom, vitest) | 注記が起点バーの中に 1 行で出て、提供外リージョンでも消えないことを検証 |
| AC-005 | integration (jsdom, vitest) | 見出し行の項目が モデル ID / bedrock-runtime / bedrock-mantle の順に並び、mantle の項目に `InvokeModel` / `Converse` が現れないこと、Mantle のモデル ID がコピーボタン付きで出ること、非対応モデルでは理由が出ること、mantle が無い起点では項目ごと消えて `bedrock-runtime` の項目は残ることを検証 |
| AC-006 | integration (jsdom, vitest) | 脚注リンクの `href` と `rel` を検証 |
| AC-007 | unit + integration (vitest, jsdom) | `judgeMantle(null, ...)` / `isMantleRegion(null, ...)` が落ちないこと、mantle を渡さずに組み立てた表で全行が「—」になることを検証 |
| データの形 | unit (vitest, node) | `data/mantle.json` の `_source`（URL 3 本・日付）、`regions` が docs の 15 件と一致、`models` のキーが `models.json` に実在、`_unmatched` / `mantleOnly` の性質を検証 |

## Deliverable Previews

- 起点 `ap-northeast-1`（東京）での Mantle 列とエンドポイント行のスクリーンショット
- 起点が Mantle 提供外のリージョンのときのスクリーンショット

## 委譲する非機能要件

- **a11y**: Mantle のコピーボタンが Tab で到達し Enter / Space で押せることを**手動チェック**で確認する。
  既存のコピーボタンと同じ実装（`copy.js`）なので自動テストは足さない
- **セキュリティレビュー: 不要。** 表示のみの静的コンテンツで、扱うデータは AWS の公開情報のみ

## Notes

- **料金は列に持たない。** 同一モデルのトークン単価は 2 つの接続先で同じなので、
  接続先の選択は「必要な API と機能」で決まる（docs の "Choose an endpoint based on the APIs and
  capabilities you need, not cost"）。Design「What Not」1 とも整合する
- Mantle 専用の機能（server-side tool use / Projects / Workspaces / 非同期推論）とクォータの違いは
  この Spec の範囲外。「もう一つの接続先が分かる」（Design v2）に必要な最小限だけを出す
- `us-gov-west-1` は `data/mantle.json` の `regions` には転記どおり残すが、`region-notes.json` に
  無いので起点リージョンとしては選べない（GovCloud は対象外 / CLAUDE.md）

## 変更履歴

- **version 2** (2026-09-15): 詳細パネルの接続先の置き場所を、パネル末尾の独立した「接続先」節から
  **DETAIL-001 v8 AC-010 の共通の見出し行**へ移した（AC-005 を改訂、UI Description と AC Coverage を追随）。
  `bedrock-runtime` の FQDN は見出し行の項目 2、`bedrock-mantle` は項目 3 で、**起点に mantle が
  あるときだけ**出る（無いときは項目ごと出さない）。3 つの中身（FQDN / 呼べる API / Mantle の
  モデル ID）・AC-004 の注記・AC-006 の出典リンクは変えていない。AC-001 〜 AC-004 / AC-007 も変更なし。
  理由: DETAIL-001 v8 がパネルを「レーンごとのデータの流れ」に作り替え、レーンによらない共通の情報を
  先頭の見出し行に集めたため。末尾の節のままだと、レーンのタブパネルの下に接続先が続いて
  「どのレーンにも属さない情報」が読み取れなくなる（D-013）
- **version 1** (2026-09-14): 初版
