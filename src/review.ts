/**
 * 复核流水线：规则候选告警 → LLM 逐条核实 → 过滤误报 / 应用降级。
 * 约束：LLM 只复核、不发明——本模块只会增改已有 Finding 的复核字段
 * 或剔除误报，绝不发明新告警；被剔除的误报计数上报（降噪可量化）。
 */
import { SEVERITY_RANK } from './types.js';
import type { Finding, LLMProvider, LLMReviewRequest } from './types.js';

const LANGUAGE_BY_EXT: Record<string, string> = {
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  jsx: 'javascript',
  ts: 'typescript',
  tsx: 'typescript',
  vue: 'vue',
  html: 'html',
  css: 'css',
  py: 'python',
  go: 'go',
  java: 'java',
  php: 'php',
  rb: 'ruby',
  sql: 'sql'
};

/** 从文件扩展名推断语言（供 LLM 判断语境） */
export function languageOf(file: string): string {
  const dot = file.lastIndexOf('.');
  if (dot === -1 || dot === file.length - 1) return 'unknown';
  return LANGUAGE_BY_EXT[file.slice(dot + 1).toLowerCase()] ?? 'unknown';
}

export interface ReviewOutcome {
  /** 过滤误报后的最终告警（已挂载 review 结果） */
  findings: Finding[];
  /** 被判误报剔除的数量 */
  filtered: number;
  /** 严重度被下调的数量 */
  downgraded: number;
}

export async function reviewFindings(
  findings: Finding[],
  provider: LLMProvider
): Promise<ReviewOutcome> {
  const kept: Finding[] = [];
  let filtered = 0;
  let downgraded = 0;
  for (const finding of findings) {
    const request: LLMReviewRequest = {
      ruleId: finding.ruleId,
      severity: finding.severity,
      snippet: finding.snippet,
      language: languageOf(finding.file),
      context: finding.contextLines
    };
    const review = await provider.review(request);
    if (review.verdict === 'false-positive') {
      filtered++;
      continue; // 误报剔除——降噪主通道
    }
    const result: Finding = { ...finding, review };
    if (review.severity && SEVERITY_RANK[review.severity] < SEVERITY_RANK[result.severity]) {
      result.severity = review.severity; // 只可能下调（适配器已丢弃上调建议，这里双保险）
      downgraded++;
    }
    kept.push(result);
  }
  return { findings: kept, filtered, downgraded };
}
