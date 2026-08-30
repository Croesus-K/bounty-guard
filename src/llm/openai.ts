import { SEVERITY_RANK } from '../types.js';
import type { LLMProvider, LLMReviewRequest, LLMReviewResult, Severity } from '../types.js';

/**
 * OpenAI 兼容适配器：逐条复核告警，走 chat/completions，要求 JSON 输出。
 * 设计约束：
 * - 只复核、不发明——输入永远是规则已命中的告警；
 * - 严重度只接受下调（解析层直接丢弃上调建议，流水线再做双保险）；
 * - 单条复核失败不抛异常，返回 unsure 保留规则原判（优雅降级）。
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
  /** JSON 解析 / 网络失败的重试次数，默认 1 */
  retries?: number;
}

const DEFAULT_BASE_URL = 'https://api.openai.com/v1';
const DEFAULT_MODEL = 'gpt-4o-mini';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_RETRIES = 1;

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

export class OpenAICompatibleProvider implements LLMProvider {
  readonly name: string;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly model: string;
  private readonly fetchImpl: typeof fetch;
  private readonly timeoutMs: number;
  private readonly retries: number;

  constructor(options: OpenAIProviderOptions) {
    this.apiKey = options.apiKey;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '');
    this.model = options.model ?? DEFAULT_MODEL;
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.retries = options.retries ?? DEFAULT_RETRIES;
    this.name = `openai-compatible:${this.model}`;
  }

  async review(request: LLMReviewRequest): Promise<LLMReviewResult> {
    const messages = this.buildMessages(request);
    let lastError = '未知错误';
    for (let attempt = 0; attempt <= this.retries; attempt++) {
      try {
        const content = await this.chat(messages, attempt > 0);
        const parsed = this.parseReview(content, request.severity);
        if (parsed) return parsed;
        lastError = '输出无法解析为合法 JSON';
      } catch (err) {
        lastError = err instanceof Error ? err.message : String(err);
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

  private async chat(messages: ChatMessage[], withRetryNote: boolean): Promise<string> {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    // 竞速兜底：不能假设注入的 fetch 一定遵守 abort signal，
    // 超时必须让调用方确定性地收敛（重试或 unsure）
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error('请求超时'));
      }, this.timeoutMs);
    });
    try {
      const pending = this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`
        },
        body: JSON.stringify({
          model: this.model,
          messages: withRetryNote
            ? [...messages, { role: 'user', content: '你上一次的输出无法解析，请严格只输出一个 JSON 对象。' }]
            : messages,
          temperature: 0,
          response_format: { type: 'json_object' }
        }),
        signal: controller.signal
      });
      pending.catch(() => {}); // 防 timeout 赢得竞速后出现未处理拒绝
      const response = (await Promise.race([pending, timeout])) as Response;
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
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
