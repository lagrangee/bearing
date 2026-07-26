# CLI reference

[English](cli.md)

大多数用户应从这里开始：

```bash
npx @lagrangee/bearing
```

Wizard 是公开安装路径。下面的显式命令面向 agents、smoke tests 和高级恢复。

## Help

```bash
bearing --help
bearing --version
```

## 安装用户级 kit

```bash
bearing install --surface agent-skills
bearing install --surface agent-skills --surface claude
```

Install、update 与 repair 会先 stage 一份完整的 package-owned bundle，再切换
`$HOME/.bearing/kit/current`。所选 Agent Surface links 与 canonical CLI 都通过这一份 bundle
解析。切换失败会恢复上一份完整 bundle，且绝不会修改 repository state。重新运行 exact
candidate 也会修复缺失或 malformed 的 installed `kit/current/package.json`；有效的 installed
metadata 仍然约束 downgrade checks。

显式 downgrade 是高级恢复操作：

```bash
npx @lagrangee/bearing@<version> install --surface agent-skills --confirm-downgrade
```

Downgrade 必须带确认 flag，并会只读检查每个 Catalog repository 的兼容性。Patch 与 prerelease
按 SemVer 排序。只支持同一 minor 内 downgrade，或退回紧邻的上一个 minor；跨 major 和跳过
多个 minor 会被拒绝。它不等于 repository-state rollback。若 state 已升级，必须先恢复该
release 对应的 verified backup；否则 downgrade 会 fail closed。

## 启用一个仓库

```bash
bearing setup --repo . --surface agent-skills \
  --provider-contract docs/agents/issue-tracker.md
```

`setup` 启用仓库，但不会把 global protocol 或 skills 复制进仓库。
Fresh Setup 要求提供一个已确认、repository-relative 的 `matt-skills/v1` Provider Contract
locator。它会把 active manifest、Provider Configuration 以及仅针对所选 Agent Surfaces 的
managed pointers 作为一个 repository Apply Unit 写入；零 executor nomination 也是完整成功，
且不会安装 Generic fallback。Catalog registration 会在 repository validation 后独立执行并
单独报告 outcome。
遇到不支持的较新 repository schema 时，`setup` 会拒绝写入并指向兼容的 Bearing 版本；
它不会把较新 state 重写成 schema 1。

## Deactivate 或 purge 一个仓库

```bash
bearing deactivate --repo .
bearing purge --repo . --confirm-purge
```

这些命令只应在已接受的 `bearing-setup` lifecycle 决策下执行。`deactivate` 移除 manifest
和 managed root pointers，但保留 `.bearing/state`、profiles、cache、原生 `.scratch` work
与 durable artifacts。`purge` 经确认后只移除仓库的 `.bearing` namespace 和 managed root
pointers；它保留 `.scratch`、source、docs 与其他 native artifacts。任一 repository mutation
提交后，Catalog removal 会单独报告；如果失败，可以安全重试。
Purge 会先原子 detach `.bearing`；如果后续递归 cleanup 失败，命令返回 blocked 并打印精确的
partial quarantine 路径。这份 residue 不是 backup，Bearing 也绝不会声称已恢复部分删除的 bytes。
两个 lifecycle commands 都会拒绝 linked 或其他 unsafe `.bearing` namespace。在读取或修改
`.bearing/manifest.json` 前，它还必须是 missing 或 single-link regular file；symlink、directory、
multiply-linked file 或 special type 都会 fail closed。

## Sync

```bash
bearing sync --repo .
```

Sync 会在 cache 下重建 deterministic diagnostics 与 Project Sitemap projection。

## Inspect

```bash
bearing inspect roadmap <roadmap-id> --repo .
bearing inspect gate <gate-id> --repo .
bearing inspect effort <effort-id> --repo .
```

Inspect 返回所选对象的 planning context closure。

## Portal

```bash
bearing portal
```

Portal 前台运行并打印 loopback URL。安装版本支持时，可用 `BEARING_PORT` 覆盖默认端口。

## Catalog

对 rename、forget、remove、relink、repair、reset 等操作，使用 `bearing catalog --help` 和当前命令 help。Catalog 操作会影响用户级 project registration；不要盲目执行。

## Package uninstall 边界

Bearing 不提供 repository-scoped package-uninstall 命令。npm-owned package installation 应由
安装它的 package manager 移除，例如 `npm uninstall -g @lagrangee/bearing`。移除 package
不会 deactivate 或 purge 仓库，也不会删除 Project Catalog data。
