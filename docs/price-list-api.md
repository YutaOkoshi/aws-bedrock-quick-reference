# AWS Price List API の読み方 (Amazon Bedrock)

`scripts/fetch-bedrock-prices.mjs` / `scripts/lib/prices.mjs` が Price List をどう読むかの根拠。
公式の説明を先に引き、そのあとに Bedrock の価格表で実際に見つかった書き方をまとめる。
最終確認: 2026-10-08。

## 公式ドキュメント

- Reading the service price list file for an AWS service
  <https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/reading-service-price-list-file-for-services.html>
- Getting price list files using the AWS Price List Bulk API
  <https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-the-aws-price-list-bulk-api.html>
- Finding services and products using AWS Price List Query API
  <https://docs.aws.amazon.com/awsaccountbilling/latest/aboutv2/using-price-list-query-api.html>

## 2 つの API

| | Bulk API | Query API |
|---|---|---|
| 取り方 | リージョンごとの価格表ファイル (JSON / CSV) を丸ごと落とす | `GetProducts` にフィルタを渡して該当 SKU だけ受け取る |
| 認証 | ファイルの URL は認証不要 (`https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/<offer>/current/<region>/index.json`) | IAM の `pricing:*` 権限が要る |
| 範囲 | 1 ファイル = 1 offer × 1 リージョン | 1 回の呼び出しで全リージョン (GovCloud を含む) |
| このリポジトリ | 使う (D-009。認証を CI に置かない) | 検証にだけ使う |

Bulk API の URL は、offer の `current/region_index.json` の `regions[<region>].currentVersionUrl` から組み立てる。
版の一覧は `offers/v1.0/aws/<offer>/index.json` の `versions`。

## JSON の構造 (公式)

```
{
  "formatVersion", "disclaimer", "offerCode", "version", "publicationDate",
  "products": {
    "<sku>": { "sku", "productFamily", "attributes": { "<name>": "<value>" } }
  },
  "terms": {
    "OnDemand" | "Reserved": {
      "<sku>": {
        "<sku>.<offerTermCode>": {
          "offerTermCode", "sku", "effectiveDate", "termAttributesType", "termAttributes",
          "priceDimensions": {
            "<rateCode>": { "rateCode", "description", "unit", "beginRange", "endRange",
                            "pricePerUnit": { "USD": "<文字列の数値>" } }
          }
        }
      }
    }
  }
}
```

公式の要点:

- 製品 (`products`) と価格 (`terms`) は別の節にあり、**SKU で結び付ける**。
  1 つの製品が複数の条件 (term) で売られ、1 つの条件が複数の製品に当たることもある
- 価格は `SKU.offerTermCode` の組で引く (例: `U7ADXS4BEK5XXHRU.KCAKZHGHG`)
- 1 つの (製品, 条件) に複数の `priceDimensions` が付くことがある (無料枠・段階料金)。
  `beginRange` / `endRange` が段階の範囲
- `effectiveDate` より前にはその価格は有効ではない
- `pricePerUnit` は通貨コードごとの単価 (文字列)

## 読む手順 (このリポジトリの実装)

1. `products` を全件回し、`attributes` からモデル名と軸・種別を読む
   (`readProduct`。AmazonBedrock は `model` / `inferenceType` / `usagetype` / `service_tier` / `feature`、
   AmazonBedrockFoundationModels は `servicename` / `usagetype`)
2. その SKU で `terms.OnDemand[sku]` を引き、`priceDimensions` の `pricePerUnit.USD` と `unit` を読む (`priceOf`)
3. 単位を USD / 100 万トークンに揃える (`toPerMillion`)
4. モデル名を `models.json` のモデル ID に結び付ける (`resolveModelIds`)

### 2026-10-08 時点で確かめた前提

| 公式に書かれている可能性 | Bedrock の価格表の実際 | 実装の扱い |
|---|---|---|
| term が複数 (OnDemand / Reserved) | `terms` は `OnDemand` だけ | `OnDemand` だけ読む |
| 1 つの SKU に term が複数 | 0 件 | 最初の term を読む |
| 1 つの term に priceDimensions が複数 (段階料金) | 0 件。`beginRange` は全件 `0`、`endRange` は `Inf` | 最初の priceDimension を読む |

前提が崩れたら `priceOf` を直す。確かめ方は「検証のしかた」を参照。

## Bedrock の価格表に出てくる書き方

### offer

| offer | 中身 | モデル名の属性 |
|---|---|---|
| `AmazonBedrock` | Amazon / サードパーティのモデル (Nova, Llama, Mistral, GLM, Grok, Kimi など) | `model` (表示名。`xai.grok-4.6` のように ID のこともある) |
| `AmazonBedrockFoundationModels` | AWS Marketplace 経由のモデル (Anthropic, OpenAI の一部, Stability, Cohere など) | `servicename` (末尾に ` (Amazon Bedrock Edition)`) |
| `AmazonBedrockService` | Mantle / cross-region / 予約 TPM などのサービス料金。トークン単価は無い | — (取り込まない) |

### usagetype の読み方

`usagetype` の先頭はリージョンの略号 (`APN1-` / `USE1-` …)。BFM はさらに `MP:<略号>_` が付く。

