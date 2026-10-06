---
spec_id: "SHARE-001"
context: "share"
version: 5
issue_ref: "#1"
title: "URL による起点リージョンと絞り込みの共有"
decision_refs:
  - D-001
  - D-007
  - D-011
  - D-013
  - D-015
---

## User Story

**As a** 調べた結果を同僚やコンプライアンス担当者に渡したい開発者
**I want** 起点リージョンと絞り込みの状態が URL に載り、その URL を開けば同じ画面が再現されてほしい
**So that** 「東京起点で日本国内に閉じるモデル」といった見え方を、口頭の操作説明なしに共有できる

## Acceptance Criteria

### AC-001 (起点リージョンが URL に載る)
- **Given**: 起点リージョンが `ap-northeast-1` の初期状態
- **When**: 起点リージョンを `ap-northeast-3` に変更する
- **Then**: URL のクエリパラメータが `?region=ap-northeast-3` に更新される。ページのリロードは発生せず、`history.replaceState` で現在のエントリを書き換える（戻るボタンの履歴を絞り込み操作で埋めない）

### AC-002 (URL からの起点リージョン復元)
- **Given**: `?region=eu-central-1` を含む URL を開く
- **When**: 初期描画が終わる
- **Then**: 起点リージョンセレクタが `eu-central-1` になり、表・エンドポイント表示・脚注がそのリージョンのものになる。TABLE-001 の既定値 `ap-northeast-1` より URL が優先される

### AC-003 (絞り込み条件が URL に載る)
- **Given**: 表が描画されている
- **When**: 提供元 `Anthropic`、モダリティ `TEXT`、名前検索 `claude`、「この起点リージョンから呼べるものだけ」ON、推論先の限定「日本国内のみ」を設定する
- **Then**: URL に `provider` / `modality` / `q` / `callable` / `limit` のパラメータが載る。複数選択はカンマ区切り、既定値と同じ条件のパラメータは URL から省く（既定状態の URL はクエリなし）

### AC-004 (URL からの絞り込み復元)
- **Given**: `?region=ap-northeast-1&provider=Anthropic&limit=country:jp` の URL を開く
- **When**: 初期描画が終わる
- **Then**: 絞り込み UI のコントロールがその状態になり、表も絞り込まれた結果で描画される。条件チップも同じ内容で並ぶ

### AC-005 (共有用 URL のコピー)
- **Given**: 任意の状態のページ
- **When**: 「この表示の URL をコピー」を操作する
- **Then**: 現在のクエリを含む絶対 URL がクリップボードにコピーされる

### AC-006 (言語は URL に載せない)
- **Given**: 日本語表示で状態を設定し URL をコピーする
- **When**: 英語環境の閲覧者がその URL を開く
- **Then**: 起点リージョンと絞り込みは復元されるが、言語は開いた人の設定（I18N-001 AC-002 / AC-006）で決まる

### AC-007 (Error Case: 未知のリージョン)
- **Given**: `?region=xx-nowhere-9` のように `region-notes.json` に無いリージョンコードを含む URL を開く
- **When**: 初期描画する
- **Then**: 例外を投げず既定の `ap-northeast-1` にフォールバックし、「URL で指定されたリージョン `xx-nowhere-9` は対象外のため東京を表示しています」と通知する。URL は既定状態に書き換える

### AC-008 (Error Case: 不正な絞り込みパラメータ)
- **Given**: `?limit=country:atlantis&modality=SMELL&callable=maybe` のような不正値を含む URL を開く
- **When**: 初期描画する
- **Then**: 解釈できないパラメータだけを無視して残りを適用し、無視した項目を通知する。ページは常に描画され、白画面にならない

### AC-009 (Error Case: 復元後に結果が 0 件)
- **Given**: 復元した条件で該当行が 0 件になる URL を開く
- **When**: 初期描画する
- **Then**: FILTER-001 AC-010 の空状態（条件一覧とリセット操作）が表示される。「壊れている」と誤解される無言の空表にしない

