import { describe, expect, it } from 'vitest';
import { renderReport, shouldFail } from '../src/report.js';
import type { Finding, Severity } from '../src/types.js';

function finding(severity: Severity, file = 'src/a.js', line = 3): Finding {
  return {
    ruleId: 'r-1',
    severity,
    file,
    line,
    snippet: 'const x = bad();',
    message: '问题',
    fixHint: '建议'
  };
}

describe('renderReport', () => {
  it('包含来源、统计与命中的关键字段', () => {
    const text = renderReport([finding('high')], {
      source: 'git 未提交变更',
      scannedFiles: 2,
      addedLines: 10
    });
    expect(text).toContain('bounty-guard 扫描报告');
    expect(text).toContain('git 未提交变更');
    expect(text).toContain('扫描文件 2 个');
    expect(text).toContain('新增行 10 行');
    expect(text).toContain('src/a.js');
    expect(text).toContain('[高危]');
    expect(text).toContain('r-1');
    expect(text).toContain('第 3 行');
    expect(text).toContain('const x = bad();');
    expect(text).toContain('⚠ 问题');
    expect(text).toContain('💡 建议');
    expect(text).toContain('汇总：高危 1 · 中危 0 · 低危 0 · 提示 0');
  });

  it('无告警时输出未发现问题', () => {
    const text = renderReport([], { source: 'diff 文件 x.diff', scannedFiles: 1, addedLines: 5 });
    expect(text).toContain('✅ 未发现问题');
    expect(text).toContain('汇总：高危 0 · 中危 0 · 低危 0 · 提示 0');
  });

  it('按文件分组展示', () => {
    const text = renderReport([finding('low', 'a.js'), finding('info', 'b.js')], {
      source: 's',
      scannedFiles: 2,
      addedLines: 2
    });
    expect(text.indexOf('a.js')).toBeLessThan(text.indexOf('b.js'));
    expect(text).toContain('[低危]');
    expect(text).toContain('[提示]');
  });
});

describe('shouldFail', () => {
  it('failOn=high：仅低危放行，高危拦截', () => {
    expect(shouldFail([finding('low')], 'high')).toBe(false);
    expect(shouldFail([finding('high')], 'high')).toBe(true);
  });

  it('failOn=medium：低危放行，中危及以上拦截', () => {
    expect(shouldFail([finding('low')], 'medium')).toBe(false);
    expect(shouldFail([finding('medium')], 'medium')).toBe(true);
    expect(shouldFail([finding('high')], 'medium')).toBe(true);
  });

  it('failOn=info：任何告警都拦截，无告警放行', () => {
    expect(shouldFail([finding('info')], 'info')).toBe(true);
    expect(shouldFail([], 'info')).toBe(false);
  });
});
