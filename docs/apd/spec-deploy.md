---
spec_id: "DEPLOY-001"
context: "deploy"
version: 1
issue_ref: null
title: "GitHub Pages への公開"
decision_refs:
  - D-001
  - D-002
---

## User Story

**As a** このサイトを保守する作者
**I want** main への push でテストとビルドが走り、単一 HTML が GitHub Pages に公開されてほしい
**So that** データを更新したら手作業なしで公開に反映でき、壊れた状態が公開されない

## Acceptance Criteria

### AC-001 (push で公開まで走る)
- **Given**: `.github/workflows/deploy.yml` が設定済み
- **When**: main ブランチに push する
- **Then**: ワークフローが `npm ci` → `npm test` → `npm run build` → `dist/` を Pages に upload/deploy の順で実行し、成功すると `https://koyakimu.github.io/aws-bedrock-quick-reference/` が更新される

### AC-002 (単一 HTML のビルド)
- **Given**: `src/` にモジュール分割された HTML / CSS / JS と `data/*.json` がある
- **When**: `npm run build` を実行する
- **Then**: `dist/index.html` が 1 ファイルだけ出力され（vite-plugin-singlefile により CSS / JS / データが inline 化される）、外部ファイルへの参照を持たない

### AC-003 (サブパスで動く)
- **Given**: 公開 URL が `https://koyakimu.github.io/aws-bedrock-quick-reference/` というサブパス配下である
- **When**: ビルド成果物をその URL で開く
- **Then**: リンク・アセット参照・SHARE-001 の URL 組み立てがすべて解決し、404 やコンソールエラーが 0 件

### AC-004 (CI に AWS 認証情報を置かない)
- **Given**: 公開用ワークフロー
- **When**: ワークフロー定義とリポジトリ設定を確認する
- **Then**: AWS のアクセスキー、OIDC ロール、`aws-actions/configure-aws-credentials` のいずれも使われていない。データ取得（DATA-001）は手元の SSO で手動実行し、生成 JSON をコミットする運用に限る

### AC-005 (権限の最小化)
- **Given**: 公開用ワークフロー
- **When**: `permissions` を確認する
- **Then**: `contents: read` / `pages: write` / `id-token: write` のみが宣言されている（GitHub Pages の deploy に必要な範囲）

### AC-006 (Error Case: テスト失敗で公開しない)
- **Given**: `npm test` が失敗する変更を main に push する
- **When**: ワークフローが走る
- **Then**: build と deploy のステップは実行されず、公開中のページは直前の内容のまま変わらない。ワークフローは失敗として記録される

### AC-007 (Error Case: 生成データの欠損)
- **Given**: `data/models.json` / `data/profiles.json` / `data/fetch-log.json` のいずれかが存在しない、または JSON として壊れている
- **When**: `npm run build` を実行する
- **Then**: ビルドが非ゼロ終了で失敗し、どのファイルが問題かを示すメッセージが出る。壊れたデータを埋め込んだ HTML を出力してはいけない

### AC-008 (Error Case: 生データの混入防止)
- **Given**: `data/raw/` に取得時の生 JSON とエラー文がある
- **When**: コミットとビルドを行う
- **Then**: `data/raw/` は `.gitignore` されておりリポジトリに入らず、`dist/index.html` にも含まれない（AWS アカウント ID を含む ARN が公開物に出ない）

### AC-009 (PR のプレビューを artifact で添付する)
- **Given**: `.github/workflows/pr-preview.yml` が設定済み
- **When**: main 向けの PR を作る、またはその PR に push する
- **Then**: ワークフローが `npm ci` → `npm test` → `npm run build` → `dist/index.html` を artifact `pr-preview-<PR 番号>` として upload の順で実行する。artifact の URL を job summary に書き、保持期間は 14 日。Pages には deploy しない（Pages は 1 リポジトリに 1 サイトで、PR から deploy すると公開中のページを上書きするため）

### AC-010 (PR プレビューの権限と失敗の扱い)
- **Given**: PR プレビューのワークフロー
- **When**: `permissions` と失敗時の挙動を確認する
- **Then**: `permissions` は `contents: read` だけで、fork からの PR の読み取り専用トークンでも動く。`npm test` が落ちたら build と upload は走らず、PR のチェックは失敗として記録される。同じ PR への新しい push は進行中の実行を取り消す

