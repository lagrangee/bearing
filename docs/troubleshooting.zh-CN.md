# 故障排查

[English](troubleshooting.md)

出问题时，先保护 source truth。

## 安装目标冲突

运行预期 exact package candidate 自带的 `bearing install`。Bearing 会拒绝冲突文件和 symbolic
links，而不是静默覆盖。

## Update 中断或 bundle 损坏

重新运行同一个 verified exact candidate 的 `bearing install` 入口。Bearing 会先 stage 并验证完整的
CLI 与 single-skill bundle，再执行切换。切换失败会恢复上一份完整 bundle，
且不会触碰 repository state。不要单独修复某一个 CLI 或 skill 文件，那会拆分版本匹配的 bundle。

如果 installed `kit/current/package.json` 缺失、malformed 或 unsafe，install 会返回 `Current Kit
Unverifiable`、报告这个 exact target，并且不改变任何 bytes。若 Human 接受恢复，运行
`bearing uninstall`，再从预期 exact candidate 执行 verified Fresh Install。不要覆盖不可信的
current target，也不要把它分类为 repair input。

## 缺少 skill

先确认目标 complete Skill Directory 已存在于 `~/.agents/skills`、`~/.claude/skills` 或
`~/.workbuddy/skills`，再运行 `bearing install` 并在 keyboard checklist 中选择它。
Non-interactive caller 可以传入对应的 resolved `--surface` 值。Bearing 不创建缺失的 surface
directory。User-created copy 属于 unsupported unmanaged integration，不提供 install 或 refresh
fallback。

## 裸命令不可发现

Canonical absolute locator 仍是 `$HOME/.bearing/bin/bearing`。若要在 current session 使用裸
`bearing`，运行：

```bash
export PATH="$HOME/.bearing/bin:$PATH"
```

若要让未来 terminals 也生效，把同一行加入相应 shell startup profile。Bearing 不会写入、追加或
source profiles。

## 缺少 work-management adapter

首个 Preview 要求受支持的 Matt-native 本地 Markdown Map 与 Ticket 工作流。请先创建或恢复这份 work scope，再检查 current work。

## Project diagnostics

运行：

```bash
bearing inspect diagnostics --repo .
```

阅读命令打印的 typed diagnostic rows。Project Read Model 是 disposable；malformed source files 需要由对应 owner 修正。

## Portal 无法打开

运行：

```bash
bearing portal
```

使用命令打印的 loopback URL。如果端口被占用，根据 CLI help 或支持的环境变量设置其他端口。

## Unsupported schema

Bearing 会 fail closed 并报告不兼容的 repository。请安装 documented readable range 包含该
schema 的 Bearing 版本。旧 runtime 永远不会 downgrade、重写或删除较新的 state。若已经执行
release-specific state upgrade，rollback 必须使用该 release 的 verified backup；仅 downgrade
package 不等于 state rollback。

任何比可信 current Kit 更旧的 exact package candidate 都会无写入地被阻止。基础 installer 不提供
override 或 compatibility scan。

## Deactivate、移除 repository state 与 uninstall

这些是不同操作：

- Repository Configuration deactivation 修改一个仓库；
- external platform removal 在显式审阅后删除 repository-owned Bearing state；
- package uninstall 只移除 package-manager-owned installation。

Repository deactivation 使用 sealed Repository Configuration 路径：

```bash
bearing configure plan --intent deactivate --repo .
bearing configure apply --intent deactivate --repo . --plan-token <sealedPlanToken>
```

Deactivation 保留 canonical state、Provider Configuration、profiles、artifacts 与 native work。
它移除 managed pointers 与 disposable cache。Catalog unregister 在之后运行，并单独报告失败。
Unsafe `.bearing` namespace 或 manifest 会在任何写入前 fail closed。

Bearing 不提供通用 built-in repository migration、compatibility fallback、Purge、cutover、
recovery export 或 quarantine path。列明支持的旧 Preview source 可以返回
`repository-update-required`；Agent follow package-owned guide，展示完整 semantic effect，并等待
Human 确认。Agent 验证 canonical state，只应用 guide 中已接受的 write scope，然后重建
disposable Project Read Model；不要编辑 SQLite rows。较新的 repository 返回
`kit-update-required` 并保持 repository bytes 不变。未知或损坏 state 保持 Unsupported 且不变。
如果 Human 另行选择 repository removal，先检查 exact paths 并取得显式授权。不要用
`catalog unregister` 代替 repository removal。

显式 `bearing uninstall` 只移除 Global Kit bundle、CLI shim 与 Bearing-managed Agent Surface
pointers。它保留 Project Catalog 与 repository state。Repository Deactivation 与
repository-state removal 是不同的 Agent-owned lifecycle operations。

Package uninstall 仍由 package manager 负责，例如 global npm installation 使用
`npm uninstall -g @lagrangee/bearing`。它不会移除 Project Catalog 或 repository state。不要用
`bearing catalog unregister` 代替 repository lifecycle；unregister 只改变 registration。
