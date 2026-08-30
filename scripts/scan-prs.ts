/**
 * 开源 PR 离线试扫：给定一批 PR（owner/repo#编号），并发拉取 diff 跑规则引擎，
 * 输出命中明细与汇总——用于采集误报率数据（Week 4 指标）。
 * 用法：GITHUB_TOKEN=xxx npx tsx scripts/scan-prs.ts owner/repo#123 [owner/repo#456 ...]
 */
import { parseDiff } from '../src/diff.js';
import { fetchPrDiff, parseRepoSlug, type GithubContext } from '../src/github.js';
import { scanDiff } from '../src/scanner.js';

const args = process.argv.slice(2);
if (args.length === 0) {
  console.error('用法：npx tsx scripts/scan-prs.ts owner/repo#123 [owner/repo#456 ...]');
  process.exit(2);
}
const token = process.env.GITHUB_TOKEN ?? process.env.BOUNTY_GUARD_TOKEN;
if (!token) {
  console.error('缺少 GITHUB_TOKEN 环境变量');
  process.exit(2);
}

const IGNORE = [
  'node_modules/**',
  'dist/**',
  'coverage/**',
  '**/*.lock',
  '**/package-lock.json',
  '**/pnpm-lock.yaml',
  '**/yarn.lock'
];

interface Row {
  pr: string;
  files: number;
  addedLines: number;
  findings: string[];
}

try {
  const rows: Row[] = await Promise.all(
    args.map(async (arg) => {
      const parsed = arg.match(/^(.+)#(\d+)$/);
      if (!parsed) throw new Error(`无法解析 PR 标识：${arg}`);
      const [, repoInput, pr] = parsed;
      const { owner, name } = parseRepoSlug(repoInput);
      const repo = `${owner}/${name}`;
      const ctx: GithubContext = { token, repo };
      const diff = parseDiff(await fetchPrDiff(ctx, Number(pr)));
      const findings = scanDiff(diff, { ignore: IGNORE });
      const addedLines = diff.files.reduce(
        (n, f) => n + f.hunks.reduce((k, h) => k + h.lines.filter((l) => l.type === 'add').length, 0),
        0
      );
      console.error(`已扫 ${repo}#${pr}：${findings.length} 条命中`);
      return {
        pr: `${repo}#${pr}`,
        files: diff.files.filter((f) => !f.isBinary).length,
        addedLines,
        findings: findings.map((f) => `${f.severity}/${f.ruleId}/${f.file}:${f.line}`)
      };
    })
  );

  const totalFindings = rows.reduce((n, r) => n + r.findings.length, 0);
  const totalAdded = rows.reduce((n, r) => n + r.addedLines, 0);
  console.log(
    JSON.stringify({ scanned: rows.length, totalAddedLines: totalAdded, totalFindings, rows }, null, 2)
  );
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(2);
}
