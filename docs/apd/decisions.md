# Decisions

技術選択の記録。**新しい判断ほど上に積む。** 最終決定はユーザーが行い、AI の推奨は参考情報。

D-020 は同日、判定の列に接続先 (bedrock-runtime / bedrock-mantle) を出すためにオーナーが決定した。
D-019 は同日、Global のバッチ・キャッシュの取り込みと、docs と API の食い違いの扱いとしてオーナーが決定した。
D-018 は同日、Price List に無いモデルの単価の取り方としてオーナーが決定した。
D-017 は 2026-10-08 の価格の取り直しで、Mantle と Runtime の単価が違うモデルが見つかったことを受けてオーナーが決定した。
D-015・D-016 はモデル別の機能表（FEATURE-001、設計 `docs/superpowers/specs/2026-10-06-model-features-design.md`）の取り込みに伴って 2026-10-06 に決定した。
D-011〜D-014 は Design v3（画面ビュー・リージョン行列・データの流れ図・並び順）に伴って
2026-09-15 に起案し、同日ユーザーが推奨案どおりに決定した。
D-009 は Design v2 で価格が範囲に入ったことを受けて 2026-09-14 に決定した。
D-001〜D-005 は brainstorming の対話で内容が固まり、技術設計
（`docs/superpowers/specs/2026-09-14-bedrock-quick-reference-design.md`）から転記したものを
2026-09-14 にユーザーが確定した。D-006・D-007 は Spec フェーズで決定した。D-008 は Build 中に発生した矛盾の解消で、暫定決定 B をオーナーの指示で D に差し替えた。

---

## D-020: In-Region / Geo / Global の列に、bedrock-runtime と bedrock-mantle のどちらで使えるかを出す

- **Date**: 2026-10-08
- **Context**: 表の In-Region / Geo / Global は bedrock-runtime の API（ListFoundationModels / ListInferenceProfiles）で判定している。bedrock-mantle で使えるかは、2026-09-14 に docs を手で転記した `mantle.json`（In-Region だけ、新しいモデルが載っていない）にしか無かった。docs のモデルカードの Regional Availability（新しい書式では Supported Regions）には、接続先ごと・リージョンごとに In-Region / Geo / Global の表がある
- **Decision**（2026-10-08、オーナー指示「In-Region・Geo推論・Global推論それぞれ Runtime でできるのか Mantle でできるのかも列に記載してほしい」）:
  - 判定の 3 列の各セルの下段に「Runtime ✓/✕」「Mantle ✓/✕/—」を出す。上段の判定・並べ替え・絞り込みは bedrock-runtime の API のまま
  - Mantle の値は、機能表の取得処理がモデルカードの地域の表を接続先ごとに読んだもの（`features.json` の `regions`）。Programmatic Access に bedrock-mantle の行が無ければ不可。地域の表が無ければ In-Region だけ `mantle.json` で決める。どれにも記載が無ければ「—」
  - 接続先の見出しが無く、接続先が 2 つあるカード（DeepSeek・Mistral・GLM など 30 件）の表は、どちらかに割り当てず `shared`（接続先を分けていない表）として持ち、Mantle の値に使うときは title にその旨を出す
- **Refs**: `scripts/lib/features.mjs`（`parseRegions`）、`src/scripts/feature-model.mjs`（`endpointAvailability`）、`spec-table.md` v12

---

## D-019: Global のバッチ・キャッシュを取り込み、docs と API の推論 ID の食い違いを注釈する

- **Date**: 2026-10-08
- **Context**: PRICE-001 v1 では Global とバッチ・キャッシュの組み合わせを範囲外にしていたが、Price List（東京だけで 91 SKU）と Marketplace の rateCard に値がある。また GPT-5.4 / 5.5 は ListInferenceProfiles に `us.` / `global.` があるのに、docs のモデルカードでは bedrock-mantle 専用（Geo / Global は Not supported）。Nova Lite / Micro は API に `apac.`（Lite は `ca.` も）があるが、docs の表は `us.` / `eu.` だけ
- **Decision**（2026-10-08、オーナー指示「Global のバッチ・キャッシュも取り込んで」「食い違いがある場合は注釈をいれてほしい」）:
  - 価格の種別に `globalBatch` / `globalCacheRead` / `globalCacheWrite` を足し、詳細の Global のタブに出す。Global と priority / flex の組み合わせは引き続き範囲外
  - 表の Geo / Global の判定は API（ListInferenceProfiles）に従ったまま変えない。docs のモデルカードの Programmatic Access の表（bedrock-runtime の行）と推論 ID が食い違うときは、一覧のセルに「docs と相違」、詳細の Geo / Global のタブに両方の ID とモデルカードへのリンクを出す
  - 比べない: カードの行が別の ID（文脈長の付いた Provisioned 専用の ID）、GovCloud（`us-gov.`）の ID、カードの表が読めないモデル
- **Refs**: `spec-price.md`、`scripts/lib/features.mjs`（`parseEndpoints`）、`src/scripts/feature-model.mjs`（`inferenceMismatches`）

---

## D-018: Price List に無いモデルの単価を AWS Marketplace の offer から取る

- **Date**: 2026-10-08
- **Context**: 2026-10-08 時点で、GPT-5.4 / 5.5 / 5.6 系 / 6 系と Stability の画像編集系 13 件は、商用リージョンの Price List（Bulk API・Query API とも）に SKU が無い。docs のモデルカードと料金ページには価格がある。手書きの補完 JSON は D-017 と同日に廃止した。Bedrock の `ListFoundationModelAgreementOffers` と Marketplace Discovery の `GetOfferTerms` を実際に呼ぶと、同じ単価表（rateCard）が返り、Price List にある GPT-6 Astra では値が Price List と完全に一致した
- **Options**:
  - A: Price List だけを使い、無いモデルは価格未収録にする
  - B: docs のモデルカードの Pricing の節をパースして補う
  - C: **Price List を優先し、Price List に bedrock-runtime の単価が無いモデルだけ Marketplace の offer の rateCard で補う。出典を書く。それでも無いモデルは docs のモデルカードへリンクする**
