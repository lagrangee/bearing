# CLI reference

[English](cli.md)

大多数用户应从这里开始：

```bash
npx @lagrangee/bearing
```

Wizard 是公开的 Global Kit maintenance 路径。下面的显式命令面向 agents、smoke tests 和高级恢复。

## Help

```bash
bearing --help
bearing --version
```

## 维护用户级 Global Kit

在 interactive terminal 中无参数运行 `bearing`，然后选择 Install、Update、Repair 或 Global
Uninstall。取消不产生写入。Install、Update 与 Repair 使用下文所述的同一套完整 bundle
transaction。

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

普通 repository request 在加载 global skill 前，managed Agent Surface pointer 会运行
package-owned 只读 activation check：

```bash
bearing activation check --origin model-invoked --repo .
```

只有 Active manifest 的 versioned JSON disposition 是 `invoke-bearing`。Fresh 与
Deactivated 返回 `continue-without-bearing`；Invalid 或 Unsupported 返回
`stop-for-explicit-entry`。显式 Bearing 入口使用 `--origin explicit`，并根据同一次 lifecycle
inspection 进入普通 Bearing work、Setup、reactivation 或 recovery。该检查不读取 Catalog 或
planning projection，也不产生写入。

```bash
bearing setup --repo . --surface agent-skills \
  --provider-contract docs/agents/issue-tracker.md \
  --executor agent-skills:implement \
  --executor-assessment '<由 Agent Surface 生成的语义评估 JSON>'
```

`setup` 启用仓库，但不会把 package-owned contracts 或 skills 复制进仓库。
Fresh Setup 要求提供一个已确认、repository-relative 的 `matt-skills/v1` Provider Contract
locator。它会把 active manifest、Provider Configuration 以及仅针对所选 Agent Surfaces 的
managed pointers 作为一个 repository Apply Unit 写入；零 executor nomination 也是完整成功，
且不会安装 Generic fallback。Catalog registration 会在 repository validation 后独立执行并
单独报告 outcome。
`--executor` 可重复使用，并且只接受用户已点名 skill 的 portable、surface-qualified locator。
每个 nomination 必须带一个对应的 `--executor-assessment`，其中包含 Agent Surface 对
直接 required local references 的精确 locators、end-to-end execution/final writeback
的明确结论、精确 source excerpts，以及有 source 支持的 profile 内容。CLI 只对被点名
skill 的 contract 核对这些 references 与 excerpts，不从自由 prose 关键词推断 ownership。
Setup 不读取其他 executor skill；同时省略两个选项即可跳过 specialized registration。
重复 Setup 在 active configuration 完全匹配时返回 byte-preserving no-op。Material drift 必须
经 `--confirm-repair` 确认。Agent Surface 会为每个已有 specialized profile 提供当前
`--executor` 与结构化 `--executor-assessment` 进行重新验证；assessment 未变化时不产生写入，
也不会重问已接受的用户决定。skill 缺失或发生 material change 时，用户再显式选择 assessed
update、`--retain-executor <profile-key>`，或用 `--remove-executor <profile-key>` 与
`--confirm-repair` 移除 active registration。
Deactivated repository 绝不会被隐式启用；审阅保留的 surfaces、Provider Configuration 与
profiles 后，使用 `--confirm-reactivate` 在同一个 Apply Unit 中恢复 managed pointers 与
active manifest。
遇到不支持的较新 repository schema 时，`setup` 会拒绝写入并指向兼容的 Bearing 版本；
它不会把较新 state 重写成 schema 1。

经检查确认的 0.1.0 repository 必须执行显式 incompatible cutover；package version 变化本身
不会触发迁移。先用只读命令检查完整计划：

```bash
bearing setup --repo . --surface agent-skills \
  --provider-contract docs/agents/issue-tracker.md \
  --cutover-at 2026-07-26T12:34:56.000Z --plan
```

