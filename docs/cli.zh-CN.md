# CLI reference

[English](cli.md)

大多数用户应让 Agent 先验证一个 exact published candidate，再运行它自带的 installer：

```bash
npx --yes @lagrangee/bearing@<resolved-version> install
```

Package candidate 与 installed CLI 提供相同的 explicit 基础 primitives。裸 `bearing` 只显示简洁
help；它不会安装、配置 repository 或启动 Portal。

## Help

```bash
bearing --help
bearing --version
```

## 维护用户级 Global Kit

```bash
bearing install
bearing install --surface agent-skills
bearing install --surface agent-skills --surface claude
bearing uninstall
```

不带 `--surface` 时，该命令只安装完整 bundle 与 canonical CLI。这是供自行管理 Skill Directory
integration 的 Agent 使用的 non-interactive seam。提供一个或多个 `--surface` 时，Bearing 也会管理
选定的 known Agent Surface links。

Install 会先 stage 并验证一份完整的 package-owned bundle，再切换
`$HOME/.bearing/kit/current`。所选 Agent Surface links 与 canonical CLI 都通过这一份 bundle
解析。切换失败会恢复上一份完整 bundle，且绝不会修改 repository state。任何 older exact
candidate 都会无写入地被阻止，也不存在 override。若当前 `kit/current/package.json` 缺失、
malformed 或 unsafe，结果为 `Current Kit Unverifiable`；install 不会覆盖它。恢复需要另行授权
`bearing uninstall`，然后从预期的 exact candidate 执行 verified Fresh Install。

每次成功安装后，Bearing 都会直接打印：

```bash
export PATH="$HOME/.bearing/bin:$PATH"
```

执行这条 export 只影响 current session。若希望未来 terminal 也能发现裸 `bearing`，可把同一行
加入相应 shell startup profile。CLI 不会写入或 source 任何 profile。

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
一个列明的旧 Preview source 可以返回 Repository Update Required，并提供 package-owned、
Human-confirmed semantic update guide。Agent 验证 canonical state，只在 guide 要求语义变化时
更新它，并重建而非迁移 disposable Project Read Model。较新的 state 返回 Kit Update Required；
未知或损坏的 state 保持 Unsupported 且不变。Bearing
不提供通用 built-in migration、compatibility fallback、cutover、silent repair 或 repository
Purge。Repository removal 是独立、显式授权、由 Agent 审阅的 platform operation。

Managed pointer 提供 contextual nomination guidance。显式 Bearing request、可靠的直接
continuation，以及合理的实质 planning 或 governance relevance 可以 nominate Bearing。Working
directory、generic roadmap words、repository-independent conversation，以及 ordinary
non-governance code 或 documentation work 不会 nominate Bearing。Configure Inspect 会把被编辑的
managed block 报告为 `drifted`。Functional operations 会在 cache creation、provider I/O 或 mutation
前验证 Active lifecycle。

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

显式 `bearing uninstall` 会移除 `$HOME/.bearing/kit/current`、canonical CLI shim，以及仅由
Bearing 管理的 Agent Surface pointers。它不读取或修改 Project Catalog、repository canonical
state、Provider Configuration、profiles、artifacts 或 native work。它不是 repository
Deactivation 或 repository-state removal；Bearing 也不提供 repository-scoped package-uninstall
命令。

npm-owned package installation 仍由 npm 管理。请另外使用安装它的 package manager 移除，
例如 `npm uninstall -g @lagrangee/bearing`。
