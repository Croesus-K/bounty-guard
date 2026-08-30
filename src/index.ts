#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { parseDiff, unquoteGitPath, type DiffLine, type ParsedDiff, type ParsedFile } from './diff.js';
import { matchGlob } from './glob.js';
import { renderReport, shouldFail } from './report.js';
import { scanDiff } from './scanner.js';
import type { Severity } from './types.js';

const require = createRequire(import.meta.url);
const VERSION: string = require('../package.json').version;

const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low', 'info'];
const USAGE_HINT = '请指定扫描来源：--git（扫描未提交变更）或 --diff <file>（扫描 diff 文件）';

/** 以子进程运行 git（参数列表形式，不经 shell），非零退出时以 stderr 文本抛错 */
function runGit(args: string[], cwd: string): Promise<string> {
  return new Promise((resolve, reject) => {
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
      if (code === 0) resolve(stdout);
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

const program = new Command();

program
  .name('bounty-guard')
  .description('AI 代码安全审查助手 —— 规则引擎初筛 + LLM 复核，守住每一行 diff')
  .version(VERSION);

program
  .command('scan')
  .description('扫描代码变更中的安全问题（规则初筛；LLM 复核 Week 2 接入）')
  .option('--git', '扫描当前仓库的未提交变更')
  .option('--diff <file>', '从 unified diff 文件扫描')
  .option('--ai', '启用 LLM 复核（Week 2 上线；当前自动降级为纯规则模式）')
  .option('--fail-on <severity>', '门禁等级：high | medium | low | info（覆盖配置文件）')
  .action(async (options: { git?: boolean; diff?: string; ai?: boolean; failOn?: string }) => {
    if (!options.git && !options.diff) {
      console.error(USAGE_HINT);
      process.exitCode = 2;
      return;
    }
    if (options.git && options.diff) {
      console.error('两种扫描来源互斥，只能二选一');
      process.exitCode = 2;
      return;
    }
    const config = loadConfig();
    let failOn: Severity = config.failOn;
    if (options.failOn) {
      if (!(SEVERITIES as readonly string[]).includes(options.failOn)) {
        console.error(`--fail-on 取值无效：${options.failOn}（可选 ${SEVERITIES.join(' | ')}）`);
        process.exitCode = 2;
        return;
      }
      failOn = options.failOn as Severity;
    }
    if (options.ai) {
      console.log('ℹ️ LLM 复核将在 Week 2 上线，本次为纯规则模式\n');
    }

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
      console.error(`获取扫描来源失败：${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 2;
      return;
    }

    const findings = scanDiff(diff, { ignore: config.ignore });
    const scannable = diff.files.filter((f) => !f.isBinary && !matchGlob(f.path, config.ignore));
    const addedLines = scannable.reduce(
      (sum, f) => sum + f.hunks.reduce((n, h) => n + h.lines.filter((l) => l.type === 'add').length, 0),
      0
    );

    console.log(renderReport(findings, { source, scannedFiles: scannable.length, addedLines }));
    process.exitCode = shouldFail(findings, failOn) ? 1 : 0;
  });

program.parseAsync();
