/**
 * 终端报告渲染与 CI 门禁判定。
 */
import { SEVERITY_RANK } from './types.js';
import type { Finding, Severity } from './types.js';

/** 各严重度的中文标签 */
const LABELS: Record<Severity, string> = {
  high: '高危',
  medium: '中危',
  low: '低危',
  info: '提示'
};

/** CI 门禁：任一告警达到 failOn 档即应非零退出 */
export function shouldFail(findings: Finding[], failOn: Severity): boolean {
  const threshold = SEVERITY_RANK[failOn];
  return findings.some((f) => SEVERITY_RANK[f.severity] >= threshold);
}

export interface ReportMeta {
  /** 扫描来源描述，如「git 未提交变更」 */
  source: string;
  scannedFiles: number;
  addedLines: number;
  /** LLM 复核汇总（未开启复核时缺省） */
  review?: { provider: string; confirmed: number; filtered: number; downgraded: number };
}

/** 渲染中文终端报告，按文件分组 */
export function renderReport(findings: Finding[], meta: ReportMeta): string {
  const out: string[] = [];
  out.push('bounty-guard 扫描报告');
  out.push(`来源：${meta.source} ｜ 扫描文件 ${meta.scannedFiles} 个 ｜ 新增行 ${meta.addedLines} 行`);
  if (meta.review) {
    out.push(
      `LLM 复核（${meta.review.provider}）：确认 ${meta.review.confirmed} · 误报过滤 ${meta.review.filtered} · 严重度下调 ${meta.review.downgraded}`
    );
  }
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
        const suffix = f.review
          ? f.review.verdict === 'unsure'
            ? ' · LLM 未能确证，保留原判'
            : f.review.severity
              ? ' · 严重度经复核下调'
              : ''
          : '';
        out.push(`  [${LABELS[f.severity]}] ${f.ruleId} · 第 ${f.line} 行${suffix}`);
        out.push(`    ${f.snippet.trim()}`);
        out.push(`    ⚠ ${f.message}`);
        if (f.review?.fixSuggestion) out.push(`    💡 修复建议（复核）：${f.review.fixSuggestion}`);
        else if (f.fixHint) out.push(`    💡 ${f.fixHint}`);
      }
      out.push('');
    }
  }

  const count = (s: Severity) => findings.filter((f) => f.severity === s).length;
  out.push(`汇总：高危 ${count('high')} · 中危 ${count('medium')} · 低危 ${count('low')} · 提示 ${count('info')}`);
  return out.join('\n');
}
