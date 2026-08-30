#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import type { BountyConfig } from './config.js';
import { loadConfig } from './config.js';
import { parseDiff, unquoteGitPath, type DiffLine, type ParsedDiff, type ParsedFile } from './diff.js';
import {
  fetchPrDiff,
  parseRepoSlug,
  resolvePrNumber,
  toAnnotations,
  upsertStickyComment,
  writeSummaryFile
} from './github.js';
import { matchGlob } from './glob.js';
import { loadProvider } from './llm/provider.js';
import { renderMarkdownReport, renderReport, renderSarif, shouldFail, type ReportMeta } from './report.js';
import { reviewFindings } from './review.js';
import { scanDiff } from './scanner.js';
import { SEVERITIES, type Finding, type Severity } from './types.js';

const require = createRequire(import.meta.url);
const VERSION: string = require('../package.json').version;

const USAGE_HINT = '请指定扫描来源：--git（扫描未提交变更）或 --diff <file>（扫描 diff 文件）';
const FORMATS: readonly string[] = ['text', 'sarif', 'json'];

/** 用法类错误：输出友好提示并以退出码 2 结束 */
class UsageError extends Error {}

/** 校验 --fail-on 取值；无值时回退配置文件 */
function resolveFailOn(config: BountyConfig, value?: string): Severity {
  if (!value) return config.failOn;
  if (!(SEVERITIES as readonly string[]).includes(value)) {
    throw new UsageError(`--fail-on 取值无效：${value}（可选 ${SEVERITIES.join(' | ')}）`);
  }
  return value as Severity;
}

/** 以子进程运行 git（参数列表形式，不经 shell），非零退出时以 stderr 文本抛错 */
function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn('git', args, { cwd });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk;
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolvePromise(stdout);
      else reject(new Error(stderr.trim() || `git 以退出码 ${code ?? '未知'} 异常结束`));
    });
  });
}

/** 未跟踪文件 → 整文件皆视为新增行 */
function fileToParsedFile(path: string, content: string): ParsedFile {
  const lines = content.split(/\r?\n/);
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const diffLines: DiffLine[] = lines.map((content, i) => ({ type: 'add', content, newLine: i + 1 }));
  return {
    path,
    isBinary: false,
    hunks: [{ oldStart: 0, oldLines: 0, newStart: 1, newLines: diffLines.length, lines: diffLines }]
  };
}

/** 组装「未提交变更」：git diff HEAD（首次提交前回退索引对比）+ 未跟踪文件 */
async function collectGitChanges(cwd: string): Promise<ParsedDiff> {
  let text: string;
  try {
    text = await runGit(['diff', 'HEAD'], cwd);
  } catch {
    // 尚无首次提交时 HEAD 不存在，改用索引对比（新仓库的变更通常已暂存）
    text = await runGit(['diff', '--cached'], cwd);
  }
  const parsed = parseDiff(text);
  const status = await runGit(['status', '--porcelain', '-uall'], cwd);
  for (const line of status.split(/\r?\n/)) {
    if (!line.startsWith('?? ')) continue;
    const file = unquoteGitPath(line.slice(3));
    if (!file || file.endsWith('/')) continue;
    let content: string;
    try {
      content = readFileSync(`${cwd}/${file}`, 'utf8');
    } catch {
      continue; // 读不到（权限/编码）就放过，宁漏报不崩溃
    }
    if (content.includes('\u0000')) continue; // 二进制内容跳过
    parsed.files.push(fileToParsedFile(file, content));
  }
  return parsed;
}

interface ScanOutcome {
  findings: Finding[];
  scannedFiles: number;
  addedLines: number;
  review?: ReportMeta['review'];
}

/** 解析并扫描 diff，按需执行 LLM 复核（scan 与 pr-comment 共用）。
 * upgradeOff：--ai 显式启用时把 provider=off 升级为 openai-compatible；
 * 仅配置启用时保持用户配置（off 仍是纯规则）。 */
async function scanAndReview(
  diff: ParsedDiff,
  config: BountyConfig,
  wantAi: boolean,
  upgradeOff: boolean
): Promise<ScanOutcome> {
  let findings = scanDiff(diff, {
    ignore: config.ignore,
    skipTests: !config.scanTests,
    disabledRules: config.disabledRules
  });
  const scannable = diff.files.filter((f) => !f.isBinary && !matchGlob(f.path, config.ignore));
  const addedLines = scannable.reduce(
    (sum, f) => sum + f.hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'add').length, 0),
    0
  );

  let review: ReportMeta['review'];
  if (wantAi) {
    const effective =
      upgradeOff && config.ai.provider === 'off'
        ? { ...config, ai: { ...config.ai, enabled: true, provider: 'openai-compatible' as const } }
        : config;
    const loaded = loadProvider(effective);
    if (loaded.degraded) {
      console.log(`ℹ️ ${loaded.reason}\n`);
    } else {
        const outcome = await reviewFindings(findings, loaded.provider);
        findings = outcome.findings;
        review = {
          provider: loaded.provider.name,
          confirmed: outcome.findings.length,
          filtered: outcome.filtered,
          downgraded: outcome.downgraded,
          unreviewed: outcome.unreviewed
        };
    }
  }
  return { findings, scannedFiles: scannable.length, addedLines, review };
}

const program = new Command();

program
  .name('bounty-guard')
  .description('AI 代码安全审查助手 —— 规则引擎初筛 + LLM 复核，守住每一行 diff')
  .version(VERSION);

