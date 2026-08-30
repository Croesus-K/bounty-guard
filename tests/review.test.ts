import { describe, expect, it } from 'vitest';
import { languageOf, reviewFindings } from '../src/review.js';
import type { Finding, LLMProvider, LLMReviewRequest, LLMReviewResult } from '../src/types.js';

function finding(severity: Finding['severity'], overrides: Partial<Finding> = {}): Finding {
  return {
    ruleId: 'r-1',
    severity,
    file: 'src/a.ts',
    line: 3,
    snippet: 'const x = 1;',
    message: 'm',
    fixHint: 'h',
    contextLines: ['prev'],
    ...overrides
  };
}

/** 按脚本依次返回复核结论的桩 Provider，并记录收到的请求 */
function scriptedProvider(
  results: LLMReviewResult[],
  requests: LLMReviewRequest[] = []
): LLMProvider {
  let i = 0;
  return {
    name: 'scripted',
    async review(request) {
      requests.push(request);
      return results[Math.min(i++, results.length - 1)];
    }
  };
}

describe('languageOf', () => {
  it('按扩展名推断语言，未知与无扩展名兜底', () => {
    expect(languageOf('src/app.ts')).toBe('typescript');
    expect(languageOf('a.js')).toBe('javascript');
    expect(languageOf('x.py')).toBe('python');
    expect(languageOf('comp.VUE')).toBe('vue');
    expect(languageOf('README')).toBe('unknown');
    expect(languageOf('b.')).toBe('unknown');
  });
});

describe('reviewFindings', () => {
  it('误报被剔除并计数，确认项挂载复核结果', async () => {
    const outcome = await reviewFindings([finding('high'), finding('low', { ruleId: 'r-2' })], [
      { verdict: 'false-positive', explanation: '静态字符串' },
      { verdict: 'confirmed', explanation: '真实风险' }
    ].map((r) => (scriptedProvider([r]), r)) && scriptedProvider([
      { verdict: 'false-positive', explanation: '静态字符串' },
      { verdict: 'confirmed', explanation: '真实风险' }
    ]) as LLMProvider);
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0].ruleId).toBe('r-2');
    expect(outcome.findings[0].review?.verdict).toBe('confirmed');
    expect(outcome.filtered).toBe(1);
    expect(outcome.downgraded).toBe(0);
  });

  it('unsure 保留原判且计入确认', async () => {
    const outcome = await reviewFindings([finding('high')], [
      scriptedProvider([{ verdict: 'unsure', explanation: '证据不足' }]) as LLMProvider
    ].pop() as LLMProvider);
    expect(outcome.findings).toHaveLength(1);
    expect(outcome.findings[0].review?.verdict).toBe('unsure');
    expect(outcome.filtered).toBe(0);
  });

  it('严重度下调被应用并计数', async () => {
    const outcome = await reviewFindings([finding('high')], [
      scriptedProvider([{ verdict: 'confirmed', severity: 'low', explanation: '影响有限' }]) as LLMProvider
    ].pop() as LLMProvider);
    expect(outcome.findings[0].severity).toBe('low');
    expect(outcome.downgraded).toBe(1);
  });

  it('严重度不允许上调（流水线层双保险）', async () => {
    const outcome = await reviewFindings([finding('low')], [
      scriptedProvider([{ verdict: 'confirmed', severity: 'high', explanation: '想升级' }]) as LLMProvider
    ].pop() as LLMProvider);
    expect(outcome.findings[0].severity).toBe('low');
    expect(outcome.downgraded).toBe(0);
  });

  it('复核请求携带规则 ID、严重度、片段、语言与上下文', async () => {
    const requests: LLMReviewRequest[] = [];
    await reviewFindings([finding('medium')], scriptedProvider([{ verdict: 'confirmed', explanation: 'x' }], requests));
    expect(requests[0].ruleId).toBe('r-1');
    expect(requests[0].severity).toBe('medium');
    expect(requests[0].snippet).toBe('const x = 1;');
    expect(requests[0].language).toBe('typescript');
    expect(requests[0].context).toEqual(['prev']);
  });

  it('空告警列表直接返回空结果', async () => {
    const outcome = await reviewFindings([], scriptedProvider([{ verdict: 'confirmed', explanation: 'x' }]));
    expect(outcome.findings).toHaveLength(0);
    expect(outcome.filtered).toBe(0);
    expect(outcome.downgraded).toBe(0);
    expect(outcome.reviewed).toBe(0);
    expect(outcome.unreviewed).toBe(0);
  });

  it('相同规则与片段的告警去重，共享一次复核结论', async () => {
    const requests: LLMReviewRequest[] = [];
    const fs = [finding('high'), finding('high', { file: 'src/b.ts', line: 9 })];
    const outcome = await reviewFindings(fs, scriptedProvider([{ verdict: 'confirmed', explanation: 'x' }], requests));
    expect(requests).toHaveLength(1);
    expect(outcome.reviewed).toBe(2);
    expect(outcome.findings.every((f) => f.review)).toBe(true);
  });

  it('超出 maxReviews 的告警保留规则原判并计入 unreviewed', async () => {
    const fs = [finding('high'), finding('low', { ruleId: 'r-2' })];
    const outcome = await reviewFindings(
      fs,
      scriptedProvider([{ verdict: 'false-positive', explanation: 'x' }]),
      { maxReviews: 1 }
    );
    // high 严重度更高、优先送审并被过滤；low 保留原判
    expect(outcome.findings.map((f) => f.ruleId)).toEqual(['r-2']);
    expect(outcome.filtered).toBe(1);
    expect(outcome.reviewed).toBe(1);
    expect(outcome.unreviewed).toBe(1);
  });

  it('并发复核不丢结果', async () => {
    const fs = Array.from({ length: 12 }, (_, i) => finding('medium', { ruleId: `r-${i}`, line: i + 1 }));
    const outcome = await reviewFindings(fs, scriptedProvider([{ verdict: 'confirmed', explanation: 'x' }]), {
      concurrency: 4
    });
    expect(outcome.findings).toHaveLength(12);
    expect(outcome.reviewed).toBe(12);
    expect(outcome.unreviewed).toBe(0);
  });
});