分别接受 upgrade direction 和完整计划后，使用同一组选择与 timestamp，并添加
`--accept-upgrade-direction --confirm-cutover --cutover-plan-token <confirmationToken>`。
该 token 把第二次 consent 绑定到已检查的 repository generation；source 或 write set
发生任何变化都必须重新生成计划并确认。Setup 会先创建并验证计划中列出的
`.bearing/backups/0.1.0-to-0.1.1-<timestamp>/` Recovery Bundle，再执行一个受 rollback
保护的转换事务。Bundle 保留旧 State、Effort sidecars、integration sources、managed
blocks、hashes、inventory 与 receipt；排除 cache、Matt-native work、unmanaged content
及 external Asset payloads。转换会把 Effort 移入 canonical `.bearing/state/efforts/`，
重建 disposable projections，并保持 native work 不变。repository 失败会恢复旧 integration
且保留已验证 bundle；后续 Catalog 失败会作为可恢复的独立 partial outcome 报告。

## Deactivate 或 purge 一个仓库

```bash
bearing deactivate --repo .
bearing purge --repo . --plan
bearing purge --repo . --confirm-purge --purge-plan-token <confirmationToken> \
  --recovery-export /safe/external/bearing-recovery
# 或明确接受不可恢复的删除：
bearing purge --repo . --confirm-purge --purge-plan-token <confirmationToken> \
  --accept-no-recovery-export
```

这些命令只应在已接受的 `bearing-setup` lifecycle 决策下执行。`deactivate` 把 manifest
改为 `status: deactivated`，并且只移除其中登记的 managed root pointers、disposable cache
与 Catalog registration；它保留 `.bearing/state`、Provider Configuration、profiles、backups、
原生 `.scratch` work 与 durable artifacts，作为 reactivation baseline。`purge` 首先以 no-write
plan 返回全部 `.bearing` paths（包括 State、profiles、Registry 与 backups）、每个可验证 managed
block 和匹配 Catalog entry 的精确 inventory；confirmation token 与该 generation 绑定。最终确认
必须选择并验证一个 `.bearing` 之外的 recovery export，或明确接受 canonical history 与本地
backups 将不可恢复。随后它只移除 reviewed `.bearing` namespace 和 managed root pointers，并保留
`.scratch`、source、docs、external Asset payloads 与 global kit。recognized older/newer schema、
unsafe owned target、ambiguous block 或 generation drift 都会 fail closed；Invalid repository 只有
在所有 target 都可安全识别时才能 Purge。任一 repository mutation 提交后，Catalog removal 会单独报告；
如果失败，可以安全重试。
Purge 会先原子 detach `.bearing`；如果后续递归 cleanup 失败，命令返回 blocked 并打印精确的
partial quarantine 路径。这份 residue 不是 backup，Bearing 也绝不会声称已恢复部分删除的 bytes。
两个 lifecycle commands 都会拒绝 linked 或其他 unsafe `.bearing` namespace。repository
configuration 存在时，`.bearing/manifest.json` 必须是受支持的 single-link regular lifecycle
manifest；缺失 authority 但保留 configuration、symlink、directory、multiply-linked file 或
special type 都会 fail closed。

## Sync

```bash
bearing sync --repo .
```

普通 Sync 会在 cache 下重建 deterministic diagnostics 与 Project Sitemap projection，并复用
由显式 Work Bindings 选择的最新 immutable provider observations。它不会发现 standalone work，
也不会扩张 Bearing Scope。

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

对 rename、forget、remove、relink 与需明确确认的 reset 等操作，使用 `bearing catalog --help` 和当前命令 help。Reset 会创建空的 SQLite Catalog；随后需再次运行 Setup 注册 repository。Catalog 操作会影响用户级 project registration；不要盲目执行。

## Global Uninstall 与 package-manager 边界

Wizard Global Uninstall 会移除 `$HOME/.bearing/kit/current`、canonical CLI shim，以及仅由
Bearing 管理的 Agent Surface pointers。它不读取或修改 Project Catalog、repository canonical
state、Provider Configuration、profiles、artifacts 或 native work。它不是 repository
Deactivation 或 repository-state removal；Bearing 也不提供 repository-scoped package-uninstall
命令。

npm-owned package installation 仍由 npm 管理。请另外使用安装它的 package manager 移除，
例如 `npm uninstall -g @lagrangee/bearing`。
