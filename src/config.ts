import { existsSync, readFileSync } from 'node:fs';
import type { Severity } from './types.js';

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
  ai: AiConfig;
}

export const DEFAULT_CONFIG: BountyConfig = {
  ignore: ['node_modules/**', 'dist/**', 'coverage/**'],
  failOn: 'high',
  ai: { enabled: false, provider: 'off' }
};

/** 读取并合并 .bountyrc.json；无文件返回默认配置，文件损坏给出明确错误 */
export function loadConfig(cwd: string = process.cwd()): BountyConfig {
  const path = `${cwd}/.bountyrc.json`;
  if (!existsSync(path)) return DEFAULT_CONFIG;
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(`配置文件解析失败：${path}`);
  }
  return {
    ...DEFAULT_CONFIG,
    ...raw,
    ai: { ...DEFAULT_CONFIG.ai, ...(raw.ai ?? {}) }
  } as BountyConfig;
}
