import { writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { COMMENT_MARKER, LABELS } from './report.js';
import type { Finding } from './types.js';

/**
 * GitHub REST 交互（零依赖 fetch 封装）：PR diff 读取、粘性评论、
 * Job Summary 暂存与 Actions 告警标注。fetch 可注入以便测试。
 * 约束：环境变量提供的路径一律不做 fs 读写（防路径注入面）。
 */

export interface GithubContext {
  token: string;
  /** 仓库 slug：owner/name */
  repo: string;
  /** fetch 注入点（测试用）；缺省用全局 fetch */
  fetchImpl?: typeof fetch;
}

async function githubJson<T>(ctx: GithubContext, path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = ctx.fetchImpl ?? fetch;
  const res = await doFetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${ctx.token}`,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json',
      ...(init.headers ?? {})
    }
  });
  if (!res.ok) throw new Error(`GitHub API ${path} 失败：HTTP ${res.status}`);
  return (await res.json()) as T;
}

/** 读取 PR 的 unified diff（REST 原生支持，无需 git 历史） */
export async function fetchPrDiff(ctx: GithubContext, prNumber: number): Promise<string> {
  const doFetch = ctx.fetchImpl ?? fetch;
  const res = await doFetch(`https://api.github.com/repos/${ctx.repo}/pulls/${prNumber}`, {
    headers: { Authorization: `Bearer ${ctx.token}`, Accept: 'application/vnd.github.diff' }
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}

interface IssueComment {
  id: number;
  body?: string;
}

/** 粘性评论：已有 bounty-guard 评论则更新，否则新建（重复扫描不刷屏） */
export async function upsertStickyComment(
  ctx: GithubContext,
  prNumber: number,
  body: string,
  marker: string = COMMENT_MARKER
): Promise<'created' | 'updated'> {
  const comments = await githubJson<IssueComment[]>(
    ctx,
    `/repos/${ctx.repo}/issues/${prNumber}/comments?per_page=100`
  );
  const existing = Array.isArray(comments)
    ? comments.find((c) => typeof c.body === 'string' && c.body.includes(marker))
    : undefined;
  if (existing) {
    await githubJson(ctx, `/repos/${ctx.repo}/issues/${prNumber}/comments/${existing.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ body })
    });
    return 'updated';
  }
  await githubJson(ctx, `/repos/${ctx.repo}/issues/${prNumber}/comments`, {
    method: 'POST',
    body: JSON.stringify({ body })
  });
  return 'created';
}

/** 生成 Actions 告警标注（高危/中危 error，低危及以下 warning） */
export function toAnnotations(findings: Finding[]): string[] {
  return findings.map((f) => {
    const level = f.severity === 'high' || f.severity === 'medium' ? 'error' : 'warning';
    return `::${level} file=${f.file},line=${f.line}::[${LABELS[f.severity]}] ${f.ruleId}：${f.message}`;
  });
}

/** Job Summary 暂存文件名（工作目录下固定文件，由 Action 步骤追加到 $GITHUB_STEP_SUMMARY） */
export const SUMMARY_FILE = '.bounty-guard-summary.md';

/** 将 Markdown 报告写入工作目录的固定暂存文件，返回绝对路径 */
export function writeSummaryFile(markdown: string): string {
  writeFileSync(SUMMARY_FILE, `${markdown}\n`);
  return resolve(SUMMARY_FILE);
}

/** 解析 PR 编号：显式参数 → GITHUB_PR_NUMBER → GITHUB_REF。
 * 注：不读取 GITHUB_EVENT_PATH 事件文件（env 提供的路径一律不做 fs 操作），
 * Actions 的 pull_request 事件里 GITHUB_REF 必为 refs/pull/<n>/merge，已足够。 */
export function resolvePrNumber(explicit?: string): number | undefined {
  if (explicit) {
    const n = Number(explicit);
    if (Number.isInteger(n) && n > 0) return n;
  }
  const envNumber = Number(process.env.GITHUB_PR_NUMBER);
  if (Number.isInteger(envNumber) && envNumber > 0) return envNumber;
  const fromRef = (process.env.GITHUB_REF ?? '').match(/^refs\/pull\/(\d+)\/merge$/);
  if (fromRef) return Number(fromRef[1]);
  return undefined;
}
