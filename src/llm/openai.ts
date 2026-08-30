import { SEVERITY_RANK } from '../types.js';
import type { LLMProvider, LLMReviewRequest, LLMReviewResult, Severity } from '../types.js';

/**
 * OpenAI 兼容适配器：逐条复核告警，走 chat/completions，要求 JSON 输出。
 * 设计约束：
 * - 只复核、不发明——输入永远是规则已命中的告警；
 * - 严重度只接受下调（解析层直接丢弃上调建议，流水线再做双保险）；
 * - 单条复核失败不抛异常，返回 unsure 保留规则原判（优雅降级）；
 * - 兼容性：供应商不支持 response_format 时自动去掉该参数重试；
 *   HTTP 429/5xx 按指数退避（尊重 Retry-After），与解析失败分开处理。
 */

export interface OpenAIProviderOptions {
  apiKey: string;
  /** 默认 https://api.openai.com/v1；DeepSeek/GLM 等换这里即可 */
  baseUrl?: string;
  model?: string;
  /** fetch 注入点（测试用）；缺省用全局 fetch */
  fetchImpl?: typeof fetch;
  /** 单次请求超时（毫秒），默认 30 秒 */
  timeoutMs?: number;
  /** JSON 解析 / HTTP 失败的重试次数，默认 1 */
  retries?: number;
  /** 重试的基础退避时长（毫秒），默认 1000；HTTP 429/5xx 按尝试次数递增 */
  retryBaseDelayMs?: number;
  /** 限制单条复核的输出长度（tokens），默认 500——控制复核成本 */
  maxTokens?: number;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;
const DEFAULT_RETRY_BASE_DELAY_MS = 1_000;
const DEFAULT_MAX_TOKENS = 500;
const MAX_RETRY_DELAY_MS = 10_000;

const VERDICTS = ['confirmed', 'false-positive', 'unsure'];
const SEVERITIES: Severity[] = ['high', 'medium', 'low', 'info'];

/** 复核提示词：中文、只输出 JSON、严重度只允许下调 */
const SYSTEM_PROMPT = [
  '你是代码安全告警的复核员。输入是一条静态规则命中的告警（规则 ID、初判严重度、命中代码行与上下文）。你的职责：',
  '1. 判断该告警在当前上下文中是否为真实的安全问题；',
  '2. 给出结论与一句话中文解释；确属问题时可附具体修复建议；',
  '3. 严重度只能建议下调或维持，禁止上调；不确定时用 unsure，不要猜测。',
  '判定倾向：宁可漏报不可误报——测试文件、注释、示例代码、占位符、纯静态字符串等非真实风险一律判 false-positive。',
  '只输出一个 JSON 对象，不要输出任何其他内容，格式：',
  '{"verdict":"confirmed|false-positive|unsure","severity":"high|medium|low|info","explanation":"一句话中文理由","fixSuggestion":"可选的中文修复建议"}',
  '其中 verdict 必填；severity 仅在需要下调时给出；fixSuggestion 可选。'
].join('\n');

/** 截断上限：控制单条复核的 Token 消耗 */
const MAX_SNIPPET_CHARS = 400;
const MAX_CONTEXT_LINES = 6;
const MAX_CONTEXT_LINE_CHARS = 160;

interface ChatCompletionResponse {
  choices?: Array<{ message?: { content?: string } }>;
}

type ChatMessage = { role: 'system' | 'user'; content: string };

/** HTTP 层错误：携带状态码与 Retry-After，供重试策略决策 */
export class LLMHttpError extends Error {
  constructor(
    readonly status: number,
    readonly retryAfterMs: number | undefined,
    detail: string
  ) {
    super(`HTTP ${status}${detail ? `：${detail}` : ''}`);
  }
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;
  private readonly retryBaseDelayMs: number;
  private readonly maxTokens: number;

  constructor(options: OpenAIProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = options.model ?? DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.retryBaseDelayMs = options.retryBaseDelayMs ?? DEFAULT_RETRY_BASE_DELAY_MS;
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS;
    this.name = `openai-compatible:${this.model}`;
  }

