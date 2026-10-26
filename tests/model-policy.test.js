// @vitest-environment node
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { retentionNotice } from "../src/scripts/model-policy.mjs";
const read = name => JSON.parse(readFileSync(new URL(`../data/${name}`, import.meta.url), 'utf8'));
const policies = read('model-policies.json');
const models = read('models.json');

describe('model-specific abuse retention', () => {
  it('registers only exact existing model IDs with sourced, structured policies', () => {
    const retained = Object.entries(policies.models).filter(([, entry]) => entry.abuseDetectionRetention);
    expect(retained).toHaveLength(11);
    for (const [id, entry] of retained) {
      expect(models[id]).toBeDefined();
      expect(['all', 'flagged']).toContain(entry.abuseDetectionRetention.traffic);
      expect(entry.abuseDetectionRetention.maxDays).toBe(30);
      expect(entry.abuseDetectionRetention.storageRegion).toBe('inference-region');
      expect(entry.abuseDetectionRetention.sourceUrl).toBe('https://docs.aws.amazon.com/bedrock/latest/userguide/abuse-detection.html');
      expect(entry.abuseDetectionRetention.verifiedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it.each(['amazon.nova-lite-v1:0', 'anthropic.claude-haiku-4-5-20251001-v1:0', 'openai.gpt-oss-120b-1:0', 'openai.gpt-oss-20b-1:0', 'openai.gpt-oss-safeguard-120b', 'openai.gpt-oss-safeguard-20b', 'unknown', undefined])('does not assert a retention exception for %s', id => {
    expect(retentionNotice(id, policies)).toBeNull();
  });
  it('does not accidentally match profile IDs or model family prefixes', () => {
    expect(retentionNotice('global.anthropic.claude-fable-5', policies)).toBeNull();
    expect(retentionNotice('anthropic.claude-fable-5-future', policies)).toBeNull();
  });
  it('shows all traffic and the customer exemption for Fable', () => {
    const result = retentionNotice('anthropic.claude-fable-5', policies);
    expect(result.text).toContain('すべての入力・出力');
    expect(result.text).toContain('推論先リージョン');
    expect(result.text).toContain('2026-12-31');
  });
  it('distinguishes flagged traffic and regional placement in English', () => {
    const result = retentionNotice('openai.gpt-5.6-sol', policies, {language:'en', lane:'inRegion'});
    expect(result.text).toContain('classifier-flagged');
    expect(result.text).toContain('the source Region');
    expect(result.text).toContain('request full ZDR');
  });
});
