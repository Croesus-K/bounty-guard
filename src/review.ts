/**
 * 复核流水线：规则候选告警 → LLM 逐条核实 → 过滤误报 / 应用降级。
 * 约束：LLM 只复核、不发明——本模块只会增改已有 Finding 的复核字段
 * 或剔除误报，绝不发明新告警；被剔除的误报计数上报（降噪可量化）。
 *
 * 成本护栏：
 * - 相同「规则 + 归一化片段」的告警共享一次复核结论（去重）；
 * - 按严重度优先送审，超出 maxReviews 的保留规则原判并计入 unreviewed；
 * - 并发度可调（默认 4），避免大 diff 时逐条串行等待。
 */
import { SEVERITY_RANK } from './types.js';
import type { Finding, LLMProvider, LLMReviewRequest, LLMReviewResult } from './types.js';

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

export interface ReviewOptions {
  /** 并发复核数（默认 4） */
  concurrency?: number;
  /** 最多送审的告警组数（默认 20）；按严重度优先，超出部分保留规则原判 */
  maxReviews?: number;
}

export interface ReviewOutcome {
  /** 过滤误报后的最终告警（已复核项挂载 review 结果） */
  findings: Finding[];
  /** 被判误报剔除的数量 */
  filtered: number;
  /** 严重度被下调的数量 */
  downgraded: number;
  /** 实际送入 LLM 的告警数（按条计） */
  reviewed: number;
  /** 因超出上限未复核、保留规则原判的告警数 */
  unreviewed: number;
}

export async function reviewFindings(
  findings: Finding[],
  provider: LLMProvider,
  options: ReviewOptions = {}
): Promise<ReviewOutcome> {
  const concurrency = Math.max(1, Math.floor(options.concurrency ?? 4));
  const maxReviews = Math.max(1, Math.floor(options.maxReviews ?? 20));

  // 按「规则 + 归一化片段」分组去重：同组告警共享一次复核结论
  const groups = new Map<string, Finding[]>();
  for (const finding of findings) {
    const key = `${finding.ruleId}|${finding.snippet.trim()}`;
    const group = groups.get(key);
    if (group) group.push(finding);
    else groups.set(key, [finding]);
  }

  // 复核优先级：严重度高的组先送审
  const ordered = [...groups.entries()].sort(
    (a, b) => SEVERITY_RANK[b[1][0].severity] - SEVERITY_RANK[a[1][0].severity]
  );
  const toReview = ordered.slice(0, maxReviews);
  const verdicts = new Map<string, LLMReviewResult>();

  let cursor = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const index = cursor++;
      if (index >= toReview.length) return;
      const [key, group] = toReview[index];
      const sample = group[0];
      const request: LLMReviewRequest = {
        ruleId: sample.ruleId,
        severity: sample.severity,
        snippet: sample.snippet,
        language: languageOf(sample.file),
        context: sample.contextLines
      };
      verdicts.set(key, await provider.review(request));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, toReview.length) }, worker));

  const kept: Finding[] = [];
  let filtered = 0;
  let downgraded = 0;
  let reviewed = 0;
  for (const [key, group] of groups.entries()) {
    const review = verdicts.get(key);
    if (!review) {
      kept.push(...group); // 超出上限：保留规则原判
      continue;
    }
    for (const finding of group) {
      reviewed++;
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
  }
  return { findings: kept, filtered, downgraded, reviewed, unreviewed: findings.length - reviewed };
}