- **Decision**: **C**（2026-10-08、オーナー承認）
- **Reason**: AWS の API が返す値で、Price List と同じ値になることを確かめられた。docs のパースより機械的で、表の書式変更に左右されない
- **運用**:
  - `scripts/fetch-bedrock-marketplace-prices.mjs` が models.json の全モデルに `ListFoundationModelAgreementOffers` を呼び、`data/marketplace-prices.json` を出す。認証が要るので手元の SSO で手動実行する（D-002。CI では走らせない）
  - `scripts/fetch-bedrock-prices.mjs` が `data/marketplace-prices.json` を読み、Price List に bedrock-runtime の単価が 1 つも無いモデルだけを埋める。埋めたリージョンには `source: { type: "marketplace", offerId }` を付け、画面に出典を出す
  - rateCard の単位は "Units" としか書かれないが、値は docs の USD / 100 万トークンと一致する。リージョンの区別が無い単価は、In-Region（ON_DEMAND）か Geo のプロファイルの起点に標準系を、Global のプロファイルの起点に global を当てる。リージョンの略号付きの単価（GPT-5.4 / 5.5）は Price List の usagetype から作った略号の索引でリージョンに戻す
  - Marketplace 経由でないモデル（Grok、Kimi、GLM、Titan など）は `Agreement not supported for this model` で offer が無い。これらで Runtime の単価が無いものは、表と詳細に docs のモデルカード（無ければ料金ページ）へのリンクを出す
- **Refs**: `spec-price.md`（「AWS Marketplace の offer による補完」）、`docs/price-list-api.md`、D-002、D-017

---

## D-017: bedrock-runtime と bedrock-mantle の価格を分けて持つ

- **Date**: 2026-10-08
- **Context**: D-009 では `-mantle-` の SKU を「通常の接続先と同じ単価の別 SKU」として取り込まなかった（Design FAQ Q14）。2026-10-08 の Price List で、Qwen3 Next 80B は Runtime と Mantle で単価が違った（ap-south-1 の standard: Runtime 0.18 / 1.41、Mantle 0.168 / 1.44）。また Grok 4.6 / 4.7 と Kimi K3 は `-mantle-` の SKU しか無い。手書きの補完 JSON は同日に廃止した（Price List の値だけを使う）
- **Options**:
  - A: `-mantle-` の SKU を捨てる（D-009 のまま）。Mantle の単価が見えず、Mantle しか SKU の無いモデルは価格未収録になる
  - B: Runtime の SKU が無い軸だけ Mantle の単価で埋める。単価が違うモデルで、Mantle の値が Runtime の値として表に出る
  - C: **Runtime と Mantle の単価を別々に持ち、別々に表示する**。`prices.json` の `byModel[M][R]` の種別は Runtime、`byModel[M][R].mantle` の種別は Mantle
- **Decision**: **C**（2026-10-08、オーナー指示「Runtime と Mantle はそれぞれ別の価格、機能」）
- **Reason**: Runtime と Mantle は別の接続先で、機能（FEATURE-001 の runtime / mantle）と同じく価格も別に決まる。混ぜると、片方の値をもう片方の値として見せてしまう
- **運用**: 表の価格列・並べ替え・参考価格は Runtime の単価だけを使う。詳細パネルの価格の節に、bedrock-runtime と bedrock-mantle の表を分けて出す。Mantle の SKU しか無いモデル（Grok 4.6 / 4.7、Kimi K3）は、表では価格未収録、詳細では Mantle の表だけになる
- **Refs**: `spec-price.md`（「Price List の書き方の揺れ」）、D-009、Design FAQ Q14

---

## D-016: 機能表を定期取得し、差分を PR で取り込む

- **Date**: 2026-10-06
- **Context**: D-015 で機能表の取得元を英語版 docs の `.md` に決めた。docs のモデルカードは頻繁に変わる（新モデルのカードの追加、機能の Supported / Not Supported の切り替え、機能名の表記の変更）ので、判定データ（D-002）のように「新しいモデルが出たとき」に手で取り直す運用では古さが溜まる。一方で取得は認証が要らず（D-015）、CI に AWS の権限を置かずに自動化できる。ただし docs の変化をそのまま公開すると、書式の変更でパースが空振りしたときに全データが消えたページが公開されうる。
- **Options**:
  - A: **手動で取り直す。** 価格（D-009）と同じく、メンテナが気づいたときに CLI を走らせてコミットする。仕組みは要らないが、docs の更新に追随できない
  - B: **GitHub Actions で毎日取り直し、差分があれば PR を作る。** 公開は人が PR を merge したときだけ。PR 本文に機能の増減・未知の機能名・引けないカードの要約を載せ、メンテナが確認してから入れる
  - C: **GitHub Actions で毎日取り直し、main に直接 commit する。** 人手が要らないが、パースの空振りや誤った寄せ方がレビューなしで公開される
- **AI Recommendation**: **B**。取得の自動化で追随の遅れを解消しつつ、公開の前に人の確認を 1 回挟める。未知の機能名（`unknown:<slug>`）を寄せるかどうかはメンテナの判断で、それを PR の場で行える。C ではパースの失敗や誤った寄せ方が公開まで素通りする
- **Decision**: **B**（2026-10-06、オーナー承認）
- **Reason**: docs の更新に毎日追随でき、公開の前に PR のレビューを 1 回挟める。workflow は AWS の認証要素を持たず（D-002 を崩さない）、GitHub の権限も `contents: write` と `pull-requests: write` だけで足りる
- **運用**:
  - `.github/workflows/refresh-features.yml` が `schedule`（毎週日曜 UTC 21:00 = 月曜 JST 06:00。当初は毎日、2026-10-07 に週 1 回へ変更）と `workflow_dispatch` で走り、`node scripts/fetch-bedrock-features.mjs` → `npm test` の後、`data/features.json` に差分があれば固定ブランチ `bot/refresh-features` に force push して PR を作る（既に開いていれば本文だけ更新）
  - 空の差分を作らないため、内容が前回と同じなら `generatedAt` を据え置く（FEATURE-001 AC-007）。パースの空振りで全データを消す PR を作らないため、`cardsWithFeatures` が前回の半分未満なら書き出さずに失敗する（同 AC-008）
  - 頻度は週 1 回にする（2026-10-07、オーナー判断）。毎日では PR の確認が追いつかず、`bot/refresh-features` の PR は開いている間に本文が上書きされるだけなので、週 1 回でも取りこぼしは無い。急ぐときは `workflow_dispatch` で手動実行する
  - GITHUB_TOKEN で作った PR は他の workflow を起動しないが、テストはこの job の中で走らせ済み。公開は従来どおり main への merge で `deploy.yml` が行う