| 書き方 | 意味 | 例 |
|---|---|---|
| `-mantle-` | bedrock-mantle の SKU。Runtime とは別の単価 (D-017) | `USE1-xai.grok-4.7-mantle-input-tokens-standard` |
| `global` (`-cross-region-global`, `_global_standard`, `_Global`) | Global CRIS の単価 | `MP:APN1_input_tokens_global_standard-Units` |
| `batch` | バッチ推論 | `InputTokenCount_Global_Batch-Units` |
| `cache_read` / `cache-read` / `CacheRead` | キャッシュ読み取り | `cache_read_tokens_global_standard-Units` |
| `cache_write` (`_30m` / `_1h` 付きあり) | キャッシュ書き込み。TTL ごとに別の SKU | `cache_write_tokens_1h_global_standard-Units` |
| `long_ctx` (GovCloud では `long-ctx`) | 長文コンテキストの単価 | `output_tokens_long_ctx_standard-Units` |
| `priority` / `flex` | サービス階層 | `xai.grok-4.7-mantle-input-tokens-priority` |

`priceDimensions[].description` にも同じ区別が英文で入る
(例: `Input Tokens - Standard, Long Context, Global`)。分類を確かめるときの照合に使える。

### unit の揺れ

`1K tokens` / `1k tokens` / `1M tokens` が混在する。トークン以外に `image` / `seconds` / `video` /
`Images Processed` / `Search Units` / `Requests` / `Units` などがある。`Units` は単位が読めないので取り込まない。

## 検証のしかた

### Bulk API のファイルを全文検索する

```
# 全リージョンのファイルを落とす (認証不要)
B=https://pricing.us-east-1.amazonaws.com
curl -s $B/offers/v1.0/aws/AmazonBedrock/current/region_index.json | jq -r '.regions[].currentVersionUrl'

# SKU から単価を引く (公式の手順どおり)
jq -r --arg m "Grok 4.7" '. as $j | .products | to_entries[]
  | select(.value.attributes.model == $m) | .key as $k
  | "\(.value.attributes.usagetype)\t\($j.terms.OnDemand[$k] | to_entries[0].value.priceDimensions
      | to_entries[0].value | "\(.pricePerUnit.USD) \(.unit)")"' AmazonBedrock-ap-northeast-1.json
```

### Query API でモデル名の一覧と SKU を確かめる

```
aws pricing describe-services --service-code AmazonBedrock --region us-east-1
aws pricing get-attribute-values --service-code AmazonBedrock --attribute-name model --region us-east-1
aws pricing get-attribute-values --service-code AmazonBedrockFoundationModels --attribute-name servicename --region us-east-1
aws pricing get-products --service-code AmazonBedrock --region us-east-1 \
  --filters Type=TERM_MATCH,Field=model,Value=openai.gpt-5.4
```

Query API は全リージョンをまたぐので、GovCloud (`us-gov-*`) の SKU も返る。結果の `regionCode` を必ず見る。

## 2026-10-08 の確認結果

- Query API の `GetAttributeValues` が返したモデル名: AmazonBedrock の `model` は 89 件、BFM の `servicename` は 57 件
- そこに無かったもの: GPT-5.5 / 5.6 Sol / 6 Luna / 6 Sol / 6.1 Sol、GLM 5.3、Stability の画像編集系 13 件
- `openai.gpt-5.4` / `openai.gpt-5.6-luna` / `openai.gpt-5.6-terra` は `model` にあるが、
  `GetProducts` の結果は全件 `us-gov-east-1` / `us-gov-west-1` (商用リージョンには無い)
- 上記のモデルは docs (モデルカードと料金ページ) には価格がある。Price List と docs は一致しない
- 生のレスポンスと検索結果: `data/raw/2026-10-08/price-evidence/` (gitignore 対象)

## Price List に無いモデル: AWS Marketplace の offer (D-018)

Marketplace 経由のモデルは、Price List に載る前でも offer の単価表 (rateCard) を API で取れる。認証が要る。

```
aws bedrock list-foundation-model-agreement-offers --model-id openai.gpt-5.6-terra --region us-east-1
# → offers[0].offerId, offers[0].termDetails.usageBasedPricingTerm.rateCard[] = { dimension, price, unit, description }
aws marketplace-discovery get-offer-terms --offer-id <offerId> --region us-east-1
# → offerTerms[].usageBasedPricingTerm.rateCards[].rateCard[] = { dimensionKey, price, unit, dimensionLabels }
```

- 2 つの API の単価は同じ (2026-10-08 に GPT-5.6 Terra で全 dimension を比較)
- `unit` は `Units` としか書かれない。値は docs のモデルカードの USD / 100 万トークンと一致する
  (GPT-5.6 Terra 2.2 / 13.2、GPT-6 Luna 0.1 / 0.5)。Price List にある GPT-6 Astra でも Price List と同じ値 (11 / 55、10 / 50)
- dimension は `[略号_]<軸>_tokens_[30m_|1h_][long_ctx_][global_]<階層>`。略号はリージョンの略号 (`APN1` など。GPT-5.4 / 5.5 で使われる)。
  略号が無い単価はリージョンの区別が無く、us-east-1 と ap-northeast-1 から呼んでも同じ単価表が返る
- Stability の画像編集系 13 件は 1 つの offer を共有し、dimension は `<略号>_CreatedImage<名前>` (1 画像あたり)
- Marketplace 経由でないモデルは `ValidationException: Agreement not supported for this model`
