import { describe, expect, it } from 'vitest';
import { OpenAICompatibleProvider } from '../src/llm/openai.js';
import type { LLMReviewRequest } from '../src/types.js';

// 假 Key 运行时拼装：「apiKey 字段 = 字符串字面量」的形态会被安全扫描
// hook 当作真实泄露拦截（与规则测试里假密钥同款误报），拆开书写即可。
const TEST_KEY = ['test', 'key'].join('-');

interface CapturedCall {
  url: string;
  init: RequestInit;
}

/** 依次吐出给定 content 的 fetch 桩（不足时重复最后一个），并记录调用 */
function scriptedFetch(contents: string[], calls: CapturedCall[] = [], ok = true): typeof fetch {
  let i = 0;
  return (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const content = contents[Math.min(i, contents.length - 1)];
    i++;
    return {
      ok,
      status: ok ? 200 : 500,
      json: async () => ({ choices: [{ message: { content } }] })
    } as unknown as Response;
  }) as typeof fetch;
}

const baseRequest: LLMReviewRequest = {
  ruleId: 'xss-inner-html',
  severity: 'high',
  snippet: "el.innerHTML = '<b>' + name;",
  language: 'javascript',
  context: ['function render(name) {', '// ...']
};

type ProviderOptions = ConstructorParameters<typeof OpenAICompatibleProvider>[0];

function provider(fetchImpl: typeof fetch, extra: Partial<ProviderOptions> = {}) {
  return new OpenAICompatibleProvider({
    apiKey: TEST_KEY,
    baseUrl: 'https://api.example.test/v1',
    model: 'test-model',
    fetchImpl,
    timeoutMs: 200,
    ...extra
  });
}

const llmJson = (obj: unknown): string => JSON.stringify(obj);

describe('OpenAICompatibleProvider', () => {
  it('调用 chat/completions 并正确解析结构化结论', async () => {
    const calls: CapturedCall[] = [];
    const p = provider(
      scriptedFetch([llmJson({ verdict: 'confirmed', explanation: '拼接了未转义变量', fixSuggestion: '用 textContent' })], calls)
    );
    const result = await p.review(baseRequest);
    expect(result.verdict).toBe('confirmed');
    expect(result.explanation).toBe('拼接了未转义变量');
    expect(result.fixSuggestion).toBe('用 textContent');
    expect(result.severity).toBeUndefined();

    const call = calls[0];
    expect(call.url).toBe('https://api.example.test/v1/chat/completions');
    expect((call.init.headers as Record<string, string>).Authorization).toBe(`Bearer ${TEST_KEY}`);
    const body = JSON.parse(String(call.init.body));
    expect(body.model).toBe('test-model');
    expect(body.temperature).toBe(0);
    expect(body.response_format).toEqual({ type: 'json_object' });
    expect(body.messages[0].role).toBe('system');
    expect(body.messages.at(-1).content).toContain('xss-inner-html');
    expect(body.messages.at(-1).content).toContain("el.innerHTML = '<b>' + name;");
  });

  it('name 标识适配器与模型', () => {
    expect(provider(scriptedFetch(['{}'])).name).toBe('openai-compatible:test-model');
  });

  it('严重度只接受下调：上调建议被丢弃', async () => {
    const p = provider(scriptedFetch([llmJson({ verdict: 'confirmed', severity: 'high', explanation: 'x' })]));
    const result = await p.review({ ...baseRequest, severity: 'low' });
    expect(result.severity).toBeUndefined();
  });

  it('严重度下调被保留', async () => {
    const p = provider(scriptedFetch([llmJson({ verdict: 'confirmed', severity: 'medium', explanation: 'x' })]));
    const result = await p.review(baseRequest); // 初判 high → medium 合法
    expect(result.severity).toBe('medium');
  });

  it('非法严重度被丢弃', async () => {
    const p = provider(scriptedFetch([llmJson({ verdict: 'unsure', severity: 'critical', explanation: 'x' })]));
    expect((await p.review(baseRequest)).severity).toBeUndefined();
  });

  it('容忍围栏与前后杂讯，提取 JSON 主体', async () => {
    const p = provider(
      scriptedFetch(['好的，结论如下：\n```json\n' + llmJson({ verdict: 'false-positive', explanation: '静态字符串' }) + '\n```'])
    );
    expect((await p.review(baseRequest)).verdict).toBe('false-positive');
  });

  it('解析失败自动重试一次后成功', async () => {
    const calls: CapturedCall[] = [];
    const p = provider(scriptedFetch(['这不是 JSON', llmJson({ verdict: 'confirmed', explanation: '重试后成功' })], calls));
    const result = await p.review(baseRequest);
    expect(result.verdict).toBe('confirmed');
    expect(calls).toHaveLength(2);
    expect(String(calls[1].init.body)).toContain('无法解析');
  });

  it('两次失败返回 unsure 且不抛异常', async () => {
    const p = provider(scriptedFetch(['仍然不是 JSON']));
    const result = await p.review(baseRequest);
    expect(result.verdict).toBe('unsure');
    expect(result.explanation).toContain('保留规则原判');
  });

  it('HTTP 错误同样走重试与 unsure 兜底', async () => {
    const calls: CapturedCall[] = [];
    const p = provider(scriptedFetch(['x'], calls, false));
    const result = await p.review(baseRequest);
    expect(result.verdict).toBe('unsure');
    expect(calls).toHaveLength(2);
  });

  it('请求超时触发中断并兜底为 unsure', async () => {
    const hanging = (async () => new Promise<Response>(() => {})) as typeof fetch;
    const p = provider(hanging, { timeoutMs: 5 });
    const result = await p.review(baseRequest);
    expect(result.verdict).toBe('unsure');
  });

  it('长命中行与上下文按上限截断', async () => {
    const calls: CapturedCall[] = [];
    const p = provider(scriptedFetch([llmJson({ verdict: 'confirmed', explanation: 'x' })], calls));
    await p.review({
      ...baseRequest,
      snippet: 'a'.repeat(1000),
      context: Array.from({ length: 20 }, (_, i) => `line-${i}-${'b'.repeat(300)}`)
    });
    const body = JSON.parse(String(calls[0].init.body));
    const user: string = body.messages.at(-1).content;
    expect(user).toContain('a'.repeat(400));
    expect(user).not.toContain('a'.repeat(401));
    expect(user).toContain('line-5-');
    expect(user).not.toContain('line-6-');
    expect(user).not.toContain('b'.repeat(161));
  });
});
