import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config.js';

describe('loadConfig', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'bounty-config-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('无配置文件时返回默认配置', () => {
    const config = loadConfig(dir);
    expect(config.failOn).toBe('high');
    expect(config.ai.enabled).toBe(false);
    expect(config.ignore.length).toBeGreaterThan(0);
    expect(config.scanTests).toBe(false);
  });

  it('读取 .bountyrc.json 并与默认值合并（深合并 ai 段）', () => {
    writeFileSync(
      join(dir, '.bountyrc.json'),
      JSON.stringify({ failOn: 'medium', ai: { enabled: true, provider: 'mock' } })
    );
    const config = loadConfig(dir);
    expect(config.failOn).toBe('medium');
    expect(config.ai.enabled).toBe(true);
    expect(config.ai.provider).toBe('mock');
    expect(config.ignore.length).toBeGreaterThan(0); // 默认项保留
  });

  it('损坏的配置文件给出明确错误而非崩溃堆栈', () => {
    writeFileSync(join(dir, '.bountyrc.json'), '{bad json');
    expect(() => loadConfig(dir)).toThrow(/解析失败/);
  });

  it('failOn 非法值在加载时抛错，杜绝门禁静默失效', () => {
    writeFileSync(join(dir, '.bountyrc.json'), JSON.stringify({ failOn: 'high ' }));
    expect(() => loadConfig(dir)).toThrow(/failOn 取值无效/);
  });

  it('ai.provider 非法值在加载时抛错', () => {
    writeFileSync(join(dir, '.bountyrc.json'), JSON.stringify({ ai: { enabled: true, provider: 'chatgpt' } }));
    expect(() => loadConfig(dir)).toThrow(/ai\.provider 取值无效/);
  });
});
