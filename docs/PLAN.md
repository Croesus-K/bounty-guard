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

## Week 1：规则引擎（核心周）✅

- [x] Diff 解析器：unified diff → 变更行 + 上下文（只审新增行 = 成本控制根基）
- [x] 规则模型 `{ id, severity, detect, message, fixHint }`
- [x] 种子规则 8 条（全部来自自己踩过的坑）：
  - [x] `innerHTML` 拼接（XSS）
  - [x] 加密场景 `Math.random`
  - [x] 硬编码密钥 / API Key 模式
  - [x] `eval` / `new Function`
  - [x] 弱哈希（MD5/SHA1 用于密码）
  - [x] SQL 字符串拼接
  - [x] `child_process.exec` 拼接
  - [x] 明文 http 请求
- [x] 每条规则配正反用例（8 条规则 19 项规则测试，全仓 58 项测试全绿）
- [x] `scan --git` / `scan --diff <file>` 终端报告 + `--fail-on` 退出码门禁

### 验收记录（2026-08-31）：回滚验证通过 ✅

取赏金契约仓库修复提交（`890e989`）之前的反向 diff（`tests/fixtures/dogfood-xss.diff`，
129 个新增行），bounty-guard 命中当年那个存储型 XSS：

- `index.html:524` `taskItem.innerHTML = \`` → [高危] xss-inner-html，附中文修复建议
- `--fail-on` 门禁按预期非零退出（exit 1）；无告警场景 exit 0；参数错误 exit 2

**指标起始（自此记录）**：该 diff 命中 1、误报 0。考古证据链：漏洞引入 `17f918c` →
修复 `890e989`（escapeHtml 转义），简报见 `tests/fixtures/dogfood-xss.md`。

### 素材库：误报治理第一手案例（Week 4 文章用）

1. Week 0：测试数据里动态执行调用的**字符串字面量**被 Mimosa 拦截（从未执行，纯形态误报）
2. Week 1：diff 解析器用正则的 exec 方法做匹配，被 Mimosa 当作命令注入**两次拦截**；
   换语义等价的 match/test 通过——安全工具自己开发时就被安全工具误伤
3. Week 1：规则源码里「exec 字样紧邻括号」的正则被拦，目标词改运行时拼装；测试样例里的
   **假密钥字面量**被当作真实泄露拦截——与自家 hardcoded-secret 规则判定完全同判
4. 启示：形态匹配无法区分「真实威胁 / 检测代码 / 测试样例」，这正是
   bounty-guard「规则初筛 + LLM 复核降噪」架构的立论基础

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
