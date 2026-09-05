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
bearing install --surface agent-skills --surface claude --surface workbuddy
bearing update
bearing uninstall
```

Interactive terminal 不带 `--surface` 时，Bearing 只检测已经完整存在的 `~/.agents/skills`、
`~/.claude/skills` 与 `~/.workbuddy/skills`，并显示一个使用 up/down、Space 与 Enter 的 checklist；
选择 zero surfaces 也是有效结果。Non-interactive caller 传入已经解析的 supported `--surface`
值，不模拟 keyboard input，也不推断 current surface。Bearing 不创建缺失的 surface directory、
不扫描 arbitrary location，也不接受 arbitrary target。

Install 会先 stage 并验证一份完整的 package-owned bundle，再切换
`$HOME/.bearing/kit/current`。所选 Agent Surface links 与 canonical CLI 都通过这一份 bundle
解析。随后每个 selected surface 会作为 package-owned symbolic link 独立处理，并分别报告
`applied`、`no-op` 或 `conflict`；一个 conflict 不会回滚 Kit 或另一个 surface。Regular file、
directory、non-owned link 与 user-created copy 会被保留为 unsupported unmanaged integration。
Kit 切换失败会恢复上一份完整 bundle，且绝不会修改 repository state。任何 older exact
candidate 都会无写入地被阻止，也不存在 override。若当前 `kit/current/package.json` 缺失、
malformed 或 unsafe，结果为 `Current Kit Unverifiable`；install 不会覆盖它。恢复需要另行授权
`bearing uninstall`，然后从预期的 exact candidate 执行 verified Fresh Install。

每次成功安装后，Bearing 都会直接打印：

```bash
export PATH="$HOME/.bearing/bin:$PATH"
```

执行这条 export 只影响 current session。若希望未来 terminal 也能发现裸 `bearing`，可把同一行
加入相应 shell startup profile。CLI 不会写入或 source 任何 profile。

### 检查 Global Kit 更新

`bearing update` 会在前台执行一次 npm `latest` 更新检查。它会先验证返回的 exact version、npm
integrity 与 canonical repository identity，再和可信的 current Kit 比较；不会执行 background
polling。已经是最新版本时返回 no-op；older 或 unverifiable candidate 会无写入地被阻止。

Newer verified candidate 会显示 `Update available: <current> → <target>`。更新检查本身不授权
mutation：interactive terminal 会在调用该 exact candidate 自带的 `bearing install` 前取得一次单独
确认。Decline、cancel、registry failure 与 candidate verification failure 都会保持完整 current Kit
byte-for-byte 不变。Update 只延续 existing package-owned Agent Surface links；不会显示 surface
checklist、接入 newly detected surface、配置 repository、执行 Agent-guided Repository Update 或启动
Portal。任意 exact-version selection 仍由 package manager 调用所选 exact candidate 的 installer。

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

Fresh public Repository Configuration 会写入完整的 schema 2 target，并明确包含
`runtime: stable`。Source repository 使用独立、显式的 `runtime: development` target。Runtime 是
target identity，不是让 Human 选择的 migration mode；缺失或无效 Runtime 不会在 Stable 与
Development 之间 default、fallback 或 silent-convert。

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
语义可安全读取的 older repository 可以返回 Repository Update Required，同时提供 installed Kit
的完整 target contract 与需要 Human 确认的 semantic update guide。Source version 只作为
provenance，不是 migration dispatch key。Agent 保留 canonical state，只写 target manifest，
并在不进行 provider acquisition 的情况下重建而非迁移 disposable Project Read Model。较新的
state 返回 Kit Update Required；未知或损坏的 state 保持 Unsupported 且不变。Bearing
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

Capture、verification、reconciliation 与本地 Ensure Current 从一次捕获的 canonical basis
派生候选；健康数据库的本地 cache rebuild 也使用自己的 committed starting basis。提交时在一个 SQLite transaction 中比较该操作使用的 committed metadata 与 bound
evidence。发生并发变化时返回 `project-read-model-publication-conflict`：结果为 `unfulfilled`，
保留实际 acquisition count，已取得但未发布的 evidence 标为 `unpublished`，不借用赢家的
observation 或 generation。冲突 reconciliation 的 Pending Native Write Set 仍保持 pending。
先 Inspect 当前 evidence，再选择后续显式操作；不会自动 retry 或扩大 acquisition。

完全等价的最终状态复用同一 receipt；相同语义的 attempt 或 display 更新不增加 generation，
并发 detail evidence 独立保留。冲突只为仍与起始状态完全一致的 requested bound row 记录失败
attempt 并保留 observation；已变化或删除的 row 不受影响。完成时不会再次检查 canonical
文件，后来的本地编辑属于后续操作。

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
