# bounty-guard VS Code 扩展

在编辑器里以**诊断面板**实时呈现 bounty-guard 的扫描发现（问题面板 + 代码行内波浪线）。

## 功能

- 命令 `bounty-guard：扫描当前仓库变更`：对工作区未提交变更执行扫描
- 保存文件自动刷新（可关闭）
- 发现映射为诊断：高危=Error、中危=Warning、低危/提示=Information
- 悬停显示规则 id、问题描述与修复建议

## 前置条件

需要本地可用的 bounty-guard CLI（`settings.bounty-guard.cliPath` 可自定义路径）：

```bash
# 方式一：npm 发布后
npm i -g bounty-guard

# 方式二：开发态（本仓库内）
npm ci && npm run build && npm link
```

## 本地调试

1. 用 VS Code 打开 `ide/vscode/` 目录
2. 按 F5 启动「扩展开发宿主」
3. 在新窗口里打开任意项目 → 命令面板执行 `bounty-guard：扫描当前仓库变更`

## 打包发布

```bash
npm i -g @vscode/vsce
vsce package   # 产出 .vsix，可手动安装或发布到 Marketplace
```
