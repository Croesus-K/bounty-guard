# bounty-guard 四周 MVP 计划

> 目标：一个 GitHub Action + CLI 双形态的代码安全审查器。
> 规则引擎初筛 diff 里的安全问题 → LLM 复核降噪并生成修复建议 → 结果以 PR 评论呈现。

## 架构

```
CLI（npm 包）──────────┐
                      ├→ Diff 解析器 → 规则引擎初筛 → LLM 复核（可选）→ 报告输出
GitHub Action（薄壳）──┘
```

## Week 0：地基 ✅

- [x] TypeScript + Vitest + ESLint(tsc) + CI 脚手架
- [x] CLI 骨架（commander：scan 命令占位）
- [x] `.bountyrc.json` 配置加载与深合并（含损坏兜底）
- [x] `LLMProvider` 接口 + `MockProvider`（测试与降级模式）
- [x] 类型层写入防幻觉约束：LLM 只复核不发明
- [x] `.gitignore` 首日排除 `.env`（安全工具自己先管好钥匙）

验收：`npm run dev -- --help` 可跑、`npm test` 绿、CI 绿。

## Week 1：规则引擎（核心周）

- [ ] Diff 解析器：unified diff → 变更行 + 上下文（只审新增行 = 成本控制根基）
- [ ] 规则模型 `{ id, severity, detect, message, fixHint }`
- [ ] 种子规则 8-10 条（全部来自自己踩过的坑）：
  - [ ] `innerHTML` 拼接（XSS）
  - [ ] 加密场景 `Math.random`
  - [ ] 硬编码密钥 / API Key 模式
  - [ ] `eval` / `new Function`
  - [ ] 弱哈希（MD5/SHA1 用于密码）
  - [ ] SQL 字符串拼接
  - [ ] `child_process.exec` 拼接
  - [ ] 明文 http 请求
- [ ] 每条规则配正反用例
- [ ] `scan --git` / `scan --diff <file>` 终端报告 + `--fail-on` 退出码门禁

验收：对旧仓库出报告；**回滚赏金契约修复前版本实测能抓出当年 XSS**；开始记录命中/误报指标。

## Week 2：LLM 复核层

- [ ] OpenAI 兼容适配器（baseUrl/model 可配置）
- [ ] 结构化 JSON 输出 + 解析失败重试
- [ ] 流水线：规则候选 → LLM 核实（真问题/误报/降级严重度）→ 修复建议（带代码片段）
- [ ] 无 Key 自动降级；Token 上限与 diff 截断
- [ ] Mock 全量测试 + 真实 Key 端到端一次

验收：Mock 测试全绿；测试仓库 PR 全流程跑通一次。

## Week 3：GitHub Action 与 PR 评论

- [ ] 单条粘性评论（更新而非刷屏）
- [ ] `::error file,line` 标注 + Job Summary
- [ ] `--fail-on` 门禁接入 CI
- [ ] `action.yml` 薄壳封装 CLI；GITHUB_TOKEN 走 secrets
- [ ] 靶场仓库 + 含 3 个安全问题的演示 PR

验收：Action 评论精准命中；README 录制 demo GIF。

## Week 4：发布与叙事

- [ ] README 完善（含误报率数据、靶场 demo）
- [ ] npm 发布 + v0.1.0 tag
- [ ] 用热门开源项目公开 PR 离线试扫，调规则、攒 5 个真实案例
- [ ] 掘金 / HelloGitHub 发文：《我给自己造了个 AI 代码安全审查器》

## 防跑偏三条

1. v0.1 不做：AST 分析（v0.2）、多语言（先做扎实 JS/TS）、自动修复 PR（v0.3）
2. 每周五 dogfood：用自己的代码喂自己的扫描器
3. 误报率是生死线：宁可漏报不可误报，规则上线前先在知名开源库历史上验证