- **オーナー作業**: リポジトリ設定 **Settings → Actions → General → Workflow permissions** の *Allow GitHub Actions to create and approve pull requests* を有効にする。これが無効だと GITHUB_TOKEN で `gh pr create` ができず、workflow は PR 作成の段で失敗する
- **Refs**: `spec-features.md`（FEATURE-001 AC-015 / AC-016）、workflow は `.github/workflows/refresh-features.yml`、テストは `tests/refresh-features-workflow.test.js`

## D-015: 機能表の取得元を英語版の公式 docs の `.md` にする

- **Date**: 2026-10-06
- **Context**: 公式 docs のモデルカードにある **Capabilities and Features**（Guardrails / Prompt caching / Structured outputs / Tool calling などの対応可否を `bedrock-runtime` / `bedrock-mantle` 別に示す表）を、モデルごとに表と詳細パネルで見せたい。どこから取るかを決める必要がある。2026-10-06 に確認した事実: 機能の対応可否を返す API は無い（`ListFoundationModels` / `GetFoundationModel` が返すのはモダリティ・`responseStreamingSupported`・`customizationsSupported`・`inferenceTypesSupported`・ライフサイクルだけ。us-east-1 で実際に呼んで確認し、botocore の bedrock 108 操作・bedrock-runtime 11 操作にも該当が無い）。Pricing の `index.json`（D-009）に当たる機械可読の配信も無い。一方で docs の各ページは `.html` を `.md` に替えると `text/markdown` で取れ（認証不要、`Last-Modified` / `ETag` 付き）、全ページは `toc-contents.json` で列挙できる。モデルカード 134 本中 118 本に機能の節がある。
- **Options**:
  - A: **API から取る。** 該当する API が無いので選べない
  - B: **docs の HTML を scrape する。** 取れるが、D-002 / D-003 / D-009 で B を退けたのと同じ理由（HTML 構造の変更に弱い）が当てはまる
  - C: **サードパーティの DB（models.dev / LiteLLM など）を使う。** JSON で配信されていて取り込みは楽だが、AWS の一次情報ではなく、値が docs と食い違う。実例: **Sonnet 5.5 の Structured outputs は、公式 docs と models.dev では非対応だが、LiteLLM は `supports_response_schema: true`**。どちらが正しいかを確かめるには結局 docs を読むことになる
  - D: **手書きで転記する**（`mantle.json` 方式、D-010）。出典は正しいが、134 本 × 26 種の表記（正規化後 23 キー）の機能を手で追うのは更新頻度に見合わず、転記の誤りも入る
  - E: **英語版の公式 docs の `.md` を取ってパースする。** `toc-contents.json` で `model-card-*.html` を列挙し、各ページの `.md` を `Accept-Language: en-US` で取る。Markdown の表は HTML より構造が単純で、AWS 自身が配信している
- **AI Recommendation**: **E**。一次情報そのもので、認証が要らず CI からも取れる（D-016）。Markdown の表は Supported / Not Supported の 2 セルと `icon-yes.png` / `icon-no.png` の画像で書かれていて機械的に読める。機能名の表記揺れ（docs 上 26 種、正規化後 23 キー）は手書きの対応表で寄せ、対応表に無い名前は推測で寄せずに `unknown:<slug>` として出す（D-009 の `price-model-map.json` と同じ規約）
- **Decision**: **E**（2026-10-06、オーナー承認）
- **Reason**: **最も信頼できる情報源は英語版の AWS 公式 docs** であり、それを機械可読に近い形（`.md`）で、認証なしに取れるため。サードパーティの DB は Sonnet 5.5 の Structured outputs のように docs と食い違う値を持ち、正誤の判定に結局 docs が要る。日本語版の docs は翻訳の遅れがあるので使わない
- **取り込みの規約**:
  - 取得元は `https://docs.aws.amazon.com/bedrock/latest/userguide/` の `toc-contents.json` と `model-card-*.md` だけ。日本語版の docs とサードパーティは使わない
  - 機能名は `data/feature-names.json` で正規化キーに寄せる。**対応表に無い名前は推測で寄せず**、`unknown:<slug>` で画面に出して `unknownFeatures` に数える
  - モデル ID は Programmatic Access 表の `bedrock-runtime` 行の Model ID 列（`N/A` なら同じ行の inference ID から接頭辞を外す）で引き、自動で引けないものは `data/feature-model-map.json` に書く。どちらでも引けないカードは `unmatchedCards` に残す（推測で結び付けない）
  - 値は true / false / キーなし の 3 状態。「記載なし」を false に倒さない（D-003 の「提供なし」と「データなし」の区別）
  - 画面の機能名は ja / en とも docs の英語名のまま出す（訳すと解釈が入る）
- **Refs**: `spec-features.md`（FEATURE-001）、`spec-table.md`（TABLE-001 v10 AC-016）、`spec-detail.md`（DETAIL-001 v10 AC-023）、`spec-share.md`（SHARE-001 v5 AC-014）、実装は `scripts/lib/features.mjs` と `scripts/fetch-bedrock-features.mjs`、設計 `docs/superpowers/specs/2026-10-06-model-features-design.md` の 2 節

---

## D-014: データの流れ図に書いてよい主張の基準

- **Date**: 2026-09-15
- **Context**: FLOW-001 の図は「データがどこへ行き、記録がどこに残るか」を断言する形で描く。ところが根拠の強さは主張ごとに違う。CloudTrail が起点リージョンに記録すること、料金が起点リージョンで計算されること、バッチ出力が起点リージョンの S3 に置かれること、不正利用検知で保存される入出力が推論先に置かれうることは公式 docs に**明記**がある。一方でモデル呼び出しログ（model invocation logging）の所在は、`model-invocation-logging.html` が cross-Region inference に一切触れておらず、「出力先は設定と同じアカウント・同じリージョンでなければならない」という別の記述からの**推定**でしかない。図は断言の形をしているので、根拠の強さの違いが読み手に伝わらない。
- **Options**:
  - A: **明記のある主張だけを図に書く。** 推定の部分（呼び出しログ）は図から落とす。正確だが、監査でよく聞かれる「ログはどこ？」に答えられなくなる
  - B: **推定も明記と同じ調子で書く。** 図は読みやすくなるが、AWS が明記していないことを明記しているかのように見せることになり、Design の Success Criteria「人の解釈による差分ゼロ」に反する
  - C: **推定も書くが「推定」と明示する。** 図の出典の行に「呼び出しログの所在は『出力先は同一リージョン限定』からの推定」と書き、Spec 側に主張と根拠の対応表（FLOW-001 AC-008）を持って、docs が明記に変わったら表と画面の文言を同時に直す
