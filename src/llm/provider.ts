import type { BountyConfig } from '../config.js';
import { loadConfig } from '../config.js';
import type { LLMProvider } from '../types.js';
import { MockProvider } from './mock.js';
import { OpenAICompatibleProvider } from './openai.js';

/**
 * Provider 工厂。选择逻辑：
 * - ai.provider=off 或未启用 → Mock（纯规则模式）
 * - ai.provider=mock → Mock（显式走 Mock，可演练复核流水线）
 * - ai.provider=openai-compatible → 读取环境变量 Key；无 Key 降级 Mock 并说明原因
 */

export interface LoadedProvider {
  provider: LLMProvider;
  /** mock=纯规则/显式 Mock；llm=真实复核 */
  mode: 'mock' | 'llm';
  /** true=想要复核但条件不满足而降级（CLI 会提示原因） */
  degraded: boolean;
  reason?: string;
}

export function loadProvider(config: BountyConfig = loadConfig()): LoadedProvider {
  const ai = config.ai;
  if (!ai.enabled || ai.provider === 'off') {
    return {
      provider: new MockProvider(),
      mode: 'mock',
      degraded: true,
      reason: 'LLM 复核未启用，当前为纯规则模式'
    };
  }
  if (ai.provider === 'mock') {
    return { provider: new MockProvider(), mode: 'mock', degraded: false };
  }
  const apiKey = process.env.BOUNTY_GUARD_API_KEY ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return {
      provider: new MockProvider(),
      mode: 'mock',
      degraded: true,
      reason: '未检测到 API Key（设置 BOUNTY_GUARD_API_KEY 或 OPENAI_API_KEY），已降级为纯规则模式'
    };
  }
  const baseUrl = ai.baseUrl ?? process.env.BOUNTY_GUARD_BASE_URL ?? process.env.OPENAI_BASE_URL ?? undefined;
  const model = ai.model ?? process.env.BOUNTY_GUARD_MODEL ?? undefined;
  return {
    provider: new OpenAICompatibleProvider({ apiKey, baseUrl, model }),
    mode: 'llm',
    degraded: false
  };
}
