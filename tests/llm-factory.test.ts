import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_CONFIG } from '../src/config.js';
import { loadProvider } from '../src/llm/provider.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

const AI_OFF = { ...DEFAULT_CONFIG, ai: { enabled: false, provider: 'off' as const } };
const AI_MOCK = { ...DEFAULT_CONFIG, ai: { enabled: true, provider: 'mock' as const } };
const AI_OPENAI = { ...DEFAULT_CONFIG, ai: { enabled: true, provider: 'openai-compatible' as const } };

describe('loadProvider', () => {
  it('未启用时返回 Mock 且标记降级', () => {
    const loaded = loadProvider(AI_OFF);
    expect(loaded.mode).toBe('mock');
    expect(loaded.degraded).toBe(true);
  });

  it('显式 mock 不视为降级（可演练复核流水线）', () => {
    const loaded = loadProvider(AI_MOCK);
    expect(loaded.mode).toBe('mock');
    expect(loaded.degraded).toBe(false);
  });

  it('openai-compatible 无 Key 时降级并说明原因', () => {
    vi.stubEnv('BOUNTY_GUARD_API_KEY', '');
    vi.stubEnv('OPENAI_API_KEY', '');
    const loaded = loadProvider(AI_OPENAI);
    expect(loaded.mode).toBe('mock');
    expect(loaded.degraded).toBe(true);
    expect(loaded.reason).toContain('API Key');
  });

  it('有 Key 时返回 LLM 适配器，model 与 baseUrl 可由环境变量覆盖', () => {
    vi.stubEnv('BOUNTY_GUARD_API_KEY', 'test-key');
    vi.stubEnv('BOUNTY_GUARD_MODEL', 'glm-4-flash');
    const fromEnv = loadProvider(AI_OPENAI);
    expect(fromEnv.mode).toBe('llm');
    expect(fromEnv.degraded).toBe(false);
    expect(fromEnv.provider.name).toBe('openai-compatible:glm-4-flash');
  });

  it('配置文件里的 model/baseUrl 优先于环境变量', () => {
    vi.stubEnv('BOUNTY_GUARD_API_KEY', 'test-key');
    vi.stubEnv('BOUNTY_GUARD_MODEL', 'from-env-model');
    const loaded = loadProvider({
      ...DEFAULT_CONFIG,
      ai: {
        enabled: true,
        provider: 'openai-compatible',
        model: 'deepseek-chat',
        baseUrl: 'https://api.deepseek.com/v1'
      }
    });
    expect(loaded.provider.name).toBe('openai-compatible:deepseek-chat');
    expect(loaded.provider.name).not.toContain('from-env-model');
  });

  it('provider=off 时即使 enabled 也走纯规则', () => {
    const loaded = loadProvider({ ...DEFAULT_CONFIG, ai: { enabled: true, provider: 'off' } });
    expect(loaded.mode).toBe('mock');
    expect(loaded.degraded).toBe(true);
  });
});