- **AI Recommendation**: **C**。このサイトが売りにしているのは「根拠付きで説明できる」ことで、読み手は図をそのまま社内説明に使う。推定を落とす（A）と説明の穴が残り、黙って断言する（B）と読み手が根拠の無い断言を持ち帰ることになる。表を Spec に持てば、docs の更新で直す場所が 1 か所に決まる
- **Decision**: **C**（2026-09-15、推奨案を採用）
- **Reason**: 推定を落とすと監査の「ログはどこ」に答えられず、断言すると根拠の無い主張を持ち帰らせる。「推定」と明示し、根拠表を FLOW-001 AC-008 に持って docs の更新時に 1 か所で直す
- **主張と根拠の一覧**: FLOW-001 AC-008 の表（C-1 〜 C-8）。明記が 7 件、推定が 1 件（C-5 モデル呼び出しログ）
- **Refs**: `spec-flow.md`（FLOW-001 AC-007 / AC-008）、`spec-detail.md`（DETAIL-001 v8）

## D-013: リージョン横断の事実をどの画面に置くか

- **Date**: 2026-09-15
- **Context**: DETAIL-001 v7 の詳細パネルは 6 節（モデル ID / 使い方 / 価格 / 提供状況 / 推論プロファイル / 接続先）を縦に積んでいた。このうち「提供状況」は全 33 リージョンの availability の一覧、「推論プロファイル」はプロファイルごとの 起点 → 推論先 の全行で、どちらも**その起点に依らない事実**である。1 行ずつ開かないと読めないため「このモデルはどの国で使えるのか」を横断で比べられず、逆にパネルの中心にあるべき「この起点からこう使うとどこへ行くのか」が縦に長い一覧に埋もれていた。
- **Options**:
  - A: **パネルの構成だけを変える。** 6 節の順番を入れ替え、折りたためるようにする。画面は増えないが、横断の比較はできないまま
  - B: **横断の事実をトップレベルのビューに出す。** ヘッダ直下にタブを置き、「起点から」（既存）と「リージョン」（モデル × 全リージョンの行列）に分ける。パネルからは「提供状況」を外し、使い方（レーン）ごとの図に絞る。「推論プロファイル」節に当たる「プロファイル」ビューも同じ形で作れる
  - C: **B のうち「リージョン」と「プロファイル」の 2 ビューを同時に作る。** 情報の置き場所は最も整理されるが、1 サイクルで作る量が倍になり、プロファイルのビューは誰がどう使うかがまだ固まっていない
- **AI Recommendation**: **B**（「プロファイル」ビューは先送り）。「リージョン」の行列は先例の GPU サイトに同じものがあり、使われ方が確かめられている。「推論プロファイル」節の情報は Geo のレーンの図と推論先の一覧で実用上は足り、プロファイルを主語にして全起点を並べたい場面がどれだけあるかはまだ分からない。パネルから外して先送りし、要望が出た時点で 3 つ目のビューとして足す
- **Decision**: **B（「プロファイル」ビューは先送り）**（2026-09-15、推奨案を採用）
- **Reason**: 横断の事実は起点に依らないので詳細パネルより画面レベルのビューが適切。行列は GPU サイトに先例がある。プロファイルを主語にした一覧は用途が固まっていないため、要望が出た時点で 3 つ目のビューとして足す
- **先送りするもの**: 3 つ目のビュー「プロファイル」（推論プロファイルごとに 起点 → 推論先 の全行を並べる）。DETAIL-001 v7 の「推論プロファイル」節（旧 AC-005 / AC-006 / AC-009）の情報はそこへ移す。それまでの間、プロファイル ID は各レーンの「指定する ID」から、推論先は同じレーンの一覧から読める
- **Refs**: `spec-regions.md`（REGIONS-001）、`spec-detail.md`（DETAIL-001 v8）、`spec-flow.md`（FLOW-001）、`spec-share.md`（SHARE-001 v4 AC-011 / AC-012）

## D-012: 地理圏（Geo）の接頭辞をどう決めるか

- **Date**: 2026-09-15
- **Context**: D-003 は Geo の判定を「接頭辞が `us.` `eu.` `apac.` `au.` `jp.` のいずれか」と書いた固定リストで定めた。2026-09-15 のスナップショットには `ca.amazon.nova-lite-v1:0`（1 件）と `in.openai.gpt-5.6-luna` / `in.openai.gpt-5.6-terra`（2 件）が現れ、固定リストでは Geo と判定されずどの列にも出ない。公式 docs も閉じた一覧を公開していない: `models-region-compatibility.html` は「US, EU, Japan, or Australia」と書き、`geographic-cross-region-inference.html` は「such as US, EU, and APAC」と書いていて、**2 ページの列挙が互いに食い違う**（前者に APAC が無く、後者に Japan と Australia が無い）。どちらも「例示」であって定義ではない。
- **Options**:
  - A: **固定リストを維持し、見つかるたびに足す。** 判定は明示的だが、新しい接頭辞が出るたびにモデルが黙って表から消える。消えたことに気づく仕組みが無い
  - B: **`global` 以外の接頭辞はすべて地理圏として扱う。** API のスナップショットが正になり、新しい接頭辞は自動的に Geo 列・限定の選択肢・行列のグループに現れる。ラベルが辞書に無い接頭辞はコードがそのまま出る
  - C: **B に加えて、未知の接頭辞が出たら取得スクリプトが警告を出す。** 気づけるが、警告を見るのはメンテナだけで、画面の正しさには寄与しない
