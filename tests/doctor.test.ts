import { describe, expect, it } from 'vitest';
import {
  checkAi,
  checkConfig,
  checkConfigError,
  checkGit,
  checkNodeVersion,
  hasFailure,
  renderChecks
} from '../src/doctor.js';
import type { BountyConfig } from '../src/config.js';
import type { LoadedProvider } from '../src/llm/provider.js';

const OK_CONFIG: BountyConfig = {
  ignore: ['node_modules/**'],
  failOn: 'high',
  scanTests: false,
  disabledRules: [],
  ai: { enabled: false, provider: 'off' }
};

describe('doctor 检查项', () => {
  it('Node 版本：达标 ok，过低 fail，异常 warn', () => {
    expect(checkNodeVersion('20.11.0').status).toBe('ok');
    expect(checkNodeVersion('18.0.0').status).toBe('fail');
    expect(checkNodeVersion('abc').status).toBe('warn');
  });

  it('Git：不可用 fail，非仓库 warn，仓库 ok', () => {
    expect(checkGit(null, false).status).toBe('fail');
    expect(checkGit('2.55.0', false).status).toBe('warn');
    expect(checkGit('2.55.0', true).status).toBe('ok');
  });

  it('配置：正常 ok，加载错误 fail 且带原始信息', () => {
    expect(checkConfig(OK_CONFIG).status).toBe('ok');
    const err = checkConfigError(new Error('配置文件 failOn 取值无效：hi'));
    expect(err.status).toBe('fail');
    expect(err.detail).toContain('failOn');
  });

  it('AI 复核：降级 warn 带原因，mock ok，llm 走探测', async () => {
    const degraded: LoadedProvider = {
      provider: {} as never,
      mode: 'mock',
      degraded: true,
      reason: '未检测到 API Key，已降级'
    };
    const degradedCheck = await checkAi(degraded, async () => ({ status: 'ok', detail: '不该被调用' }));
    expect(degradedCheck.status).toBe('warn');
    expect(degradedCheck.detail).toContain('API Key');

    const mock: LoadedProvider = { provider: {} as never, mode: 'mock', degraded: false };
    expect((await checkAi(mock, async () => ({ status: 'fail', detail: '' }))).status).toBe('ok');

    const llm: LoadedProvider = {
      provider: {} as never,
      mode: 'llm',
      degraded: false,
      baseUrl: 'https://api.example.test/v1',
      apiKey: 'k'
    };
    const failProbe = async () => ({ status: 'fail' as const, detail: 'API Key 无效（401）' });
    expect((await checkAi(llm, failProbe)).status).toBe('fail');
  });

  it('渲染与汇总：fail 决定整体不通过', () => {
    const checks = [
      { name: 'A', status: 'ok' as const, detail: 'x' },
      { name: 'B', status: 'warn' as const, detail: 'y' },
      { name: 'C', status: 'fail' as const, detail: 'z' }
    ];
    const text = renderChecks(checks);
    expect(text).toContain('✓ A');
    expect(text).toContain('⚠ B');
    expect(text).toContain('✗ C');
    expect(hasFailure(checks)).toBe(true);
    expect(hasFailure(checks.slice(0, 2))).toBe(false);
  });
});
