# 开始使用

[English](getting-started.md)

这份指南帮助你完成第一次真实的 Bearing alignment loop。

## 前置条件

- macOS，这是当前 Preview 的已验证路径。
- 当前 release candidate 选定的 Node.js 版本线。
- Codex 是已验证路径。Claude Code 是目标 surface，等待维护者验证。
- 一个你正在真实使用的 Git 仓库。
- 受支持的 Matt-native 本地 Markdown Map 与 Ticket 工作流，或愿意先建立它。

## 安装

```bash
npx @lagrangee/bearing
```

Global Kit maintenance 使用无参数 wizard。它提供 Install、Update、Repair 和 Global
Uninstall。安装 actions 会预览 managed targets，且不会配置 repository 或启动 Portal。
Global Uninstall 只移除 package-managed Global Kit targets，并保留 Project Catalog 和
repository state。

用户级 Bearing skill 在任何仓库中都保留显式 Bearing 或 Setup 入口。普通 repository work
只有在 Setup 写入该仓库的 managed Agent Surface pointer，且 package-owned 只读检查确认
manifest 为 Active 后，才会自动激活 Bearing。Fresh 与 Deactivated 仓库会继续普通工作，
不会调用 Bearing。

## 启用一个仓库

在目标仓库中，让 agent 执行：

```text
为这个项目设置 Bearing。把现有的 Map 和 Tickets 用作工作上下文，并引导我建立最低限度的治理基线。
```

如果直接使用 CLI，优先查看当前安装版本的 help：

```bash
bearing --help
bearing setup --repo . --surface agent-skills
```

## 建立最低基线

有用的基线刻意很小：

1. Project Summary：项目是什么、当前真实情况是什么、哪些不在边界内。
2. Roadmap：一个 active 的长期 outcome。
3. Milestone Gate：当前 focused decision boundary。
4. Effort：把现有 Map 或 Ticket 工作绑定到 Roadmap 与 Gate。

Bearing 应该在接受方向前询问你。如果 agent 静默编造战略 truth，请停下来要求它把 assumptions 作为 decisions 暴露出来。

## 完成第一次 alignment loop

带来一个真实请求：

```text
开始之前，请根据当前方向、已接受决策和活跃工作检查这件事。如果存在冲突，先让我看见冲突，再采取行动。
```

当 agent 做到以下之一时，loop 成功：

- 解释请求为什么符合当前方向和 active work；
- 在实现前识别实质冲突，并给出明确决策路径。

## 检查共享图景

```bash
bearing sync --repo .
bearing portal
```

Portal 是 read-oriented。用它检查 agent 正在使用的项目图景，而不是替代 Agent Surface 决策或原生 ticket 工作。