- **AI Recommendation**: **B**。「`global` は全世界、それ以外は地理的に限定された集合」という区別は AWS の説明と一致しており、その区別さえあれば判定に閉じた一覧は要らない。docs が閉じた一覧を公開していない以上、固定リストを持つことは「AWS が言っていないことを決める」ことになり、Design の「人の解釈を挟まない」に反する。ラベルは辞書の話なので、無いときはコードを出すフォールバックで足りる（既存の実装がすでにそう振る舞う）
- **Decision**: **B**（2026-09-15、推奨案を採用）
- **Reason**: docs が閉じた一覧を公開しておらずページ間で食い違うため、固定リストは「AWS が言っていないことを決める」ことになる。`global` 以外は地理的に限定された集合という区別だけで判定でき、`ca.` / `in.` の取りこぼしも解消する
- **併せて直すもの**: `data/region-notes.json` の `geo` に `ca`（`ca-central-1` / `ca-west-1`）と `in`（`ap-south-1` / `ap-south-2`）を足す。これで行列の列グループ（REGIONS-001 AC-004）、カスタムのピッカーのグループ（FILTER-001 AC-013）、推論先の限定の選択肢（同 AC-018、`geo:ca` は `country:ca` に、`geo:in` は `country:in` に畳まれる）、Geo の図の国の環（FLOW-001 AC-004）がそろって追随する。**どれも固定リストを持たないのでコードの変更は要らない**
- **出典の食い違い**: `models-region-compatibility.html`（US, EU, Japan, or Australia）と `geographic-cross-region-inference.html`（such as US, EU, and APAC）。どちらも例示で、閉じた一覧ではない。したがって API のスナップショットを正とする
- **Refs**: `spec-data.md`（DATA-001 v3 AC-013 / AC-014）、`spec-table.md`（TABLE-001 v9 AC-004）、`spec-filter.md`（FILTER-001 v5 AC-020）、`spec-regions.md`（REGIONS-001 AC-004）、`spec-flow.md`（FLOW-001 AC-004）、D-003 の判定表の 2026-09-15 追記

## D-011: 一覧の行の並び順

- **Date**: 2026-09-15
- **Context**: TABLE-001 v8 までの行の並びは「プロバイダ → モデル名」の単純な昇順で、`Amazon` / `Anthropic` / `Cohere` … と並ぶ。実際に最もよく参照されるのは Anthropic と OpenAI の行で、東京起点では 68 行の中ほどまでスクロールしないと Anthropic に届かない。一方で「どのモデルを選ぶべきか」の助言をしないことは Design の「What Not」4 で明言しており、並び順で暗に推奨するように見えるのは避けたい。
- **Options**:
  - A: **純粋な昇順のままにする。** 編集上の判断がゼロで最も中立。よく見る行に届くまでのスクロールは読み手の負担のまま
  - B: **よく参照されるプロバイダを上に固定し、そのことを画面に出さない。** 読みやすくなるが、読み手からは「なぜこの順なのか」が分からず、中立な一覧に見えたまま順位付けが混ざる。最も避けたい形
  - C: **固定するが、隠さない。** 既定は固定順（Anthropic → OpenAI → 残りは昇順）、列ヘッダのクリックまたは並べ替えのセレクタで純粋な昇順に切り替えられ、選んだ並びは URL（`sort=`）に載る。脚注に「どの 2 社を固定しているか」を書く
- **AI Recommendation**: **C**。並び順は事実ではなく編集上の判断なので、判断したこと自体を見せて戻せるようにするのが誠実。固定するのは順番だけで、行を隠したり判定・価格・絞り込みの結果を変えたりしない以上、「What Not」4 の性能比較・推奨には当たらない
- **Decision**: **C**（2026-09-15、推奨案を採用）
- **Reason**: 並び順は編集上の判断なので、判断したことを画面に明示して戻せるようにする。順番だけを固定し、行の有無や判定・価格・絞り込みには影響しないので What Not 4 に当たらない
- **固定するプロバイダ**: `Anthropic` → `OpenAI` の 2 社。データに存在しない場合は単に飛ばす（空の見出しを作らない）
- **Refs**: `spec-table.md`（TABLE-001 v9 AC-014 / AC-015）、`spec-regions.md`（REGIONS-001 AC-003）、`spec-share.md`（SHARE-001 v4 AC-013）

---

## D-010: bedrock-mantle の対応モデルをどこから取るか

- **Date**: 2026-09-14
- **Context**: MANTLE-001 は「モデル M を起点リージョン R の `bedrock-mantle` から呼べるか」を表の 1 列で出す。ところが `data/models.json` の元になる `ListFoundationModels` は `bedrock-runtime` 側の提供状況しか返さず、エンドポイント別の対応は API から取れない。同じ事実は公式 docs の Endpoint availability に**プロバイダ別の表**として載っており、そこには mantle だけにあるモデルと runtime だけにあるモデルの両方がある。
- **Options**:
  - A: **公式 docs の対応表を転記した手書きファイル** `data/mantle.json` を置く。`data/region-notes.json` と同じ扱い（手書き・出典 URL と日付を `_source` に持つ・記憶で足さない）
  - B: **OpenAI 互換の `GET /v1/models` をリージョンごとに叩く**。機械可読で取り漏らしが無いが、実行に Bedrock の認証情報が要り、しかも必要な IAM アクションは D-005 で用意する読み取り専用ロール（`bedrock:ListFoundationModels` と `bedrock:ListInferenceProfiles` だけ）に含まれていない
  - C: **Mantle 列を出さない。** 接続先の違いは脚注で触れるだけにする
- **AI Recommendation**: **A**。公開されていて認証の要らない唯一の出典であり、更新頻度（新モデルが出たとき）に対して転記のコストが見合う。B はロールの権限を広げる判断（D-005 の再検討）を伴い、機能 1 つのために認証の必要な取得経路をもう 1 本増やすことになる。C は Design v2 の「もう一つの接続先（Mantle）が分かる」を満たさない
- **Decision**: **A**
- **Reason**: 公開されている唯一の出典だから。オーナー承認 2026-09-14
- **転記の規約**: `data/region-notes.json` と同じ（D-004）。**記憶で足さず、必ず doc を読んでから転記する。** `_source` に転記元の URL 3 本と日付を書く。docs のモデル名は `models.json` の `name` と**大文字小文字を無視した完全一致**で引き、突き合わなかった名前は推測で結び付けず `_unmatched` にそのまま残す。`models.json` に無い mantle 専用モデルは `mantleOnly` に残し、転記の欠落と区別できるようにする
- **Refs**: `spec-mantle.md`（MANTLE-001）、`spec-table.md`（v7 AC-002 / AC-006）、`spec-detail.md`（v6 AC-012）、データは `data/mantle.json`、判定は `src/scripts/mantle-model.mjs`

## D-009: 価格データの取得元

