import { describe, expect, it } from 'vitest';
import { MockProvider } from '../src/llm/mock.js';

describe('MockProvider', () => {
  it('返回 confirmed 与包含规则 ID 的解释文本', async () => {
    const provider = new MockProvider();
    const result = await provider.review({
      ruleId: 'weak-hash-md5',
      severity: 'high',
      snippet: 'const hash = md5(password)',
      language: 'javascript'
    });
    expect(result.verdict).toBe('confirmed');
    expect(result.explanation).toContain('weak-hash-md5');
    expect(result.explanation).toContain('md5(password)');
  });

  it('provider 名称标识为 mock', () => {
    expect(new MockProvider().name).toBe('mock');
  });

  it('超长 snippet 被截断，不抛异常', async () => {
    const provider = new MockProvider();
    const result = await provider.review({
      ruleId: 'x',
      severity: 'low',
      snippet: 'a'.repeat(200),
      language: 'javascript'
    });
    expect(result.explanation.length).toBeLessThan(100);
  });
});
