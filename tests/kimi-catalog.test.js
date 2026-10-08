// @vitest-environment node
import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { buildRow, orderRows } from '../src/scripts/bedrock-view-model.mjs';
import { retentionNotice } from '../src/scripts/model-policy.mjs';
const read=name=>JSON.parse(readFileSync(new URL(`../data/${name}.json`,import.meta.url),'utf8'));
const models=read('models'),profiles=read('profiles'),prices=read('prices'),mantle=read('mantle'),policies=read('model-policies');
const modelId='moonshotai.kimi-k3';
it('shows Kimi K3 as Global-only in Tokyo with sourced prices and release date',()=>{
  const row=buildRow({modelId,model:models[modelId],profiles,prices,mantle,region:'ap-northeast-1',overrides:{}});
  expect(row.inRegion).toBe(false);
  expect(row.geo).toHaveLength(0);
  expect(row.global.profileId).toBe('global.moonshotai.kimi-k3');
  expect(row.mantle.available).toBe(false);
  expect(models[modelId].releasedAt).toBe('2026-09-18T00:00:00.000Z');
  expect(prices.byModel[modelId]['ap-northeast-1'].global).toEqual({input:3,output:15});
  expect(retentionNotice(modelId,policies)).toBeNull();
});
it('uses the API US Geo destinations and newest ordering',()=>{
  expect(profiles['us.moonshotai.kimi-k3'].sources['us-east-1']).toEqual(['us-east-1','us-east-2','us-west-2']);
  // 新しいモデルが増えると先頭は入れ替わるので、Kimi K3 より新しいものだけが前に来ることを確かめる
  const rows=Object.entries(models).map(([modelId,model])=>({...model,modelId}));
  const ordered=orderRows(rows,{sort:'newest'});
  const kimiAt=ordered.findIndex(row=>row.modelId===modelId);
  const newer=rows.filter(row=>row.releasedAt>models[modelId].releasedAt).length;
  expect(kimiAt).toBe(newer);
});