- **Date**: 2026-09-14
- **Context**: Design version 2 で「価格の目安が同じ行で分かる」が範囲に入り、モデル × 起点リージョンの入力・出力の単価をどこから取るかを決める必要が出た。判定データ（D-002）は `aws` CLI + SSO の手動実行だが、価格は認証の要らない配信がある。Bedrock の価格は 1 つの offer に収まっておらず、`AmazonBedrock`（Nova / Titan / OpenAI / Google / Mistral / Qwen / xAI / Z.AI / DeepSeek / NVIDIA / Moonshot / MiniMax ほか）と `AmazonBedrockFoundationModels`（Anthropic Claude / Cohere Embed / TwelveLabs）に分かれ、単位も `1K tokens` と `1M tokens` で違う。
- **Options**:
  - A: **AWS Price List Bulk API のリージョン別ファイルを取り込む**。`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<offerCode>/current/<region>/index.json` を認証なしで取得し、正規化して `data/prices.json` にコミットする
  - B: **料金ページ（HTML）を scrape する**。表示どおりの値が取れるが、HTML 構造の変更に弱く、D-002 / D-003 で B を退けたのと同じ理由が当てはまる
  - C: **価格を載せない**。Design v2 の「What」に反する
- **AI Recommendation**: **A**。AWS 自身が機械可読な形で配信しており、認証が要らないので CI からでも取れる。人の解釈を挟まない点で Success Criteria（人の解釈による差分ゼロ）とも合う
- **Decision**: **A**
- **Reason**: 公開・機械可読で、オーナーが 2026-09-14 に承認した。認証情報が要らないので取得の再現性が高い（D-002 の `aws` CLI 経路と違い、誰でも同じ結果を得られる）
- **取り込みの範囲**: offer は `AmazonBedrock` と `AmazonBedrockFoundationModels` の 2 つ。`AmazonBedrockService`（Mantle / cross-region / 予約 TPM）と `AmazonBedrockAgentCore` はトークン単価を持たないため対象外。単価はすべて **USD / 100 万トークン**に揃える（`1K tokens` は 1000 倍）。`-mantle-` の SKU は通常の接続先と同じ単価の別 SKU なので載せない（Design FAQ Q14）。**2026-10-08 に D-017 で変更**: 単価が違うモデルがあるため、bedrock-mantle の単価として別に持つ
- **モデル名の対応**: `AmazonBedrockFoundationModels` には `model` 属性が無く、モデル名は `servicename`（`Claude Opus 5 (Amazon Bedrock Edition)`）に入る。自動一致（接尾辞を外して `models.json` の `name` と大文字小文字・記号を無視して比較）で当たらないものは、手書きの `data/price-model-map.json` で対応させる。どちらでも引けない SKU は `data/raw/<日付>/prices-unmapped.json` に書き出して `prices.json` の `unmapped` に数え、メンテナが地図を足せるようにする（推測で結び付けない）
- **Refs**: `spec-price.md`（PRICE-001）、`spec-table.md`（TABLE-001 v8 AC-005 / AC-008 / AC-013）、`spec-detail.md`（DETAIL-001 v7 AC-013）、実装は `scripts/lib/prices.mjs` と `scripts/fetch-bedrock-prices.mjs`

## D-008: fetch-log.json に残す「取得できなかった理由」の形

- **Date**: 2026-09-14（Decision を D に差し替え）
- **Context**: DATA-001 AC-010 は denied リージョンの理由を「要約せず原文で」残すことを求め、AC-011 は生成 JSON に 12 桁のアカウント ID が含まれないことを求める。SCP 拒否の AccessDeniedException の原文には、呼び出し元の principal ARN（アカウント ID・permission set 名・IAM セッション名）と Organizations のポリシー ARN（組織 ID・ポリシー ID）が埋め込まれており、両立しない。生成 JSON は public リポジトリにコミットされ、公開サイトにもそのまま描画される。
- **Options**:
  - A: 原文をそのまま残す（AC-010 優先）。アカウント ID が公開リポジトリに載る
  - B: 理由文中の 12 桁の数字列だけを `<account-id>` に置換し、それ以外は一字も変えない
  - C: 理由文を例外クラス名だけに要約する
  - D: 理由の原文は公開データに一切載せず、分類（`cause`）だけを残す。原文は gitignore の `data/raw/<日付>/*.err` にのみ残る
- **AI Recommendation**: 当初は **B** を採った（置換が機械的で、根拠も読める）
- **Decision**: **D**。理由の原文は公開データに一切載せず、分類（`cause`）だけを残す。原文は gitignore の `data/raw` にのみ残る
- **Reason**: オーナーの指示「エラー情報は出さない」。B は伏字の網羅性に依存し、AWS 側がエラー文の書式を変えたら伏せ漏れが公開リポジトリに出る。分類だけを残せば、載る値が 5 種の enum に閉じるので、伏せ漏れという失敗様式そのものが無くなる。「提供なし」と「データなし」の区別（D-003）は `status` で付き、閲覧者が知りたい粒度（組織のポリシー / 未有効化 / 接続不可）は `cause` で足りる。原因の追跡が要るときは手元の `data/raw/<日付>/*.err` を読む
- **cause の値**: `scp-deny`（AccessDeniedException かつ SCP の明示 Deny）/ `access-denied`（それ以外の AccessDeniedException）/ `not-opted-in`（未有効化の opt-in リージョン）/ `timeout`（接続できない）/ `other`
- **2026-09-14 追記**: 画面には分類（`cause`）も出さないことにした。取得できなかったリージョンは「未取得」とだけ表示し、理由は書かない（TABLE-001 v5 AC-009、DETAIL-001 v5 AC-008）。分類は取得作業をするメンテナ向けの情報で、閲覧者には意味が無く、「使えないリージョン」と誤読されるため。**Decision 自体は変えない**: `cause` は `fetch-log.json` に残り、エラー原文は引き続き公開データに載せない
- **Refs**: `spec-data.md`（DATA-001 AC-010 / AC-011 / AC-012）、`spec-table.md`（AC-009）、`spec-detail.md`（AC-008）、`spec-i18n.md`、実装は `scripts/lib/normalize.mjs` の `classifyFetchError`

## D-007: 推論先の限定フィルタの指定方法

- **Date**: 2026-09-14
- **Context**: Design の「推論先を限定して絞れる」を実装するには、閲覧者が「収まっていてほしいリージョンの集合」をどう指定するかを決める必要がある。起点が東京なら「日本国内のみ」、フランクフルトなら「EU 内のみ」といった使い方が想定されている。判定そのもの（destination ⊆ 限定集合、In-Region は起点が集合に入れば満たす、Global は常に満たさない）は方式によらず同じ。
- **Options**:
  - A: **固定リストからの単一選択**。国（日本 / オーストラリア / 米国）と地理圏（jp / apac / eu / us / au、プロファイル接頭辞から destination の和集合で導出）を並べたセレクタ。実装が軽く、選択肢が「よくある問い」と一致する。反面、リストに無い国（ドイツ単独、カナダ単独など）は指定できない
  - B: **リージョンの複数選択（自由集合）**。閲覧者が許可するリージョンをチェックして集合を作る。任意の条件を表現できるが、全リージョンから選ぶ操作は重く、Design の「一度の選択で済む」という定性目標に反する
  - C: **A を既定にし、「カスタム」を選ぶと B のリージョン複数選択に展開するハイブリッド**。よくある問いは 1 選択で済み、特殊な条件も表現できる。UI と URL のシリアライズ（SHARE-001）が 2 系統になる
