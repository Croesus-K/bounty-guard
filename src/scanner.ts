/**
 * 扫描器：遍历 diff 的新增行，逐行交给规则集判定。
 * 「只审新增行」的约束在这里强制执行——这是成本控制的根基；
 * 删除行与上下文行只作为规则判定的上下文，绝不直接产出告警。
 */
import type { DiffLine, ParsedDiff } from './diff.js';
import { matchGlob } from './glob.js';
import { ALL_RULES } from './rules/index.js';
import type { Rule, RuleContext } from './rules/model.js';
import type { Finding } from './types.js';

export interface ScanOptions {
  /** 跳过扫描的文件 glob 列表（来自 .bountyrc.json 的 ignore） */
  ignore: string[];
  /** 规则集注入点（测试用）；缺省为全部已注册规则 */
  rules?: Rule[];
}

/** 命中行前后各至多 3 行的 add/context 文本（不含命中行），供需要上下文的规则使用 */
function contextWindow(lines: DiffLine[], hit: number): string[] {
  const window: string[] = [];
  for (let i = Math.max(0, hit - 3); i < hit; i++) {
    if (lines[i].type !== 'del') window.push(lines[i].content);
  }
  for (let i = hit + 1; i <= Math.min(lines.length - 1, hit + 3); i++) {
    if (lines[i].type !== 'del') window.push(lines[i].content);
  }
  return window;
}

/** 扫描整个 diff，返回全部告警（按文件、行遍历顺序） */
export function scanDiff(diff: ParsedDiff, options: ScanOptions): Finding[] {
  const findings: Finding[] = [];
  const rules = options.rules ?? ALL_RULES;

  for (const file of diff.files) {
    if (file.isBinary) continue;
    if (matchGlob(file.path, options.ignore)) continue;
    for (const hunk of file.hunks) {
      for (let i = 0; i < hunk.lines.length; i++) {
        const line = hunk.lines[i];
        if (line.type !== 'add' || line.newLine === undefined) continue;
        const ctx: RuleContext = {
          file: file.path,
          line: line.newLine,
          content: line.content,
          context: contextWindow(hunk.lines, i)
        };
        for (const rule of rules) {
          if (!rule.detect(ctx)) continue;
          findings.push({
            ruleId: rule.id,
            severity: rule.severity,
            file: file.path,
            line: line.newLine,
            snippet: line.content,
            message: rule.message,
            fixHint: rule.fixHint,
            contextLines: ctx.context
          });
        }
      }
    }
  }
  return findings;
}
