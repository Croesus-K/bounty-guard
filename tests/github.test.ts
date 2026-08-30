import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  resolvePrNumber,
  toAnnotations,
  upsertStickyComment,
  writeSummaryFile
} from '../src/github.js';
import { COMMENT_MARKER } from '../src/report.js';
import type { GithubContext } from '../src/github.js';
import type { Finding } from '../src/types.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

function finding(severity: Finding['severity'], file = 'src/a.js', line = 3): Finding {
  return {
    ruleId: 'xss-inner-html',
    severity,
    file,
    line,
    snippet: "el.innerHTML = '<b>' + name;",
    message: '存在 XSS 风险',
    fixHint: '用 textContent'
  };
}

type JsonResponder = (path: string, init: RequestInit) => unknown;

/** 按路径响应 JSON 的 fetch 桩，记录全部调用 */
function fetchStub(respond: JsonResponder, calls: Array<{ path: string; init: RequestInit }> = []): GithubContext {
  const fetchImpl = (async (url: RequestInfo | URL, init?: RequestInit) => {
    const path = String(url).replace('https://api.github.com', '');
    calls.push({ path, init: init ?? {} });
    const body = respond(path, init ?? {});
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  }) as typeof fetch;
  return { token: 'token-x', repo: 'o/r', fetchImpl };
}

describe('upsertStickyComment', () => {
  it('无历史评论时创建', async () => {
    const calls: Array<{ path: string; init: RequestInit }> = [];
    const ctx = fetchStub(() => [], calls);
    const result = await upsertStickyComment(ctx, 7, '报告内容');
    expect(result).toBe('created');
    expect(calls[0].path).toBe('/repos/o/r/issues/7/comments?per_page=100');
    expect(calls[1].path).toBe('/repos/o/r/issues/7/comments');
    expect(calls[1].init.method).toBe('POST');
    expect(String(calls[1].init.body)).toContain('报告内容');
  });

  it('已有粘性评论时按 id 更新而非新建', async () => {
    const calls: Array<{ path: string; init: RequestInit }> = [];
    const ctx = fetchStub(() => [{ id: 42, body: `旧的 ${COMMENT_MARKER}` }], calls);
    const result = await upsertStickyComment(ctx, 7, '新报告');
    expect(result).toBe('updated');
    expect(calls[1].path).toBe('/repos/o/r/issues/7/comments/42');
    expect(calls[1].init.method).toBe('PATCH');
  });

  it('无关评论不会命中粘性标记', async () => {
    const calls: Array<{ path: string; init: RequestInit }> = [];
    const ctx = fetchStub(() => [{ id: 1, body: '普通评论' }], calls);
    expect(await upsertStickyComment(ctx, 7, '新报告')).toBe('created');
    expect(calls[1].init.method).toBe('POST');
  });
});

describe('toAnnotations', () => {
  it('高危/中危输出 error 标注，低危输出 warning', () => {
    const lines = toAnnotations([finding('high'), finding('low')]);
    expect(lines[0]).toContain('::error file=src/a.js,line=3::');
    expect(lines[0]).toContain('[高危] xss-inner-html');
    expect(lines[1]).toContain('::warning file=src/a.js,line=3::');
  });
});

describe('resolvePrNumber', () => {
  it('优先级：显式参数 > GITHUB_PR_NUMBER > GITHUB_REF', () => {
    expect(resolvePrNumber('12')).toBe(12);
    vi.stubEnv('GITHUB_PR_NUMBER', '34');
    expect(resolvePrNumber()).toBe(34);
    vi.stubEnv('GITHUB_PR_NUMBER', '');
    vi.stubEnv('GITHUB_REF', 'refs/pull/56/merge');
    expect(resolvePrNumber()).toBe(56);
  });

  it('非法输入返回 undefined', () => {
    vi.stubEnv('GITHUB_PR_NUMBER', '');
    vi.stubEnv('GITHUB_REF', 'refs/heads/main');
    expect(resolvePrNumber()).toBeUndefined();
    expect(resolvePrNumber('abc')).toBeUndefined();
  });
});

describe('writeSummaryFile', () => {
  it('写入工作目录固定文件并返回绝对路径', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bg-summary-'));
    const prevCwd = process.cwd();
    process.chdir(dir);
    try {
      const file = writeSummaryFile('# 标题');
      expect(file.startsWith(dir)).toBe(true);
      expect(readFileSync(join(dir, '.bounty-guard-summary.md'), 'utf8')).toBe('# 标题\n');
    } finally {
      process.chdir(prevCwd);
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
