# bounty-guard

[![CI](https://github.com/Croesus-K/bounty-guard/actions/workflows/ci.yml/badge.svg)](https://github.com/Croesus-K/bounty-guard/actions/workflows/ci.yml)

> AI 代码安全审查助手 —— 规则引擎初筛 + LLM 复核，守住每一行 diff。

这个项目始于一次真实的踩坑：我给自己的上一个项目修 XSS 时，被安全扫描器提示 `Math.random` 弱随机——提示是对的，但我更在意的是：为什么没有工具在我**提交那行危险代码的时候**就拦住我？市面上的扫描器要么重如全量 AST 分析，要么误报多到没人看。bounty-guard 只做一件事：**盯住每一行新增代码**，规则初筛、LLM 复核降噪，结果留在 PR 评论里。

上一个项目「赏金契约」守的是契约，这一个猎的是 bug：发现安全问题，就是赏金。

## 它怎么工作

```
CLI（npm 包）──────────┐
                      ├→ Diff 解析器 → 规则引擎初筛 → LLM 复核（可选）→ 报告
GitHub Action（薄壳）──┘
```

- **只审新增行**——成本控制的根基，也是"守住每一行 diff"的字面含义
- **LLM 永远只复核、不发明**——每条告警必须挂在真实代码行上、有规则命中佐证（防幻觉根基）
- **无 API Key 优雅降级**——纯规则模式完整可用，CI 里零成本跑
- **严重度只降不升**——提示词禁止上调 → 解析层丢弃上调建议 → 流水线双保险
- **粘性评论**——重复扫描只更新一条评论，不刷屏

## 真实验证数据

| 场景 | 结果 |
|---|---|
| 回滚「赏金契约」项目到修复 XSS 之前的版本（129 新增行） | 命中当年那个存储型 XSS（`index.html:524`），0 误报 |
| 靶场 PR（故意引入 3 个问题） | 3/3 精准命中，门禁红灯 |
| 误报治理 | 三轮安全工具误伤自己的案例，见 [docs/PLAN.md](docs/PLAN.md) 素材库 |

靶场实拍：[bounty-guard-playground PR #1](https://github.com/Croesus-K/bounty-guard-playground/pull/1)（demo GIF 待补）

<!-- TODO: 录制 demo GIF：PR 评论 + 门禁红灯 -->

## 快速开始

### CLI 扫描

```bash
# 扫描未提交变更（diff 驱动，只审新增行）
npx bounty-guard scan --git

# 扫描 diff 文件，发现高危即非零退出（CI 门禁）
npx bounty-guard scan --diff pr.diff --fail-on high

# 启用 LLM 复核（无 Key 自动降级为纯规则模式）
BOUNTY_GUARD_API_KEY=sk-xxx npx bounty-guard scan --git --ai
```

### GitHub Action

在目标仓库放一个 workflow：

```yaml
name: bounty-guard
on: [pull_request]
permissions:
  contents: read
  pull-requests: write
jobs:
  scan:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: Croesus-K/bounty-guard@main
        with:
          fail-on: high   # high | medium | low | info
          # ai: 'true'    # 启用 LLM 复核，需在 job 级配置 BOUNTY_GUARD_API_KEY
```

Action 会：读取 PR diff → 规则初筛 →（可选）LLM 复核 → 发布/更新一条粘性评论 → 输出 `::error file,line` 标注 → 按 `fail-on` 决定 Job 红绿灯。

### 配置 `.bountyrc.json`

```json
{
  "ignore": ["node_modules/**", "dist/**", "coverage/**"],
  "failOn": "high",
  "scanTests": false,
  "ai": {
    "enabled": true,
    "provider": "openai-compatible",
    "baseUrl": "https://api.deepseek.com/v1",
    "model": "deepseek-chat",
    "maxTokens": 500
  }
}
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `ignore` | `node_modules` / `dist` / `coverage` | **整体替换**默认值——自定义时建议把默认三项一并写上 |
| `failOn` | `high` | 门禁等级 high / medium / low / info，非法值在启动时报错（不静默放行） |
| `scanTests` | `false` | 是否扫描测试文件（tests/、\_\_tests\_\_/、\*.test.\*、\*.spec.\*） |
| `ai.enabled` | `false` | 启用 LLM 复核（也可用 `--ai` 临时开启） |
| `ai.provider` | `off` | `openai-compatible` / `mock` / `off`，非法值在启动时报错 |
| `ai.baseUrl` / `ai.model` | OpenAI 官方 / `gpt-4o-mini` | DeepSeek、GLM 等换 baseUrl 即可切换 |
| `ai.maxTokens` | `500` | 单条复核输出长度上限（成本闸） |

环境变量：`BOUNTY_GUARD_API_KEY`（或 `OPENAI_API_KEY`）、`BOUNTY_GUARD_BASE_URL`（或 `OPENAI_BASE_URL`）、`BOUNTY_GUARD_MODEL`。

## 内置规则（v0.1，8 条）

| 规则 | 严重度 | 说明 |
|---|---|---|
| `xss-inner-html` | 高危 | innerHTML 拼接不可信输入 |
| `weak-random-crypto` | 中危 | 加密/凭证场景使用 Math.random |
| `hardcoded-secret` | 高危 | 硬编码密钥 / API Key（豁免环境变量与占位符） |
| `dangerous-eval` | 高危 | 动态代码执行 |
| `weak-hash-password` | 高危 | MD5/SHA1 用于密码（上下文感知） |
| `sql-concat` | 高危 | SQL 字符串拼接 |
| `cmd-exec-concat` | 高危 | shell 命令拼接（规避正则同名方法误报） |
| `plain-http` | 低危 | 对外明文 http 请求（豁免 localhost） |

规则设计原则：**宁可漏报不可误报**，每条规则都配正反用例（93 项测试全绿）。

## 开发

```bash
npm ci
npm run dev -- scan --git   # 本地跑 CLI
npm test                     # 93 项测试
npm run lint                 # tsc --noEmit
```

每周五 dogfood：用自己的代码喂自己的扫描器。

## Roadmap

- [x] Week 1 规则引擎（diff 解析器 + 8 条种子规则）
- [x] Week 2 LLM 复核层（OpenAI 兼容 + 优雅降级）
- [x] Week 3 GitHub Action（粘性评论 + 门禁）
- [x] Week 4 发布（npm / v0.1.0 / 误报率数据）
- [ ] v0.2 AST 分析、多语言
- [ ] v0.3 自动修复 PR

## License

MIT