### AC-NFR-001 (公開までの所要時間)
- **Given**: 通常の変更を main に push する
- **When**: ワークフローが走る
- **Then**: push から公開反映までが 5 分以内（GitHub Actions の実行時間で計測）

## UI Description

該当なし（CI/CD のみ）。

## Context Boundary

### Inputs
- **From**: DATA-001 — コミット済みの `data/models.json` / `profiles.json` / `fetch-log.json` / `region-notes.json` / `overrides.json`
- **From**: TABLE-001 / FILTER-001 / DETAIL-001 / I18N-001 / SHARE-001 — `src/` 配下のソースとテスト
- **From**: 外部（GitHub） — push イベント、main 向けの pull_request イベント

### Outputs
- **To**: 外部（GitHub Pages） — `dist/index.html`（単一 HTML）
- **To**: 外部（閲覧者） — `https://koyakimu.github.io/aws-bedrock-quick-reference/`
- **To**: 外部（PR のレビュー担当） — Actions の artifact `pr-preview-<PR 番号>`（`dist/index.html` の zip）

### Dependencies
- **全コンテキスト**: `npm test` が全 Spec の unit / integration テストを実行する。1 つでも失敗すれば公開しない

## Test Strategy

### AC Coverage

| AC ID | Test Type | Description |
|-------|-----------|-------------|
| AC-001 | integration（ワークフロー実行の確認） | ブランチに push して Actions の run が成功すること、ステップ順が `npm ci` → `npm test` → `npm run build` → deploy であることを確認 |
| AC-002 | unit (vitest) | ビルド後に `dist/` のファイルが `index.html` 1 件であること、HTML に `<script src=` / `<link rel="stylesheet" href=` の外部参照が無いことを検証 |
| AC-003 | e2e（Playwright MCP で公開 URL を開きスクリーンショットを手動確認） | コンソールエラーとネットワーク 404 が 0 件であることを確認。スクリーンショットはリポジトリに入れない |
| AC-004 | unit (vitest) | `.github/workflows/` 配下の YAML に `aws-actions/` / `AWS_ACCESS_KEY` / `role-to-assume` の文字列が無いことを検証 |
| AC-005 | unit (vitest) | ワークフロー YAML の `permissions` が想定の 3 キーのみであることを検証 |
| AC-006 | integration（ワークフロー実行の確認） | 意図的にテストを落としたブランチで、deploy ステップが skip され公開が変わらないことを確認 |
| AC-007 | integration (vitest) | データファイルを削除・破損させた一時ディレクトリでビルドを走らせ、非ゼロ終了とメッセージを検証 |
| AC-008 | unit (vitest) | `.gitignore` に `data/raw/` があること、`git ls-files data/raw` が空であること、ビルド成果物に 12 桁の数字列（アカウント ID）が無いことを検証 |
| AC-009 | unit (vitest) | `tests/pr-preview-workflow.test.js` で、トリガーが main 向けの `pull_request` だけであること、ステップ順、artifact の `name` / `path` / `retention-days`、job summary への URL 出力を検証 |
| AC-010 | unit (vitest) | 同じテストで `permissions` が `contents: read` だけであること、`continue-on-error` / `if` が無いこと、`concurrency` が PR 番号単位で `cancel-in-progress: true` であることを検証 |
| AC-NFR-001 | 計測 | Actions の run の所要時間を確認（3 回の実測で中央値 < 5 分） |

## Deliverable Previews

- `.github/workflows/deploy.yml` の構成案（ジョブ・ステップ・`permissions`・`concurrency`）

## 委譲する非機能要件

- **セキュリティレビュー: 不要。** 公開するのは静的 HTML 1 枚で、サーバも認証もユーザー入力の保存も無い。CI 側の懸念（認証情報の混入、権限過剰）は AC-004 / AC-005 / AC-008 として機械的なテストに落としてあるため、`/security-review` の委譲は行わない
- **可用性**: GitHub Pages の SLA に委ねる。独自の監視は持たない

## Notes

- 先例プロジェクト（aws-gpu-quick-reference）の deploy ワークフローを踏襲する
- 先例にあるデータ自動更新のワークフロー（cron での価格取得など）は作らない。CI からの自動データ更新は技術設計 §8 でスコープ外
- リアルタイム更新はしない（Design「What Not」5）。公開されるのは取得日が明示されたスナップショット