### AC-010 (limit のカスタム集合)
- **Given**: 推論先の限定で「カスタム…」を選び、`ap-northeast-3` と `ap-northeast-1` にチェックを入れた状態（FILTER-001 AC-012）
- **When**: URL を見る / その URL を開き直す
- **Then**: `limit` の値は `custom:ap-northeast-1+ap-northeast-3` になる。リージョンコードは昇順・重複なしで `+` で連結し、アプリが URL を書くときは `+` が `%2B` に percent encode される（手で書いた生の `+` は空白に復号されるが、区切りとして同じに扱う）。空集合は `custom`。開き直すとピッカーが開いて同じリージョンにチェックが入り、表も同じ結果になる。`region-notes.json` に無いコードはコードごとに落として通知し（AC-008 と同じ扱い）、URL を残ったコードだけの値に書き換える

### AC-011 (ビューが URL に載る / 復元される)
- **Given**: 「起点から」ビュー（既定）が選ばれている
- **When**: 「リージョン」タブを選ぶ / `?view=regions` の URL を開く
- **Then**: URL のクエリが `view=regions` に更新され（`history.replaceState`）、その URL を開くと初期描画でそのビューが選ばれる。既定の `origin` は URL から省く（既定状態の URL はクエリなし）。`view` の値は `origin` / `regions` の 2 つだけで、それ以外は AC-008 と同じく無視して既定にフォールバックし通知する

### AC-012 (view=regions のとき起点と絞り込みは保持するが効かない)
- **Given**: `?view=regions&region=eu-central-1&provider=Anthropic&limit=country:jp` の URL を開く
- **When**: 初期描画する
- **Then**: 行列が表示される。`region` と `provider` と `limit` は**値としては保持**され、「起点から」タブに切り替えるとそのまま効く。行列に効くのは `provider` / `modality` だけで、`region` は列の「起点」の印にしか使われず、`q` / `callable` / `limit` は行列の内容を変えない（REGIONS-001 AC-002 / AC-010）。解釈できない値として通知してはいけない

### AC-013 (並び順が URL に載る)
- **Given**: 行の並び順が既定（`pinned`）
- **When**: プロバイダ名での並べ替え（`alpha`）に切り替える / `?sort=alpha` の URL を開く
- **Then**: URL のクエリが `sort=alpha` に更新され、その URL を開くと「起点から」の表と「リージョン」の行列の両方がその並びで描画される（TABLE-001 AC-014 / REGIONS-001 AC-003）。既定の `pinned` は URL から省く。`sort` の値は `pinned` / `alpha` の 2 つだけで、それ以外は無視して既定にフォールバックし通知する

### AC-014 (機能列が URL に載る / 復元される)
- **Given**: 表の機能列が既定（`features.json` の `defaultColumns`）の状態
- **When**: 「機能の列」ピッカーで列を選び直す / `?cols=guardrails,countTokens` の URL を開く
- **Then**: URL のクエリが `cols=<key>,<key>` に更新され（`history.replaceState`）、その URL を開くと初期描画でその機能列が表に出る（TABLE-001 AC-016、FEATURE-001 AC-010）
  - 値は `features.json` の機能キーのカンマ区切り
  - **既定の列と同じなら `cols` を省く**（既定状態の URL はクエリなし）
  - `cols=`（値が空）は「機能列なし」を表す。省略（既定の列）とは区別する
  - `features` に無いキーは AC-008 と同じくキーごとに無視して通知し、残りのキーを適用する

## UI Description

- URL の更新はアドレスバーに反映されるのみで、専用の UI は持たない
- 「この表示の URL をコピー」ボタンをヘッダまたは脚注の近くに置く
- AC-007 / AC-008 の通知は、表の上にインラインの注意メッセージとして出し、閉じられるようにする

## Context Boundary

