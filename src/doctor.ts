/**
 * doctor 体检：把「配置/环境是否就绪」拆成一组可单独测试的检查项。
 * CLI 的 doctor 命令负责收集环境事实（Node 版本、git 状态、配置加载、
 * AI 供应商连通性），本模块只做判定与渲染。
 */
import type { BountyConfig } from './config.js';
import type { LoadedProvider } from './llm/provider.js';

export interface Check {
  name: string;
  status: 'ok' | 'warn' | 'fail';
  detail: string;
}

export type ProbeResult = { status: 'ok' | 'warn' | 'fail'; detail: string };

/** Node 版本：bounty-guard 要求 ≥ 20 */
export function checkNodeVersion(version: string, minimum = 20): Check {
  const major = Number(version.split('.')[0]);
  if (Number.isNaN(major)) {
    return { name: 'Node 版本', status: 'warn', detail: `无法解析版本号：${version}` };
  }
  return major >= minimum
    ? { name: 'Node 版本', status: 'ok', detail: `v${version}（要求 ≥ v${minimum}）` }
    : { name: 'Node 版本', status: 'fail', detail: `v${version} 低于要求的 v${minimum}，请升级 Node` };
}

export function checkGit(gitVersion: string | null, isRepo: boolean): Check {
  if (gitVersion === null) return { name: 'Git', status: 'fail', detail: 'git 命令不可用' };
  if (!isRepo) {
    return {
      name: 'Git',
      status: 'warn',
      detail: `${gitVersion}；当前目录不在 git 仓库内，scan --git 不可用`
    };
  }
  return { name: 'Git', status: 'ok', detail: `${gitVersion}；当前为 git 仓库` };
}

export function checkConfig(config: BountyConfig): Check {
  return {
    name: '配置文件',
    status: 'ok',
    detail: `failOn=${config.failOn} · scanTests=${config.scanTests} · ignore ${config.ignore.length} 条 · 禁用规则 ${config.disabledRules?.length ?? 0} 条`
  };
}

export function checkConfigError(err: unknown): Check {
  return {
    name: '配置文件',
    status: 'fail',
    detail: err instanceof Error ? err.message : String(err)
  };
}

/** AI 复核检查：llm 模式探测连通性；降级/mock 分别给出对应说明 */
export async function checkAi(
  loaded: LoadedProvider,
  probe: (baseUrl: string, apiKey: string) => Promise<ProbeResult>
): Promise<Check> {
  if (loaded.mode === 'llm') {
    const result = await probe(loaded.baseUrl ?? '', loaded.apiKey ?? '');
    return { name: 'AI 复核', ...result };
  }
  if (loaded.degraded) {
    return { name: 'AI 复核', status: 'warn', detail: loaded.reason ?? '未启用' };
  }
  return { name: 'AI 复核', status: 'ok', detail: '演练模式（MockProvider），复核流水线可用' };
}

const ICONS: Record<Check['status'], string> = { ok: '✓', warn: '⚠', fail: '✗' };

export function renderChecks(checks: Check[]): string {
  return checks.map((c) => `${ICONS[c.status]} ${c.name}：${c.detail}`).join('\n');
}

export function hasFailure(checks: Check[]): boolean {
  return checks.some((c) => c.status === 'fail');
}
