# Bearing

## 始终与你的 coding agents 保持在同一页上。

Bearing 为长期 coding-agent 项目提供一个本地、可检查的项目治理层。它把已经接受的方向、决策、证据和 alignment checks 保持可见，让你和 agent 每次开始新工作时都能回到同一幅项目全貌，而不是依赖旧对话里脆弱的记忆。

Local-first · 开源 Public Preview · Codex verified path · Claude Code target surface 等待维护者验证 · Matt-native 本地 Markdown work management

[Quickstart](#quickstart完成一次真实-alignment-loop) · [Bearing 适合你吗？](#bearing-适合你吗) · [数据边界](#local-first-数据与信任边界) · [English README](README.md)

## Aha moment

你在一个活跃项目里让 agent 做下一件事：

> 接下来加入团队账号。

理解 Bearing 的 agent 可以根据当前项目 truth 回答：

> 当前 focused Gate 正在证明单用户工作流。已经接受的 Roadmap 把多用户认证放在后续。我们可以保持当前方向并记录为未来工作、修改 Roadmap，或者拆出一个独立 outcome horizon。在你选择之前，我不会把这件事视为已经对齐。

这就是 Bearing 的价值：不是完美的 agent 记忆，也不是第二套任务系统，而是持续的 alignment confidence。你能感觉 agent 和你在同一页上，也能看见这幅共享图景来自哪里。

## Bearing 连接了什么

```text
你 + Codex / Claude Code
          ↕
  Bearing 项目治理
          ↕
Matt-native Maps 与 Tickets

Portal 读取同一幅项目全貌
```

Bearing 负责长期项目治理：Project Summary、Roadmaps、Milestone Gates、Effort bindings、Authorities、Assets、Alignment Checks、Planning Audit，以及证据关系。

你的 work-management adapter 继续负责 Maps、Tickets、依赖、claims、blockers 与 resolution。你的 executor 继续负责实现和验证。Bearing 连接这些层次，但不会伪装成它们的全部。

已经在使用 Matt Pocock 的 planning workflow？Bearing 设计上读取同一类本地 Markdown Map 与 Ticket 形状，因此你不需要把工作迁移进另一套 tracker，就能增加 governance 和 Portal orientation。

## Bearing 适合你吗？

Bearing 很可能适合你，如果：

- 你在跨越许多 sessions 的软件项目中使用 coding agents；
- 你希望新请求在开始前先和已接受方向对齐；
- 你已经使用，或愿意使用，受支持的 Matt-native 本地 Markdown Map 与 Ticket 工作流；
- 你想要本地仓库 truth、本地 Portal，以及无自动 telemetry；
- 你能接受 macOS-first 的 `0.x` Public Preview 和有文档说明的 breaking changes。

Bearing 目前可能不适合你，如果：

- 你的工作大多是一次性编码任务，几乎没有 durable context；
- 你想要的是 Kanban board、托管 issue tracker、自主项目经理，或通用记忆数据库；
- 你不愿使用受支持的本地 Markdown work-management adapter；
- 你需要 hosted multi-user、产品托管认证、cloud sync，或 public Internet Portal；
- 你今天就需要官方支持 Linux 或 Windows。

## Public Preview 支持范围

| 范围 | Public Preview 支持 |
| --- | --- |
| 平台 | macOS |
| Node.js | Node.js 24.15.0 及以上；CI 验证 Node.js 24 与 26 |
| Agent Surfaces | Codex 已验证。Claude Code 是目标 surface，仍等待维护者验证。 |
| Work Management Adapter | Matt-native 本地 Markdown Maps 与 Tickets |
| Telemetry | 无。Bearing 不做 analytics、crash upload、repository upload 或 update polling。 |

## Feedback 与支持

- 可通过 [Bug report](https://github.com/lagrangee/bearing/issues/new?template=bug_report.yml) 或 [Documentation problem](https://github.com/lagrangee/bearing/issues/new?template=documentation.yml) 提交可复现 bug 与可执行的文档问题。Blank Issues 默认关闭。
- 安装、概念、工作流与故障排查问题请进入 [Q&A](https://github.com/lagrangee/bearing/discussions/categories/q-a)；体验、场景、痛点、建议及尚待成形的 feature ideas 请进入 [Ideas & Feedback](https://github.com/lagrangee/bearing/discussions/categories/ideas-feedback)。
- 疑似漏洞只能通过 [GitHub private vulnerability reporting](https://github.com/lagrangee/bearing/security/advisories/new) 私下报告，绝不能发布在公开 Issue 或 Discussion 中。

Issues 与 Discussions 都是公开 GitHub 数据。请勿提交 tokens、secrets、private source、完整 planning state、真实 absolute repository paths 或未打码 screenshots。Bearing 不会自动上传 diagnostics；logs、diagnostics 与 repository excerpts 只有在你明确提交时才会被分享。社区支持为 best-effort，不提供 SLA；公开 feedback 也不代表排期或交付承诺。

## Quickstart：完成一次真实 alignment loop

### 1. 安装 Bearing

```bash
npx @lagrangee/bearing
```

Public Preview 的安装入口是无参数 wizard。它会在写入前预览 managed targets，安装版本匹配的 CLI 与唯一的 `bearing` Agent Surface skill；全局安装期间不会初始化仓库或启动 Portal。

当你主动选择 update 或 repair Bearing 时，重新运行同一个命令。Update 会 stage 一份完整
bundle，并把它作为整体切换，或恢复上一份完整 bundle。Bearing 不会在后台检查更新。
Repository deactivation、repository-state purge、显式 package downgrade 与 package-manager
uninstall 是彼此独立的恢复操作；见 [故障排查](docs/troubleshooting.zh-CN.md)。

高级用户和 agents 可以使用显式命令；见 [CLI reference](docs/cli.zh-CN.md)。

### 2. 选择一个真实项目

从一个真实 Git 仓库开始，这个仓库最好已经有、或准备使用受支持的本地 Markdown Map 与 Ticket 工作流。Bearing 在能把真实方向连接到真实工作时，最容易产生第一次价值；空白 toy repo 能证明的东西很少。

### 3. 让 agent 设置 Bearing

在 Codex 中打开仓库，然后问：

```text
为这个项目设置 Bearing。把现有的 Map 和 Tickets 用作工作上下文，并引导我建立最低限度的治理基线。
```

最低有用基线是：

- 一份当前 Project Summary；
- 一条 active Roadmap 和 focused Milestone Gate；
- 一个把现有 Map 或 Ticket scope 绑定到该 Gate 的 Effort。

每个被接受的方向仍然是人的决策。Setup 不应该只靠仓库文件自行推断 governance truth。

### 4. 带来一个真实请求

问一件你接下来真的想做的事：

```text
开始之前，请根据当前方向、已接受决策和活跃工作检查这件事。如果存在冲突，先让我看见冲突，再采取行动。
```

当 agent 解释这个请求如何符合当前方向，或在实现前暴露实质冲突并给出明确决策路径时，第一次 alignment loop 就完成了。安装成功本身不是价值里程碑。

### 5. Sync 并检查

```bash
bearing sync --repo .
bearing portal
```

打开 Portal Host 打印的 loopback URL，检查 Project Summary、focused Roadmap 和 Gate、contributing Effort、Attention 与 source provenance。

## Local-first 数据与信任边界

- 仓库治理 truth 存在仓库的 Bearing state 和原生本地 Markdown work scope 中。
- 用户级安装与 Project Catalog 数据存在用户的 Bearing home directory 中。
- `.bearing/cache` 是 disposable projection data；source truth 仍在 canonical state 与 native work files 中。
- Portal 面向 owner 的 Catalog API 与 UI 会显示 absolute repository roots，因此 screenshots 与用户主动分享的 diagnostics 可能暴露本地路径，分享前必须打码。
- 直接 loopback Portal 使用 HTTP，因此它的 session cookie 不带 `Secure`；重启前台 Portal Host 会使 session 失效。
- 私有 Tailscale Serve 或 owner-managed reverse proxy 可以提供私有 reachability，但 owner 负责 TLS、认证、访问控制与暴露边界。不支持 public unauthenticated Internet exposure。
- Bearing 是本地 trusted-checkout 工具。它不是 filesystem sandbox，也不声称能防御恶意并发文件系统修改。

更多见 [Data and security](docs/data-and-security.zh-CN.md) 和 [SECURITY.md](SECURITY.md)。

## 学习、恢复与贡献

- [Getting started](docs/getting-started.zh-CN.md)
- [Everyday workflows](docs/everyday-workflows.zh-CN.md)
- [Data and security](docs/data-and-security.zh-CN.md)
- [Troubleshooting](docs/troubleshooting.zh-CN.md)
- [CLI reference](docs/cli.zh-CN.md)
- [Contributing](CONTRIBUTING.md)
- [Code of Conduct](CODE_OF_CONDUCT.md)
- [Third-party notices](THIRD_PARTY_NOTICES)

Bearing 采用 MIT License 开源。