### Inputs
- **From**: 外部（ブラウザ） — `location.search`
- **From**: TABLE-001 — 起点リージョンの変更イベント、有効なリージョンコードの集合
- **From**: FILTER-001 — 絞り込み条件の変更イベント、有効な条件値の集合
- **From**: REGIONS-001 — 選択中のビューの変更イベント
- **From**: TABLE-001 — 機能列の変更イベント
- **From**: FEATURE-001 — 有効な機能キーの集合と既定の列（`defaultColumns`）

### Outputs
- **To**: TABLE-001 — 初期化時に適用する起点リージョン
- **To**: FILTER-001 — 初期化時に適用する絞り込み条件
- **To**: REGIONS-001 — 初期化時に適用するビュー（`view=`）
- **To**: TABLE-001 — 初期化時に適用する機能列（`cols=`）
- **To**: 外部（ブラウザ） — `history.replaceState` による URL 更新、クリップボードへの URL コピー

### Dependencies
- **TABLE-001**: 起点リージョンの正当性判定（`region-notes.json` のキー）
- **FILTER-001**: 絞り込み条件のパラメータ名と値の正当性判定
- **REGIONS-001**: ビューの値（`origin` / `regions`）の正当性判定

## Test Strategy

### AC Coverage

| AC ID | Test Type | Description |
|-------|-----------|-------------|
| AC-001 | integration (jsdom, vitest) | 起点変更後の `location.search` を検証し、`pushState` ではなく `replaceState` が呼ばれることをスパイで確認 |
| AC-002 | integration (jsdom, vitest) | `?region=` 付きで初期化し、セレクタ値・エンドポイント表示が URL 由来になることを検証 |
| AC-003 | unit (vitest) | `serializeState(state)` が既定値のパラメータを省き、複数選択をカンマ区切りにすることを検証 |
| AC-004 | integration (jsdom, vitest) | `parseState(search)` → 初期描画で UI と表の両方が復元されることを検証 |
| AC-005 | integration (jsdom, vitest) | クリップボード API をスタブし、コピーされた文字列が絶対 URL でクエリを含むことを検証 |
| AC-006 | unit (vitest) | `serializeState` の出力に言語のパラメータが含まれないことを検証 |
| AC-007 | unit + integration (vitest, jsdom) | 未知リージョンで既定にフォールバックし通知が出ること、URL が書き換わることを検証 |
| AC-008 | unit (vitest) | `parseState` が不正値のみを落とし、有効値を残すことを複数パターンで検証 |
| AC-009 | integration (jsdom, vitest) | 0 件になる URL で空状態 UI が出ることを検証 |
| AC-011 | unit (vitest) + integration (jsdom, vitest) | `serializeState` が `view=regions` を載せ `origin` を省くこと、`?view=regions` でタブが復元されること、未知の値でフォールバックと通知が出ることを検証 |
| AC-012 | integration (jsdom, vitest) | `?view=regions&region=eu-central-1&provider=Anthropic&limit=country:jp` で行列が出て `provider` だけが効き、通知が出ないこと、タブを「起点から」に切り替えると `region` と `limit` がそのまま効くことを検証 |
| AC-013 | unit (vitest) + integration (jsdom, vitest) | `sort` の往復と既定の省略、`?sort=alpha` で表と行列の両方の並びが変わること、未知の値でのフォールバックと通知を検証 |
| AC-014 | unit (vitest) + integration (jsdom, vitest) | `cols` の往復、既定と同じ並びでの省略、`cols=`（空）が機能列なしとして往復すること、未知のキーが落ちて通知されること、URL からの復元で表の機能列が変わることを検証（`tests/url-state.test.js`） |
| AC-010 | unit (vitest) + integration (jsdom, vitest) | `parseState` / `serializeState` の往復、コードの昇順・重複除去、未知コードの除去と通知、生の `+` の受け入れ、空集合 `custom` の扱いを検証 |
| — (実 URL 確認) | e2e（Playwright MCP で URL を開いてスクリーンショットを手動確認） | ビルド後の単一 HTML を GitHub Pages 相当のパスで開き、URL 復元が動くことを目視 |

