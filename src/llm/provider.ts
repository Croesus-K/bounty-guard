import type { LLMProvider } from '../types.js';
import { MockProvider } from './mock.js';

/**
 * Provider 工厂。Week 2 在此扩展 OpenAI 兼容实现：
 * 依据 .bountyrc 的 ai.provider 与环境变量（API Key / Base URL）选择实现；
 * 无 Key 或 provider=off 时返回 Mock（纯规则模式降级）。
 */
export function loadProvider(): LLMProvider {
  return new MockProvider();
}
