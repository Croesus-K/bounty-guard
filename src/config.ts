import { existsSync, readFileSync } from 'node:fs';
import { SEVERITIES } from './types.js';
import type { Severity } from './types.js';

/** ai.provider 的合法值清单 */
const AI_PROVIDERS: readonly string[] = ['openai-compatible', 'mock', 'off'];

export interface AiConfig {
  enabled: boolean;
  provider: 'openai-compatible' | 'mock' | 'off';
  model?: string;
  baseUrl?: string;
}

export interface BountyConfig {
  /** glob 或路径前缀，命中的文件跳过扫描 */
  ignore: string[];
  /** 告警达到该等级时以非零码退出（CI 门禁依据） */
  failOn: Severity;
  /** 是否把测试文件也纳入扫描（默认跳过——测试样例是已知误报源） */
  scanTests?: boolean;
  ai: AiConfig;
}

export const DEFAULT_CONFIG: BountyConfig = {
  ignore: ['node_modules/**', 'dist/**', 'coverage/**'],
  failOn: 'high',
  scanTests: false,
  ai: { enabled: false, provider: 'off' }
};

/** 读取并合并 .bountyrc.json；无文件返回默认配置，文件损坏或门禁配置非法时给出明确错误。
 * 门禁类配置宁可在加载时失败，也绝不静默失效——failOn 写错却照常放行是安全工具的大忌。 */
export function loadConfig(cwd: string = process.cwd()): BountyConfig {
  const path = `${cwd}/.bountyrc.json`;
  if (!existsSync(path)) return DEFAULT_CONFIG;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`配置文件解析失败：${path}`);
  }
  const merged = {
    ...DEFAULT_CONFIG,
    ...raw,
    ai: { ...DEFAULT_CONFIG.ai, ...(raw.ai ?? {}) }
  } as BountyConfig;
  if (!(SEVERITIES as readonly string[]).includes(merged.failOn)) {
    throw new Error(
      `配置文件 failOn 取值无效：${String(merged.failOn)}（可选 ${SEVERITIES.join(' | ')}）`
    );
  }
  if (!AI_PROVIDERS.includes(merged.ai.provider)) {
    throw new Error(
      `配置文件 ai.provider 取值无效：${String(merged.ai.provider)}（可选 ${AI_PROVIDERS.join(' | ')}）`
    );
  }
  return merged;
}