## Deliverable Previews

- URL パラメータの一覧表（名前 / 値の形 / 既定値 / 省略条件）

## 委譲する非機能要件

- **a11y（基本的なキーボード操作性）**: URL コピーボタンと通知の閉じるボタンが Tab / Enter で操作でき、通知が `role="status"` でスクリーンリーダーに伝わることを**手動チェック**で確認する
- **セキュリティレビュー: 不要。** URL に載るのはリージョンコードと絞り込み条件だけで、個人情報も認証情報も含まない。クエリ値は DOM にテキストとして挿入する際にエスケープする（AC-008 の不正値テストで併せて検証する）ため、静的サイトとして `/security-review` は回さない

## Notes

- 起点リージョンを URL で共有できることは Design FAQ Q13 で約束している。絞り込みの共有はその自然な拡張として同じ仕組みに載せる
- URL に載るパラメータは `region` / `view` / `sort` / `provider` / `modality` / `q` / `callable` / `limit` / `cols` の 9 つ。既定値と同じものは常に省く
- 展開中の行（DETAIL-001）と、その行で選んだレーン（DETAIL-001 v8 AC-020）は URL に載せない。行数が増えると URL が長くなり、共有の主目的（起点と条件）がぼやけるため
- GitHub Pages のサブパス（`/aws-bedrock-quick-reference/`）配下で動くこと。URL の組み立てで先頭スラッシュの絶対パスを使わない
- `limit` の値の文法は `none` / `country:<code>` / `geo:<code>` / `custom` / `custom:<code>(+<code>)*`。固定リストの値は選択肢（FILTER-001 `buildLimitOptions()`）と突き合わせて検査し、集合が同じで畳まれた値（`geo:jp` など）は残った選択肢の値に読み替えて適用する（FILTER-001 v4 AC-019。「解釈できない指定」には数えない）。カスタムはコードを 1 件ずつ `region-notes.json` のキーと突き合わせる。値の全体を弾かず、解釈できない部分だけを落とすのは AC-008 と同じ方針

## 変更履歴

- **version 5** (2026-10-06): 機能列のパラメータ `cols=` を足し、AC-014 を追加した。既定の列（`features.json` の `defaultColumns`）と同じなら省き、`cols=`（空）は「機能列なし」を表す。未知のキーは AC-008 と同じく無視して通知する。既存の AC-001 〜 AC-013 と他のパラメータは変更しない。理由: 表に選べる機能列（TABLE-001 v10 AC-016）が増え、共有した URL で同じ列構成を再現する必要があるため（D-015）
- **version 4** (2026-09-15): `view=`（`origin` 既定 / `regions`）と `sort=`（`pinned` 既定 / `alpha`）の 2 つのパラメータを足し、AC-011 〜 AC-013 を追加した。既定値は従来どおり URL から省く。`region` / 絞り込み / `limit` は `view=regions` の URL でも値を保持するが行列の内容には効かない（AC-012）。既存の AC-001 〜 AC-010 と `limit` の文法は変更しない。理由: 画面ビュー（REGIONS-001）と並び順（TABLE-001 v9）が増え、共有した URL で同じ画面が再現できる必要があるため
- **version 3** (2026-09-15): `limit` の固定リストの値のうち、FILTER-001 v4 AC-018 で選択肢が畳まれた値（`geo:jp` など）を、無視せず残った選択肢の値に読み替えて適用するようにした（Notes）。値の文法・AC-001〜AC-010 は変更しない。理由: 既に共有されているリンクを壊さないため
- **version 2** (2026-09-14): `limit` の値の文法に カスタム集合（`custom` / `custom:<code>+<code>...`）を足し、AC-010 を追加した。未知のリージョンコードはコードごとに落として通知し、URL を書き換える。AC-001〜AC-009 と他のパラメータは変更しない。理由: Issue #1（FILTER-001 v3 のカスタム経路）
- **version 1** (2026-09-14): 初版
