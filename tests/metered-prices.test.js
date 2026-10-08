// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { meteredPriceOf, normalizePrices } from '../scripts/lib/prices.mjs';
import { comparisonPrices, buildRow } from '../src/scripts/bedrock-view-model.mjs';
import { buildMantlePriceRows, buildPriceRows } from '../src/scripts/detail-model.mjs';

const product = (attributes) => ({ sku: 'example', attributes });
const rate = (attributes, usd, unit) => meteredPriceOf(product(attributes), { usd, unit });

describe('トークン以外の課金単位', () => {
  it('Nova Reel の Price List unit=video は動画本数ではなく秒単価', () => {
    expect(rate({ model: 'Nova Reel', inferenceType: 'T2V Medium fps HD Resolution' }, '.08', 'video'))
      .toEqual({ axis: 'output', label: 'Video · HD', unit: 'second', value: .08, scope: 'standard' });
    expect(rate({ model: 'unknown' }, '.08', 'video')).toBeNull();
  });
  it('動画入力、画像、検索、テキスト要求をトークン単価に換算しない', () => {
    expect(rate({ usagetype: 'USE1-MP:USE1_inputVideoSecond-Units' }, '.0007', 'seconds'))
      .toMatchObject({ axis: 'input', unit: 'second', value: .0007 });
    expect(rate({}, '.04', 'image')).toMatchObject({ axis: 'output', unit: 'image', value: .04 });
    expect(rate({}, '.002', 'Search Units')).toMatchObject({ axis: 'input', unit: 'searchUnit', value: .002 });
    expect(rate({}, '.00007', 'Text Requests')).toMatchObject({ axis: 'input', unit: 'request', value: .00007 });
  });
  it('画像条件とGlobal動画課金を保持する', () => {
    expect(rate({ modality: 'Document image' }, '.0006', 'Images Processed').label).toBe('Document image');
    const globalRate = rate({ usagetype: 'USE1-MP:USE1_inputVideoSecond_Global-Units' }, '.00049', 'seconds');
    expect(globalRate).toMatchObject({ scope: 'global', axis: 'input' });
    const prices = { byModel: { pegasus: { tokyo: { metered: [globalRate] } } } };
    expect(buildPriceRows('pegasus', { prices, region: 'tokyo', lane: 'global' })).toEqual([
      { kind: 'metered', label: 'Video', unit: 'second', input: .00049 },
    ]);
    expect(buildPriceRows('pegasus', { prices, region: 'tokyo', lane: 'inRegion' })).toEqual([]);
  });
  it('学習・予約・Guardrailsなどをモデルの推論料金に混ぜない', () => {
    for (const usagetype of ['USE1-NovaCanvas-Customization-Training', 'USE1-Guardrail-ContentPolicyImageUnitsConsumed', 'USE1-DataAutomation-Standard-ImagesProcessed', 'USE1-Nova-ProvisionedThroughput']) {
      expect(rate({ usagetype }, '1', 'image')).toBeNull();
    }
  });
  it('モデルIDへの対応から単位付き価格の保存までを通す', () => {
    const p = product({ model: 'Canvas', usagetype: 'USE1-Canvas-T2I-1024-Standard', inferenceType: 'T2I Standard 1024' });
    const file = { products: { example: p }, terms: { OnDemand: { example: { term: { priceDimensions: { price: { unit: 'image', pricePerUnit: { USD: '.04' } } } } } } } };
    const { prices } = normalizePrices({ files: { AmazonBedrock: { 'us-east-1': file } }, models: { canvas: { name: 'Canvas' } } });
    expect(prices.byModel.canvas['us-east-1'].metered[0]).toMatchObject({ value: .04, unit: 'image', axis: 'output' });
    expect(prices.byModel.canvas['us-east-1'].standard).toBeUndefined();
    const rows = comparisonPrices(prices, 'canvas', 'ap-northeast-1');
    expect(rows[0]).toMatchObject({ reference: true, region: 'us-east-1', value: .04 });
    const row = buildRow({ modelId: 'canvas', model: { name: 'Canvas' }, profiles: {}, region: 'us-east-1', prices });
    expect(row.priceInput).toBeNull();
    expect(row.priceOutput).toBeNull();
    expect(buildPriceRows('canvas', { prices, region: 'us-east-1' })[0]).toMatchObject({ output: .04, unit: 'image' });
    expect(buildPriceRows('canvas', { prices, region: 'us-east-1', lane: 'global' })).toEqual([]);
  });
});

