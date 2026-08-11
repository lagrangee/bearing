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
bearing install
bearing install --surface agent-skills
bearing install --surface agent-skills --surface claude
```

不带 `--surface` 时，该命令只安装完整 bundle 与 canonical CLI。这是供自行管理 Skill Directory
integration 的 Agent 使用的 non-interactive seam。提供一个或多个 `--surface` 时，Bearing 也会管理
选定的 known Agent Surface links。

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

## 配置一个仓库

Repository Configuration 由 Agent 主导。裸 `bearing configure` 会转交给公开 Bearing skill。
Deterministic CLI 只提供 machine facts、sealed plan 与 exact apply：

```bash
bearing configure inspect --repo .
bearing configure plan --intent activate --repo . --surface agent-skills \
  --provider-contract docs/agents/issue-tracker.md --executor-mode skip
bearing configure apply --intent activate --repo . --surface agent-skills \
  --provider-contract docs/agents/issue-tracker.md --executor-mode skip \
  --plan-token <sealedPlanToken>
```

Inspect 不写入，也不选择 preference 或 product outcome。Plan 只有在所有 material choice 已解决时
才返回 exact targets、preconditions、preservation effects 与绑定当前 repository generation 的
token。Apply 会重新计算 plan，拒绝 stale 或不匹配 token，并且只修改已审阅的 Bearing machine
configuration 与 managed pointers。Fresh Configuration 创建 disposable Project Read Model，但不做
provider acquisition，也不创建 substantive planning objects。Catalog upsert 在 repository validation
后独立执行并单独报告失败。Portal handoff 只报告 compatible URL、incompatible Host restart 指令，
或 foreground start 指令；它绝不启动 Portal。

只有用户点名 capable executor 后，才使用可重复的 `--executor` 和配对的
`--executor-assessment`。只有用户明确跳过后，才使用 `--executor-mode skip`。已有 profile 可用
`--retain-executor` 保留，或用 `--remove-executor` 移除。Bearing 不安装 executor，也不从自由 prose
推断 executor。

Deactivation 使用同一个 sealed lifecycle：

```bash
bearing configure plan --intent deactivate --repo .
bearing configure apply --intent deactivate --repo . --plan-token <sealedPlanToken>
```

Deactivation 移除 managed pointer 与 disposable cache。它保留 canonical state、Provider
Configuration、profiles、artifacts 与 native work。Catalog unregister 是后续独立报告的 stage。
Unsupported Preview state 是 removal-required。Bearing 不提供 built-in migration、cutover、silent
repair 或 repository Purge。Repository removal 是外部、显式授权、由 Agent 审阅的 platform
operation；完成后再运行 Fresh Configuration。

Managed pointer 提供 contextual nomination guidance。显式 Bearing request、可靠 continuation，以及
有实质 planning 或 governance relevance 的工作可以 nominate Bearing。Working directory、generic
roadmap words、repository-independent conversation 与 ordinary code work 不会 nominate Bearing。
Functional operations 会在 cache creation、provider I/O 或 mutation 前验证 Active lifecycle。

## Project Read Model operations

```bash
bearing cache rebuild --repo .
bearing provider verify --all --repo .
bearing inspect project --repo .
```

Cache rebuild 只创建 disposable SQLite Project Read Model。Provider verification 是针对当前
Work Bindings 的显式 cost-bearing operation。Inspect 返回 typed committed rows。这些命令不会
发现 standalone work，也不会扩张 Bearing Scope。

## Inspect

```bash
bearing inspect project --repo .
bearing inspect effort:<effort-id> --repo .
bearing inspect --native <native-reference> --repo .
bearing inspect diagnostics --repo .
```

Inspect 从 committed Project Read Model rows 返回 versioned typed envelope。这四种形式分别读取
bounded Project Context、一个 stable planning reference、一个 exact native reference 或 typed
diagnostics。

## Portal

```bash
bearing portal
```

Portal 前台运行并打印 loopback URL。安装版本支持时，可用 `BEARING_PORT` 覆盖默认端口。

## Catalog

完整 Catalog CLI 只有 inspect、rename、unregister、relink 与需明确确认的 reset；使用 `bearing catalog --help` 查看语法。Unregister 必须且只能使用一个 Entry ID 或 repository-root selector。Relink 只替换 registration locator，绝不移动 repository files。Reset 会创建空的 SQLite Catalog；随后需再次运行 Repository Configuration 注册 repository。Catalog 操作会影响用户级 project registration；不要盲目执行。

## Global Uninstall 与 package-manager 边界

Wizard Global Uninstall 会移除 `$HOME/.bearing/kit/current`、canonical CLI shim，以及仅由
Bearing 管理的 Agent Surface pointers。它不读取或修改 Project Catalog、repository canonical
state、Provider Configuration、profiles、artifacts 或 native work。它不是 repository
Deactivation 或 repository-state removal；Bearing 也不提供 repository-scoped package-uninstall
命令。

npm-owned package installation 仍由 npm 管理。请另外使用安装它的 package manager 移除，
例如 `npm uninstall -g @lagrangee/bearing`。