program
  .command('scan')
  .description('扫描代码变更中的安全问题（规则初筛；LLM 复核可选）')
  .option('--git', '扫描当前仓库的未提交变更')
  .option('--diff <file>', '从 unified diff 文件扫描')
  .option('--ai', '启用 LLM 复核（无 API Key 时自动降级为纯规则模式）')
  .option('--fail-on <severity>', '门禁等级：high | medium | low | info（覆盖配置文件）')
  .option('-f, --format <fmt>', '输出格式：text | sarif | json（默认 text）')
  .action(async (options: { git?: boolean; diff?: string; ai?: boolean; failOn?: string; format?: string }) => {
    try {
      if (!options.git && !options.diff) throw new UsageError(USAGE_HINT);
      if (options.git && options.diff) throw new UsageError('两种扫描来源互斥，只能二选一');
      const config = loadConfig();
      const failOn = resolveFailOn(config, options.failOn);

      const cwd = process.cwd();
      let diff: ParsedDiff;
      let source: string;
      try {
        if (options.diff) {
          diff = parseDiff(readFileSync(options.diff, 'utf8'));
          source = `diff 文件 ${options.diff}`;
        } else {
          diff = await collectGitChanges(cwd);
          source = 'git 未提交变更';
        }
      } catch (err) {
        throw new UsageError(`获取扫描来源失败：${err instanceof Error ? err.message : String(err)}`);
      }

      const outcome = await scanAndReview(diff, config, Boolean(options.ai), Boolean(options.ai));
      const format = options.format ?? 'text';
      if (!(FORMATS as readonly string[]).includes(format)) {
        throw new UsageError(`--format 取值无效：${format}（可选 ${FORMATS.join(' | ')}）`);
      }
      const meta = {
        source,
        scannedFiles: outcome.scannedFiles,
        addedLines: outcome.addedLines,
        review: outcome.review
      };
      if (format === 'sarif') {
        console.log(JSON.stringify(renderSarif(outcome.findings, meta), null, 2));
      } else if (format === 'json') {
        console.log(JSON.stringify({ ...meta, findings: outcome.findings }, null, 2));
      } else {
        console.log(renderReport(outcome.findings, meta));
      }
      process.exitCode = shouldFail(outcome.findings, failOn) ? 1 : 0;
    } catch (err) {
      if (err instanceof UsageError) {
        console.error(err.message);
        process.exitCode = 2;
        return;
      }
      throw err;
    }
  });

program
  .command('pr-comment')
  .description('扫描 GitHub PR 并发布/更新粘性评论（供 Action 调用）')
  .option('--pr <number>', 'PR 编号（缺省从 GITHUB_PR_NUMBER / GITHUB_REF 推断）')
  .option('--repo <slug>', '仓库 owner/name（缺省 GITHUB_REPOSITORY）')
  .option('--fail-on <severity>', '门禁等级：high | medium | low | info（覆盖配置文件）')
  .option('--ai', '启用 LLM 复核（无 API Key 时自动降级为纯规则模式）')
  .option('--annotations', '输出 Actions 告警标注（::error/::warning）')
  .option('--summary', '把 Markdown 报告写入暂存文件，供 Action 步骤追加到 Job Summary')
  .action(async (options: { pr?: string; repo?: string; failOn?: string; ai?: boolean; annotations?: boolean; summary?: boolean }) => {
    try {
      const token = process.env.GITHUB_TOKEN;
      if (!token) throw new UsageError('缺少 GITHUB_TOKEN 环境变量');
      const repoInput = options.repo ?? process.env.GITHUB_REPOSITORY;
      if (!repoInput) throw new UsageError('无法确定仓库：用 --repo owner/name 或设置 GITHUB_REPOSITORY');
      let repo: string;
      try {
        const { owner, name } = parseRepoSlug(repoInput);
        repo = `${owner}/${name}`;
      } catch (err) {
        throw new UsageError(err instanceof Error ? err.message : String(err));
      }
      const prNumber = resolvePrNumber(options.pr);
      if (!prNumber) throw new UsageError('无法确定 PR 编号：用 --pr <n> 或在 pull_request 事件中运行');
      const config = loadConfig();
      const failOn = resolveFailOn(config, options.failOn);

      const ctx = { token, repo };
      let diffText: string;
      try {
        diffText = await fetchPrDiff(ctx, prNumber);
      } catch (err) {
        throw new UsageError(`读取 PR #${prNumber} diff 失败：${err instanceof Error ? err.message : String(err)}`);
      }
      const outcome = await scanAndReview(parseDiff(diffText), config, Boolean(options.ai), Boolean(options.ai));
      const markdown = renderMarkdownReport(outcome.findings, {
        source: `PR #${prNumber}（${repo}）`,
        scannedFiles: outcome.scannedFiles,
        addedLines: outcome.addedLines,
        review: outcome.review
      });
      let result: 'created' | 'updated';
      try {
        result = await upsertStickyComment(ctx, prNumber, markdown);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (/HTTP 403/.test(msg)) {
          throw new UsageError(
            `发布评论失败：${msg}。常见原因：fork PR 的默认令牌为只读（可改用 PAT），或 workflow 缺少 pull-requests: write 权限`
          );
        }
        throw err;
      }
      console.log(`✅ 已${result === 'created' ? '创建' : '更新'} PR #${prNumber} 的粘性评论`);
      if (options.annotations) for (const line of toAnnotations(outcome.findings)) console.log(line);
      if (options.summary) console.log(`📄 Job Summary 内容已写入 ${writeSummaryFile(markdown)}`);
      process.exitCode = shouldFail(outcome.findings, failOn) ? 1 : 0;
    } catch (err) {
      if (err instanceof UsageError) {
        console.error(err.message);
        process.exitCode = 2;
        return;
      }
      throw err;
    }
  });

program.parseAsync();