describe('実データ (件数・モデル名を固定せず、取り直しに追従する)', () => {
  const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
  const models = read('models'), prices = read('prices');

  // bedrock-runtime の単価の種別。mantle の下は bedrock-mantle の単価で、一覧の価格列には使わない
  const RUNTIME_KINDS = ['standard', 'global', 'batch', 'cacheRead', 'cacheWrite', 'priority', 'flex', 'metered'];
  const hasRuntime = (id) => Object.values(prices.byModel[id] ?? {}).some((entry) => RUNTIME_KINDS.some((kind) => entry[kind]));
  const hasMantle = (id) => Object.values(prices.byModel[id] ?? {}).some((entry) => entry.mantle);

  it('一覧で価格が出ないモデルは、prices.json のどのリージョンにも Runtime の単価が無い (取り込みの不具合ではない)', () => {
    const missing = Object.keys(models).filter(id => comparisonPrices(prices, id, 'ap-northeast-1').length === 0);
    if (missing.length > 0) console.info(`Runtime の単価が無いモデル: ${missing.join(', ')}`);
    for (const id of missing) expect(hasRuntime(id), id).toBe(false);
  });

  it('Runtime か Mantle の単価があるモデルが 4 分の 3 以上 (価格の大量消失を検出する)', () => {
    const ids = Object.keys(models);
    const priced = ids.filter((id) => hasRuntime(id) || hasMantle(id));
    expect(priced.length / ids.length).toBeGreaterThanOrEqual(0.75);
    expect(ids.filter(hasMantle).length).toBeGreaterThan(0);
  });

  it('prices.json のモデル ID はすべて models.json にある', () => {
    for (const id of Object.keys(prices.byModel)) expect(models, id).toHaveProperty([id]);
  });

  it('長文コンテキストの単価があれば、詳細の価格行にそのまま出る', () => {
    let checked = 0;
    for (const [id, regions] of Object.entries(prices.byModel)) {
      for (const [region, entry] of Object.entries(regions)) {
        for (const [kind, lane] of [['standard', 'inRegion'], ['global', 'global']]) {
          const longContext = entry[kind]?.longContext;
          if (!longContext) continue;
          expect(buildPriceRows(id, { prices, region, lane }), `${id} ${region} ${kind}`)
            .toContainEqual({ kind, ...longContext, longContext: true });
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('Mantle の単価があれば、詳細の Mantle の価格行にそのまま出て、Runtime の行には混ざらない', () => {
    let checked = 0;
    for (const [id, regions] of Object.entries(prices.byModel)) {
      for (const [region, entry] of Object.entries(regions)) {
        if (!entry.mantle?.standard) continue;
        const { longContext, ...standard } = entry.mantle.standard;
        expect(buildMantlePriceRows(id, { prices, region }), `${id} ${region}`)
          .toContainEqual({ kind: 'standard', input: standard.input ?? null, output: standard.output ?? null });
        const runtime = buildPriceRows(id, { prices, region }).find((row) => row.kind === 'standard');
        expect(runtime ?? null, `${id} ${region}`).toEqual(entry.standard ? expect.objectContaining({ input: entry.standard.input ?? null }) : null);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

describe('実データ: AWS Marketplace の offer で補った単価 (D-018)', () => {
  const read = (name) => JSON.parse(readFileSync(new URL(`../data/${name}.json`, import.meta.url)));
  const prices = read('prices'), marketplace = read('marketplace-prices');

  it('出典が marketplace のリージョンは、prices.marketplace.models のモデルだけにあり、offerId を持つ', () => {
    const listed = new Set(prices.marketplace?.models ?? []);
    let checked = 0;
    for (const [id, regions] of Object.entries(prices.byModel)) {
      for (const [region, entry] of Object.entries(regions)) {
        if (entry.source?.type !== 'marketplace') continue;
        expect(listed.has(id), `${id} ${region}`).toBe(true);
        expect(entry.source.offerId, `${id} ${region}`).toBe(marketplace.byModel[id]?.offerId);
        checked += 1;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });

  it('marketplace-prices.json に offer のトークンやアカウント ID が入っていない', () => {
    const text = JSON.stringify(marketplace);
    expect(text).not.toMatch(/offerToken/);
    expect(text).not.toMatch(/\b\d{12}\b/);
  });
});
