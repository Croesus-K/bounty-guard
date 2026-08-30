import type { LLMProvider, LLMReviewRequest, LLMReviewResult } from '../types.js';

/**
 * 测试与无 Key 环境的确定性 Provider。
 * 行为契约：永远返回 confirmed + 固定格式解释，绝不抛异常。
 */
export class MockProvider implements LLMProvider {
  readonly name = 'mock';

  async review(request: LLMReviewRequest): Promise<LLMReviewResult> {
    return {
      verdict: 'confirmed',
      explanation: `[mock] 规则 ${request.ruleId} 命中：${request.snippet.slice(0, 40)}`
    };
  }
}