- **AI Recommendation**: **C**。まず A だけを実装して公開し、「リストに無い国で絞りたい」という要望が実際に出た時点で B の経路を足す。A と C は判定関数が同じ（`satisfiesLimit(destinations, L)` に渡す `L` の作り方だけが違う）ため、後から足しても手戻りが小さい
- **Decision**: **C**
- **Reason**: よくある問い（自国内・地理圏内）は 1 選択で済ませたい。今回のサイクルは固定リスト（A の経路）だけを実装し、カスタムのリージョン複数選択は要望が出た時点で足す。判定関数は同じなので後から足しても手戻りが小さい
- **Refs**: `spec-filter.md`（FILTER-001 v3）、`spec-share.md`（SHARE-001 v2 の `limit` パラメータ）
- **実装状況** (2026-09-14 追記): カスタムのリージョン複数選択も実装済み（Issue #1）。Decision は C のまま変わらない。固定リストは初回サイクル、カスタムは Issue #1 で、推奨どおり判定関数 `satisfiesLimit(destinations, L)` は変えずに `L` の作り方（FILTER-001 AC-012〜AC-015）と `limit` の表現（AC-016 / AC-017、SHARE-001 AC-010）だけを足した
- **2026-09-15 追記**: 固定リストの選択肢は `region-notes.json` / `profiles.json` から導出しており固定値を持たないので、D-012 で `ca` / `in` の地理圏が増えても**選択肢の作り方は変えない**。`geo:ca` は `country:ca` と、`geo:in` は `country:in` と集合が一致するため国のラベルに畳まれ（FILTER-001 AC-018）、選択肢は 9 件から 11 件になる。判定関数 `satisfiesLimit(destinations, L)` は引き続き変えない

---

## D-006: 対応言語

- **Date**: 2026-09-14
- **Context**: 先例の aws-gpu-quick-reference は ja / en / ko の 3 言語に対応している。本プロジェクトは Design で「日本語と英語を切り替えられる」と書いており、ko をどう扱うかが決まっていない。i18n キー一致テストは対応言語の数だけ辞書の維持コストがかかる。
- **Options**:
  - A: **ja / en の 2 言語のみ**。Design の記述どおり。辞書 2 本の維持で済み、キー一致テストも軽い。韓国語話者は英語で読むことになる
  - B: **ja / en / ko の 3 言語**（先例を踏襲）。先例の辞書構成と切替 UI をそのまま流用でき、コードの差分が小さい。ただし ko の翻訳を新規に書き起こす必要があり、以後の文言追加のたびに 3 本を揃える手間がかかる
  - C: **ja / en で作り、辞書の追加だけで言語を増やせる構造にしておく**。対応言語は設定の配列で決め、切替 UI はそこから生成する。ko は要望が出たら辞書 1 本を足す
- **AI Recommendation**: **C**。Design が約束しているのは ja / en の 2 つで、それ以上は約束していない。一方で先例が 3 言語であることを考えると、増やせない作りにするのは惜しい。言語リストを設定値にしておけば A のコストで B の拡張性が得られる
- **Decision**: **C**
- **Reason**: Design が約束するのは ja / en の 2 つ。言語一覧を設定値にして切替 UI をそこから生成し、ko などは辞書 1 本の追加で足せるようにしておく
- **Refs**: `spec-i18n.md`（I18N-001。暫定で ja / en の 2 言語として記述してある）

---

## D-005: 取得に使うアカウントと権限

- **Date**: 2026-09-14
- **Context**: spike では sandbox アカウントの `AWSAdministratorAccess` で取得したが、`us-east-1` は Organizations の SCP による明示 Deny で `AccessDeniedException` になった。`Production/AWSReadOnlyAccess` は `bedrock:List*` を持たず全リージョンで拒否される。全リージョンのスナップショットを取るには権限の手当てが要る。
- **Options**:
  - A: 既存の管理者権限で取れるリージョンだけを取り、残りは「データなし」として公開する
  - B: `bedrock:ListFoundationModels` と `bedrock:ListInferenceProfiles` だけを許可した読み取り専用ロールを aws-foundation（統治リポジトリ）に追加し、それで全リージョンを取る
  - C: SCP の明示 Deny を緩める
- **AI Recommendation**: **B**（A を暫定として並走）。C は統治の緩和になり、このサイトのために行うべき変更ではない
- **Decision**: **B を最終形、A を暫定とする**
- **Reason**: 取得に必要なのは 2 つの List 権限だけなので、専用の読み取り専用ロールを用意するのが最小権限として素直。monban の git-only フローに従って aws-foundation に PR を出し、ラベル付けと merge は人間が行う。ロールが揃うまでは sandbox プロファイルで取れるリージョン（東京中心）で進め、denied リージョンは「データなし」として公開してよい
- **Refs**: `spec-data.md`（DATA-001 AC-010）、`spec-detail.md`（DETAIL-001 AC-008）、技術設計 §6.1

---

## D-004: 対象リージョンの列挙元

- **Date**: 2026-09-14
- **Context**: 取得スクリプトが「どのリージョンを回るか」の正を決める必要がある。Bedrock が提供されるリージョンの一覧は、General Reference のエンドポイント表に載っている。動的に取る方法として SSM の public parameter（`/aws/service/global-infrastructure/services/bedrock/regions`）が考えられる。
- **Options**:
  - A: `data/region-notes.json` を手書きし、そのキー全件を対象とする。出典は General Reference の Bedrock エンドポイント表
  - B: SSM public parameter から動的に列挙する
  - C: `ListFoundationModels` を全 AWS リージョンで試し、成功したリージョンだけを採用する
