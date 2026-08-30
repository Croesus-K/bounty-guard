import { describe, expect, it } from 'vitest';
import type { DiffLine, ParsedDiff } from '../src/diff.js';
import { scanDiff } from '../src/scanner.js';
import type { Rule } from '../src/rules/model.js';

/** 构造单文件单 hunk 的测试 diff；条目为 [类型, 内容] */
function singleFileDiff(
  lines: Array<['add' | 'del' | 'context', string]>,
  path = 'src/a.js'
): ParsedDiff {
  let newLine = 0;
  let oldLine = 0;
  return {
    files: [
      {
        path,
        isBinary: false,
        hunks: [
          {
            oldStart: 1,
            oldLines: lines.filter((l) => l[0] !== 'add').length,
            newStart: 1,
            newLines: lines.filter((l) => l[0] !== 'del').length,
            lines: lines.map(([type, content]) => {
              const dl: DiffLine = { type, content };
              if (type !== 'del') dl.newLine = ++newLine;
              if (type !== 'add') dl.oldLine = ++oldLine;
              return dl;
            })
          }
        ]
      }
    ]
  };
}

/** 仅当行内出现标记函数调用时命中的桩规则 */
const ruleBad: Rule = {
  id: 'stub-bad',
  severity: 'high',
  message: '命中 badCall',
  fixHint: '修复 badCall',
  detect: (ctx) => ctx.content.includes('badCall()')
};

/** 无条件命中的桩规则 */
const ruleAll: Rule = {
  id: 'stub-all',
  severity: 'low',
  message: '全部命中',
  fixHint: '无需修复',
  detect: () => true
};

/** 依赖上下文窗口的桩规则：上一行出现敏感词才命中 */
const ruleContext: Rule = {
  id: 'stub-ctx',
  severity: 'medium',
  message: '上下文命中',
  fixHint: '修复上下文',
  detect: (ctx) => ctx.context.some((l) => l.includes('SENSITIVE_TOKEN'))
};

describe('scanDiff', () => {
  it('只审新增行：删除行与上下文行不产出告警', () => {
    const diff = singleFileDiff([
      ['context', 'badCall();'],
      ['del', 'badCall();'],
      ['add', 'ok();']
    ]);
    expect(scanDiff(diff, { ignore: [], rules: [ruleBad] })).toHaveLength(0);
  });

  it('新增行命中时字段完整（文件/行号/片段/严重度/建议/上下文）', () => {
    const diff = singleFileDiff([
      ['context', 'const a = 1;'],
      ['add', 'badCall();']
    ]);
    const findings = scanDiff(diff, { ignore: [], rules: [ruleBad] });
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      ruleId: 'stub-bad',
      severity: 'high',
      file: 'src/a.js',
      line: 2,
      snippet: 'badCall();',
      message: '命中 badCall',
      fixHint: '修复 badCall'
    });
    expect(findings[0].contextLines).toEqual(['const a = 1;']);
  });

  it('ignore 命中的文件整体跳过', () => {
    const diff = singleFileDiff([['add', 'badCall();']], 'node_modules/x.js');
    expect(scanDiff(diff, { ignore: ['node_modules/**'], rules: [ruleBad] })).toHaveLength(0);
    expect(scanDiff(diff, { ignore: [], rules: [ruleBad] })).toHaveLength(1);
  });

  it('多规则命中同一行时产出多条告警', () => {
    const diff = singleFileDiff([['add', 'badCall();']]);
    const findings = scanDiff(diff, { ignore: [], rules: [ruleBad, ruleAll] });
    expect(findings.map((f) => f.ruleId)).toEqual(['stub-bad', 'stub-all']);
  });

  it('上下文窗口传入规则（命中行前一行有敏感词才命中）', () => {
    const withCtx = singleFileDiff([
      ['context', 'SENSITIVE_TOKEN here'],
      ['add', 'harmless();']
    ]);
    expect(scanDiff(withCtx, { ignore: [], rules: [ruleContext] })).toHaveLength(1);

    const noCtx = singleFileDiff([['add', 'harmless();']]);
    expect(scanDiff(noCtx, { ignore: [], rules: [ruleContext] })).toHaveLength(0);
  });

  it('缺省规则集下无害代码不产出告警', () => {
    const diff = singleFileDiff([['add', 'const x = 1;']]);
    expect(scanDiff(diff, { ignore: [] })).toHaveLength(0);
  });

  it('二进制文件整体跳过', () => {
    const diff = singleFileDiff([['add', 'badCall();']]);
    diff.files[0].isBinary = true;
    expect(scanDiff(diff, { ignore: [], rules: [ruleBad] })).toHaveLength(0);
  });

  it('行内豁免注释可跳过单个新增行', () => {
    const exempt = singleFileDiff([['add', 'badCall(); // bounty-guard-ignore']]);
    expect(scanDiff(exempt, { ignore: [], rules: [ruleBad] })).toHaveLength(0);
    const normal = singleFileDiff([['add', 'badCall();']]);
    expect(scanDiff(normal, { ignore: [], rules: [ruleBad] })).toHaveLength(1);
  });

  it('默认跳过测试文件，skipTests:false 可包含', () => {
    const inTestsDir = singleFileDiff([['add', 'badCall();']], 'tests/unit/a.test.ts');
    const testSuffix = singleFileDiff([['add', 'badCall();']], 'src/app.spec.ts');
    expect(scanDiff(inTestsDir, { ignore: [], rules: [ruleBad] })).toHaveLength(0);
    expect(scanDiff(testSuffix, { ignore: [], rules: [ruleBad] })).toHaveLength(0);
    expect(scanDiff(inTestsDir, { ignore: [], rules: [ruleBad], skipTests: false })).toHaveLength(1);
  });

  it('非测试路径不受跳过逻辑影响', () => {
    const diff = singleFileDiff([['add', 'badCall();']], 'src/latest.ts');
    expect(scanDiff(diff, { ignore: [], rules: [ruleBad] })).toHaveLength(1);
  });
});
