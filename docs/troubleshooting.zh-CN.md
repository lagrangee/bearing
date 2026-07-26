# 故障排查

[English](troubleshooting.md)

出问题时，先保护 source truth。

## 安装目标冲突

重新运行 install wizard 并阅读 target preview。Bearing 会拒绝冲突文件和 symbolic links，而不是静默覆盖。

## Update 中断或 bundle 损坏

重新运行同一个显式 `npx @lagrangee/bearing` lifecycle 入口。Bearing 会先 stage 并验证完整的
CLI 与 single-skill bundle，再执行切换。切换失败会恢复上一份完整 bundle，
且不会触碰 repository state。不要单独修复某一个 CLI 或 skill 文件，那会拆分版本匹配的 bundle。

如果 installed `kit/current/package.json` 缺失或 malformed，请重新运行预期的 exact candidate。
Bearing 会把不可信 installed metadata 当作 repair input，先 stage candidate，再替换完整 bundle。
有效的 installed manifest 仍然约束 downgrade ordering 与 confirmation，repository schema
compatibility 也始终保持 fail closed。

## 缺少 skill

针对目标 Agent Surface 重新运行 installer。如果你使用多个 surfaces，通过 wizard 或高级命令显式安装两者。

## 缺少 work-management adapter

首个 Preview 要求受支持的 Matt-native 本地 Markdown Map 与 Ticket 工作流。先创建或恢复这份 work scope，再期待 Bearing 根据 active work 做 alignment。

## Sync diagnostics

运行：

```bash
bearing sync --repo .
```

阅读命令打印的 report path。Cache diagnostics 是 disposable；malformed source files 需要由对应 owner 修正。

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

## 显式 downgrade

只有在阅读目标 release 的 compatibility 与 rollback 说明后，才使用精确版本和确认 flag：

```bash
npx @lagrangee/bearing@<version> install --surface agent-skills --confirm-downgrade
```

命令会扫描每个 Catalog repository，且仅当所有 repository schema 都可读时才切换完整 bundle。
SemVer 排序包含 prerelease。确认后只允许同一 minor 内 downgrade，或退回紧邻的上一个 minor；
跨 major 和跨多个 minor downgrade 会被拒绝。不支持自动 state rollback。

## Deactivate、purge 与 uninstall

这些是不同操作：

- repository deactivation 修改一个仓库；
- purge 删除 repository-owned Bearing state；
- package uninstall 只移除 package-manager-owned installation。

Repository deactivation 与 purge 有独立、可执行的路径：

```bash
bearing deactivate --repo .
bearing purge --repo . --confirm-purge
```

`deactivate` 保留 repository state 与 native work。`purge` 只移除精确的 `.bearing` namespace
和 managed root blocks；它保留 `.scratch`、source、docs 与 durable native artifacts。两者都会
在 repository mutation 后移除对应 Catalog registration，并单独报告 Catalog failure。

两个命令都会拒绝 `.bearing` symbolic link 或 unsafe namespace shape。只有当
`.bearing/manifest.json` 为 missing 或 single-link regular file 时才会读取或修改它；manifest
symlink、directory、multiply-linked file 或 special type 都会 fail closed，因此 lifecycle
operation 绝不会沿该 entry 修改 external state。

Purge 在原子 detach `.bearing` 时提交。如果后续递归 cleanup 失败，命令会返回 blocked 并报告
精确的 partial quarantine 路径。Repository 保持已 purge，Catalog removal 仍会尝试执行，并且
这份 quarantine 明确不是可恢复 backup。只能检查并移除命令报告的精确路径；不要把部分删除的
bytes rename 回 `.bearing`。

Package uninstall 仍由 package manager 负责，例如 global npm installation 使用
`npm uninstall -g @lagrangee/bearing`。它不会移除 Project Catalog 或 repository state。不要用
`bearing catalog forget` 代替 repository lifecycle；forget 只改变 registration。
