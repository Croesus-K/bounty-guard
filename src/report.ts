/**
 * 终端报告渲染与 CI 门禁判定。
 */
import type { Finding, Severity } from './types.js';

/** 各严重度的中文标签 */
const LABELS: Record<Severity, string> = {
  high: '高危',
  medium: '中危',
  low: '低危',
  info: '提示'
};

/** 严重度排序：info < low < medium < high */
const RANK: Record<Severity, number> = { info: 0, low: 1, medium: 2, high: 3 };

/** CI 门禁：任一告警达到 failOn 档即应非零退出 */
export function shouldFail(findings: Finding[], failOn: Severity): boolean {
  const threshold = RANK[failOn];
  return findings.some((f) => RANK[f.severity] >= threshold);
}

export interface ReportMeta {
  /** 扫描来源描述，如「git 未提交变更」 */
  source: string;
  scannedFiles: number;
  addedLines: number;
}

/** 渲染中文终端报告，按文件分组 */
export function renderReport(findings: Finding[], meta: ReportMeta): string {
  const out: string[] = [];
  out.push('bounty-guard 扫描报告');
  out.push(`来源：${meta.source} ｜ 扫描文件 ${meta.scannedFiles} 个 ｜ 新增行 ${meta.addedLines} 行`);
  out.push('');

  if (findings.length === 0) {
    out.push('✅ 未发现问题');
  } else {
    const byFile = new Map<string, Finding[]>();
    for (const f of findings) {
      const list = byFile.get(f.file);
      if (list) list.push(f);
      else byFile.set(f.file, [f]);
    }
    for (const [file, list] of byFile) {
      out.push(file);
      for (const f of list) {
        out.push(`  [${LABELS[f.severity]}] ${f.ruleId} · 第 ${f.line} 行`);
        out.push(`    ${f.snippet.trim()}`);
        out.push(`    ⚠ ${f.message}`);
        if (f.fixHint) out.push(`    💡 ${f.fixHint}`);
      }
      out.push('');
    }
  }

  const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
  out.push(`汇总：高危 ${count('high')} · 中危 ${count('medium')} · 低危 ${count('low')} · 提示 ${count('info')}`);
  return out.join('\n');
}
