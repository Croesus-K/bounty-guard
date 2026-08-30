# Dogfood XSS 回滚验证 diff 简报

## 来源信息

- **旧仓库路径**：作者本机的「赏金契约」项目目录（路径已脱敏；扫描过程仅执行只读 git 命令）
- **仓库状态**：完整 git 历史（非浅克隆，`rev-parse --is-shallow-repository` = false），仅执行只读命令（git log / show / diff / rev-parse），未做任何修改
- **漏洞文件相对路径**：`index.html`（由提交 `2b264af` 从 `Dark Bounty Killer Mission Contract Management System.html` 重命名而来）
- **漏洞形态**：存储型 XSS —— `renderTasks()` 中用模板字符串把用户输入（`task.name` / `task.type` / `task.reward` / `task.description` / `task.id` 等）**未经转义**直接拼进 `taskItem.innerHTML`

## 修复提交

- **hash**：`890e9892f066e5aa0b804807827a1af4637c2291`（短 hash `890e989`）
- **标题**：`feat: 同步完整功能版本并修复安全与性能问题`
- **提交说明关键句**：「修复存储型 XSS：所有用户输入经 escapeHtml 转义后再渲染」
- **变更统计**：`index.html | 363 insertions(+), 129 deletions(-)`
- **父提交**：`9e05a19d0b33ee1845c312fd4c75245ef7b75b42`（Update README.md），存在且可用，故反向 diff 用 `git diff 890e989 890e989^` 生成

## 引入漏洞的提交

- **hash**：`17f918cfa312a02b30e7570607aaf962c7390632`（短 hash `17f918c`）
- **标题**：`feat: 新增主页面HTML文件`（2026-05-04，项目首次添加核心前端文件）
- 该提交即包含未转义的 `taskItem.innerHTML = \`...\${task.name}...\`` 拼接，此形态一路保留至修复前的 `9e05a19`（`git show -S innerHTML` 定位确认）

## 产出 diff

- **文件**：`tests/fixtures/dogfood-xss.diff`（`git diff 890e989 890e989^` 的原始完整输出，共 634 行，未加工改写）
- **方向说明**：反向 diff（F → F^），因此 `git show 890e989` 中被删除的漏洞代码在本文中为 `+` 行，新增的修复代码为 `-` 行

## 漏洞代码位置与片段摘录

### 在 diff 文件（dogfood-xss.diff）中的行范围

- 核心漏洞块：**第 499–527 行**（均为 `+` 行），`renderTasks()` 函数
- 另有相关 `+` 行：第 562 行（`alert(...${task.reward})` 上下文）

### 片段摘录（diff 中的 `+` 行，即修复前的漏洞代码）

```diff
+            taskList.innerHTML = '';
+            tasks.forEach(task => {
+                const timeStr = calculateCountdown(task.deadline);
+                const isExpired = timeStr.includes('逾期');
+                const taskItem = document.createElement('div');
+                taskItem.className = 'task-item';
+
+                taskItem.innerHTML = `
+                    <div class="task-header">
+                        <span class="task-name">${task.name}</span>
+                        <span class="task-type">${task.type}</span>
+                    </div>
+                    <div class="task-info">
+                        ...
+                        <p>💰 悬赏奖励：${task.reward}</p>
+                        <p>📝 契约详情：${task.description || '无'}</p>
+                        ...
+                    </div>
+                    <div class="task-btns">
+                        <button class="btn btn-warning edit-btn" data-id="${task.id}">编辑</button>
+                        ...
+                    </div>
+                `;
+                taskList.appendChild(taskItem);
```

漏洞代码在修复前 `index.html` 中的实际行号：`taskItem.innerHTML = ...` 位于第 524 行（`git show 9e05a19:index.html`）。

## 判定"890e989 是修复提交"的依据

1. **提交自述**：commit message 明确写「修复存储型 XSS：所有用户输入经 escapeHtml 转义后再渲染」，且该提交是全部 12 个提交中唯一 grep 命中 XSS/安全关键词的提交。
2. **`-S innerHTML` 证据链**：`git log --all --oneline -S innerHTML` 仅命中 3 个提交——`17f918c`（引入漏洞拼接）、`890e989`（删除漏洞拼接、新增 escapeHtml）、`0f8eac3`（后续模块化重构）。`890e989` 的 diff 中，删除行（`-`）是 `${task.name}` 等裸插值，新增行（`+`）是 `${escapeHtml(task.name)}` 等转义插值，并新增了 `function escapeHtml(value) {...}` 定义。
3. **时间线完整**：漏洞形态自首个 HTML 提交（`17f918c`）起存在于 `index.html`，直到 `890e989` 才被替换为转义版本；`890e989` 之后不再有未转义拼接渲染用户输入的路径。
4. **反向 diff 方向校验（已通过）**：对 `dogfood-xss.diff` 检查确认——`git show 890e989` 中被删除的漏洞行（如 `taskItem.innerHTML = \`...\${task.name}...\``）在反向 diff 中变成了 `+` 行（diff 文件第 510–527 行），而修复用的 `escapeHtml` 全部位于 `-` 行（如第 144、255、256 行），方向正确，不存在把修复代码放进 `+` 行的情况。

## 备注

- `F^` 存在（`9e05a19`），因此未使用 `F~1` 回退方案。
- diff 末尾还包含旧版 `localStorage` 导入无校验等上下文代码，同属该次"安全与性能"修复范围，按任务要求保留完整原始输出、未做删减。
