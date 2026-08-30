# bounty-guard 🛡️

> AI 代码安全审查助手 —— 规则引擎初筛 + LLM 复核，守住每一行 diff。

第一个项目「赏金契约」守的是契约，这一个猎的是 bug：发现安全问题，就是赏金。

**状态：Week 0 脚手架**（开发计划见 [docs/PLAN.md](./docs/PLAN.md)）

## 设计原则

1. **LLM 只复核、不发明**：每条告警必须落到真实代码行并有规则命中佐证，杜绝幻觉
2. **无 Key 优雅降级**：未配置 API Key 时自动退化为纯规则模式，CI 零成本可跑
3. **OpenAI 兼容适配层**：DeepSeek / GLM / OpenAI 换环境变量即可切换

## 开发

```bash
npm install
npm run dev -- --help   # CLI 冒烟
npm run lint            # 类型检查
npm test                # 单元测试
```

## 结构

```
src/
├── index.ts        # CLI 入口（commander）
├── config.ts       # .bountyrc.json 配置加载与合并
├── types.ts        # Finding / LLM 审查类型（防幻觉约束写在这里）
└── llm/
    ├── provider.ts # Provider 工厂（Week 2 扩展 OpenAI 兼容实现）
    └── mock.ts     # 确定性 Mock（测试与降级模式）
```

## License

MIT
