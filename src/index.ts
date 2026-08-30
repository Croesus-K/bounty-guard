#!/usr/bin/env node
import { createRequire } from 'node:module';
import { Command } from 'commander';
import { loadConfig } from './config.js';
import { loadProvider } from './llm/provider.js';

const require = createRequire(import.meta.url);
const VERSION: string = require('../package.json').version;

const program = new Command();

program
  .name('bounty-guard')
  .description('AI 代码安全审查助手 —— 规则引擎初筛 + LLM 复核，守住每一行 diff')
  .version(VERSION);

program
  .command('scan')
  .description('扫描代码变更中的安全问题（Week 1 实现 diff 解析与规则引擎）')
  .option('--git', '扫描当前仓库的未提交变更')
  .option('--diff <file>', '从 unified diff 文件扫描')
  .option('--ai', '启用 LLM 复核（未配置 API Key 时自动降级为纯规则模式）')
  .option('--fail-on <severity>', '门禁等级：high | medium | low | info')
  .action(() => {
    const config = loadConfig();
    console.log(`bounty-guard scan（Week 0 脚手架）`);
    console.log(`  Provider : ${loadProvider().name}`);
    console.log(`  failOn   : ${config.failOn}`);
    console.log(`  规则引擎与 diff 解析将在 Week 1 落地`);
  });

program.parseAsync();