  async review(request: LLMReviewRequest): Promise<LLMReviewResult> {
    const messages = this.buildMessages(request);
    let lastError = '未知错误';
    let lastDelayMs = 0;
    let jsonMode = true;
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      if (attempt > 0 && lastDelayMs > 0) await sleep(lastDelayMs);
      try {
        const content = await this.chat(messages, { jsonMode, retryNote: attempt > 0 });
        const parsed = this.parseReview(content, request.severity);
        if (parsed) return parsed;
        lastError = '输出无法解析为合法 JSON';
        lastDelayMs = 0; // 解析类失败立即重试，无需退避
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
        if (err instanceof LLMHttpError) {
          // 供应商不支持 response_format（多见于 400）：关闭 JSON 模式再试
          if (err.status === 400 && jsonMode) jsonMode = false;
          lastDelayMs = Math.min(
            err.retryAfterMs ?? this.retryBaseDelayMs * (attempt + 1),
            MAX_RETRY_DELAY_MS
          );
        } else {
          lastDelayMs = Math.min(this.retryBaseDelayMs * (attempt + 1), MAX_RETRY_DELAY_MS);
        }
      }
    }
    return { verdict: 'unsure', explanation: `LLM 复核失败（${lastError}），保留规则原判` };
  }

  /** 组装消息：组件级截断，控制单条复核的 Token 消耗 */
  private buildMessages(request: LLMReviewRequest): ChatMessage[] {
    const context = (request.context ?? [])
      .slice(0, MAX_CONTEXT_LINES)
      .map((line) => line.slice(0, MAX_CONTEXT_LINE_CHARS))
      .join('\n');
    const user = [
      `规则 ID：${request.ruleId}`,
      `规则初判严重度：${request.severity}`,
      `语言：${request.language}`,
      `命中行：${request.snippet.slice(0, MAX_SNIPPET_CHARS)}`,
      '上下文：',
      context || '（无）'
    ].join('\n');
    return [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: user }
    ];
  }

  private async chat(
    messages: ChatMessage[],
    opts: { jsonMode: boolean; retryNote: boolean }
  ): Promise<string> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('请求超时'));
      }, this.timeoutMs);
    });
    try {
      const body: Record<string, unknown> = {
        model: this.model,
        messages: opts.retryNote
          ? [...messages, { role: 'user', content: '你上一次的输出无法解析，请严格只输出一个 JSON 对象。' }]
          : messages,
        temperature: 0,
        max_tokens: this.maxTokens
      };
      if (opts.jsonMode) body.response_format = { type: 'json_object' };
      const pending = this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify(body),
        signal: controller.signal
      });
      pending.catch(() => {}); // 防 timeout 赢得竞速后出现未处理拒绝
      const response = (await Promise.race([pending, timeout])) as Response;
      if (!response.ok) {
        let detail = '';
        try {
          detail = (await response.text()).slice(0, 200);
        } catch {
          detail = '';
        }
        const retryAfter = Number(response.headers?.get?.('retry-after'));
        throw new LLMHttpError(
          response.status,
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : undefined,
          detail
        );
      }
      const data = (await Promise.race([response.json(), timeout])) as ChatCompletionResponse;
      return data.choices?.[0]?.message?.content ?? '';
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 解析模型输出；严重度只保留「低于初判」的建议（上调与维持直接丢弃） */
  private parseReview(content: string, originalSeverity: Severity): LLMReviewResult | null {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start === -1 || end <= start) return null;
    let obj: unknown;
    try {
      obj = JSON.parse(content.slice(start, end + 1));
    } catch {
      return null;
    }
    if (typeof obj !== 'object' || obj === null) return null;
    const record = obj as Record<string, unknown>;
    if (typeof record.verdict !== 'string' || !VERDICTS.includes(record.verdict)) return null;
    const result: LLMReviewResult = {
      verdict: record.verdict as LLMReviewResult['verdict'],
      explanation:
        typeof record.explanation === 'string' && record.explanation.trim()
          ? record.explanation.trim()
          : '（模型未给出解释）'
    };
    if (
      typeof record.severity === 'string' &&
      (SEVERITIES as string[]).includes(record.severity) &&
      SEVERITY_RANK[record.severity as Severity] < SEVERITY_RANK[originalSeverity]
    ) {
      result.severity = record.severity as Severity;
    }
    if (typeof record.fixSuggestion === 'string' && record.fixSuggestion.trim()) {
      result.fixSuggestion = record.fixSuggestion.trim();
    }
    return result;
  }
}