- **AI Recommendation**: **A**。B は 2026-09-14 時点で Bedrock のパスの存在を確認できていない。C は denied と「Bedrock 未提供」を区別できず、Design の中心要件（データなしと提供なしの区別）を壊す
- **Decision**: **A**
- **Reason**: SSM public parameter から動的に列挙する案は未確認のため採用しない。`region-notes.json` はリージョンの日本語名・英語名・opt-in 有無・`bedrock-runtime` エンドポイントも同時に持つため、どのみち手書きのファイルが要る。実装時に doc で SSM のパスを確認できれば、`--regions` の既定値として差し替えてよい
- **Refs**: `spec-data.md`（DATA-001 AC-008）、技術設計 §4.4

---

## D-003: In-Region / Geo / Global の判定ルール

- **Date**: 2026-09-14
- **Context**: 公式 docs のモデル別リージョン表にある In-Region / Geo / Global の 3 区分を表の中心に置くと決めた。この 3 区分を何から導くかを決める必要がある。docs の表は各モデルカードの HTML に分散しており、機械可読な配信は無い。
- **Options**:
  - A: API の応答から導く。In-Region は `ListFoundationModels` の `inferenceTypesSupported` に `ON_DEMAND` が含まれるか。Geo / Global は `ListInferenceProfiles` に接頭辞 `us.` `eu.` `apac.` `au.` / `global.` のプロファイルがあるか
  - B: docs の HTML を scrape して表をそのまま取り込む
  - C: A と B を突き合わせ、食い違いを手で解消する
- **AI Recommendation**: **A**。B は HTML 構造の変更に弱く、docs は最近も構成が変わっている（Design の Why に記載）。C は「人の解釈による差分ゼロ」という Success Criteria と矛盾する
- **Decision**: **A**
- **Reason**: API の応答は AWS が公開している定義そのもので、人の解釈を挟まない。判定ルールは次のとおり（source region R、モデル M）

  | 列 | 判定 |
  |---|---|
  | In-Region | R の `ListFoundationModels` に M があり、`inferenceTypesSupported` が `ON_DEMAND` を含む |
  | Geo | R の `ListInferenceProfiles` に、接頭辞が `us.` `eu.` `apac.` `au.` `jp.` のいずれかで M を対象とするプロファイルがある。プロファイル ID と destination 一覧を表示 |
  | Global | 同じく `global.` 接頭辞のプロファイルがある。destination は「全対応リージョン（docs 参照、増えうる）」と注記 |
  | データなし | R の取得が失敗（`fetch-log.json` が `denied`）。「提供なし」とは区別して表示する |

  `PROVISIONED` は availability に保持するが 3 列の判定には使わない。Global の destination は API から取れない（リージョン空 ARN が返る）ため、推測して列挙せず注記にとどめる
- **2026-09-15 追記**: 上の表の Geo の行にある接頭辞の固定リスト（`us.` `eu.` `apac.` `au.` `jp.`）は、**「`global` 以外の接頭辞はすべて Geo」に読み替える**（D-012）。`ca.` と `in.` のプロファイルが実データに現れ、固定リストでは拾えなかったため。**Decision 自体（API の応答から導く）は変えない**。判定の材料も手順も同じで、接頭辞の集合を閉じないだけ
- **Refs**: `spec-table.md`（TABLE-001 AC-003〜005）、`spec-filter.md`、`spec-detail.md`、技術設計 §3

---

## D-002: データの取得元と更新の運用

- **Date**: 2026-09-14
- **Context**: 掲載するモデル・プロファイル・推論先の情報をどこから取るか。公式 docs のモデル別リージョン表は各モデルカードの HTML に分散しており、機械可読な配信は無い。一方で `ListFoundationModels` と `ListInferenceProfiles` は同じ事実を API として返す。
- **Options**:
  - A: **AWS API のスナップショットを `aws` CLI で取得**。手元の SSO で手動実行し、生成した JSON をコミットする。CI に AWS 認証情報は置かない
  - B: **docs の HTML を scrape** する。認証が不要で CI から自動化できるが、HTML 構造の変更に弱い
  - C: **CI から定期的に API を叩いて自動更新**する（OIDC ロールを GitHub Actions に付ける）
- **AI Recommendation**: **A**。B は Design の Why にあるとおり docs の構成が最近変わっており、壊れやすさが掲載内容の正確さに直結する。C は CI に AWS への権限を常設することになり、更新頻度（新モデル・新プロファイルが出たとき）に対して割に合わない
- **Decision**: **A**
- **Reason**: 手元の SSO で手動実行し、生成 JSON をコミットする。CI に AWS 認証は置かない。更新は新しいモデルやプロファイルが出たタイミングを目安にした手動更新で、取得日を画面に出すので古さは読み手が判断できる（Design FAQ Q4）
- **Refs**: `spec-data.md`（DATA-001）、`spec-deploy.md`（DEPLOY-001 AC-004）、技術設計 §6・§8

---

## D-001: 技術スタック

- **Date**: 2026-09-14
- **Context**: 公開する成果物は「ログイン不要の公開ページ」で、スマートフォンでも表が読めること、GitHub Pages で配信できることが要件。先行して作った aws-gpu-quick-reference が同じ形（公式情報を一表に集約する静的サイト）で日常的に使われており、Design の定性目標に「先行の EC2 GPU リファレンスと同じ感覚で使え、見た目と操作に違和感がない」がある。
- **Options**:
  - A: **Vite + vite-plugin-singlefile + vitest、フレームワーク無しの DOM 描画、runtime 依存ゼロ**（先例と同じ構成）
  - B: React / Svelte などのフレームワークを使う。状態管理と再描画が書きやすいが、bundle が増え、先例と構成が分かれる
  - C: 静的サイトジェネレータ（Astro など）でリージョンごとにページを生成する。ただし Design FAQ Q13 で「ページは分けず起点リージョンの選択で切り替える」と決めており、方針と合わない
- **AI Recommendation**: **A**。表 1 枚と絞り込みという規模でフレームワークの利点が出にくく、先例と構成を揃えることで table-engine 相当の汎用モジュールや i18n の仕組みを流用できる
- **Decision**: **A**
- **Reason**: 先例（aws-gpu-quick-reference）の構成・規約を踏襲する。単一 HTML（Vite + vite-plugin-singlefile）でフレームワーク無しの DOM 描画、テストは vitest（jsdom 併用）、`package.json` の runtime 依存は増やさない。表の描画は先例の `table-engine.js` 相当の汎用モジュールで行い、Bedrock 固有の知識を持たせない。取得スクリプトも AWS SDK を使わず `aws` CLI を子プロセスで呼ぶ
- **Refs**: `spec-table.md`、`spec-data.md`（DATA-001 AC-009）、`spec-deploy.md`、技術設計 §5・§6
