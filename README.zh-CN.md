# Bearing

<a id="始终与你的-coding-agents-保持在同一页上"></a>

## 用 Wayfinder 想清楚每件事，用 Bearing 看清整个项目。

如果你已经在用 [Matt Pocock 的 skills](https://github.com/mattpocock/skills) 做项目，Bearing 可以把 Wayfinder 的 Map、后续任务和交付依据，连接到项目方向与阶段目标。

继续沿用熟悉的工作流。你和 agent 都能看清：这件事为什么做，和其他工作有什么关系，现在的进展是否仍符合当初的决定。

开源预览版 · 本地运行 · macOS · MIT 协议

[先看 Portal 演示](https://lagrangee.github.io/bearing/) · [开始使用](#开始使用) · [English](README.md)

<a id="aha-moment"></a>

## 每份 Map 都很清楚，整个项目呢？

你用 Wayfinder 理清了新用户引导，又为计费和性能优化各建了一份 Map。每件事都有目标，也留下了讨论和决定。接下来，问题变成了：

> 哪件事最能帮助我们达到下一个阶段目标？现在加入团队账号，还符合之前定下的方向吗？

Bearing 把你选定的工作放回同一份项目规划中。沿着一份 Map，你可以找到它对应的工作目标、要通过的阶段验收，以及做出决定时的依据。Agent 也能从这些来源出发，与你讨论继续推进、调整方向，还是另立一个目标。

<a id="bearing-连接了什么"></a>

## Map 与 Effort 怎么对应？

在 Bearing 里，一项已确认要推进的工作称为 **Effort**。采用 Wayfinder 时，一份 Map 及其所在的工作范围，可以由一个 Effort 承接：Map 组织探索和决策，Effort 说明这项工作为什么值得做、服务于哪个阶段目标。

```text
项目方向（Roadmap）
  └─ 阶段目标与验收（Milestone Gate）
      ├─ 一项工作（Effort）
      │   └─ Wayfinder Map 与相关任务
      └─ 另一项工作（Effort）
          └─ Wayfinder Map 与相关任务
```

Map 中的问题都想清楚了，后续开发可能才刚开始。Effort 会贯穿接下来的交付与验收，直到这项工作有明确的结论。

哪些工作放进 Bearing，由你选择。Effort 也可以先被规划出来，或直接承接实施任务，不必都从 Map 开始。

## 沿用你熟悉的 Matt 工作流

- **Wayfinder**：逐步理清未知问题，把决定留在 Map 中。
- **规格与任务拆分 skills**：按需要，把已经想清楚的方案整理为 Spec，再拆成可交付的任务。
- **执行工具或 agent**：完成实现与验证。
- **Bearing**：把这些工作连接到项目方向、阶段目标和验收依据，并通过本地 Portal 展示出来。

当前预览版支持 Matt 工作流的本地 Markdown Map、Spec 和 Ticket。你继续在原来的地方管理任务、依赖和状态。Portal 用于查看与追溯；调整项目规划时，仍然在 agent 对话中作出决定。

<a id="quickstart完成一次真实-alignment-loop"></a>

## 开始使用

准备好 macOS、Node.js 24.15.0 或更高版本，以及能够安装软件并接入 skill 的 coding agent。从一个正在推进的 Git 项目和一份真实的 Wayfinder Map 开始，最容易看出 Bearing 的作用。

### 1. 让 agent 安装 Bearing

把这段话交给 agent：

```text
请从 https://github.com/lagrangee/bearing 安装 Bearing，按照仓库的 Agent installation guide 核实并安装已发布版本，将 Bearing skill 接入你当前使用的 skill 目录。安装完成后先停下，项目设置稍后再做。
```

[安装指南](docs/agent-installation.md)会让 agent 核实一个精确的已发布版本，并分别确认软件安装、skill 接入和项目设置。正常安装使用发布包。

如果需要手动安装，先核实发布版本和包的身份，再运行：

```bash
npx --yes @lagrangee/bearing@<resolved-version> install
```

安装程序会提示如何设置 PATH，不会修改 shell 配置。遇到问题可查看[入门指南](docs/getting-started.zh-CN.md)和[故障排查](docs/troubleshooting.zh-CN.md)。

### 2. 把一项真实工作放进项目规划

在目标项目中打开 agent，并指出你要使用的 Map：

```text
请为这个项目设置 Bearing。我想把这份 Wayfinder Map 和相关工作连接到项目方向与阶段目标。先说明你建议纳入的范围，以及需要建立的最小规划，等我确认后再写入。
```

从项目说明、Roadmap、当前 Gate 和一个 Effort 开始就够了。先把一项真实工作连接起来，再按需要纳入更多工作。

### 3. 带着真实问题使用它

例如：

```text
我想增加团队账号。请结合当前项目方向、已经做出的决定和正在推进的工作，检查这件事是否合适；有冲突就先摊开讨论。
```

第一次有用的结果，是你能看清新请求与项目方向的关系，并据此作出决定。

### 4. 在 Portal 中查看整体

```bash
bearing inspect project --repo .
bearing portal
```

打开终端打印的本机访问地址，可以查看项目概况、Roadmap、Gate、Effort、需要关注的问题，以及它们的来源。更多命令见 [CLI 使用说明](docs/cli.zh-CN.md)。

<a id="bearing-适合你吗"></a>

## 适合谁？

如果你已经在用 Matt Pocock 的 skills，尤其是 Wayfinder，而且项目里有几项持续推进的工作，Bearing 值得一试。每份 Map 和任务清单都能读懂，却越来越难把握它们与项目整体的关系，是一个典型的使用场景。

一次性的小任务通常不需要这么多规划。当前产品也不提供托管任务系统、自动项目经理、通用记忆库、多人在线协作或云端同步。

<a id="public-preview-支持范围"></a>

## 支持范围

| 项目 | 当前支持 |
| --- | --- |
| 操作系统 | macOS；暂不正式支持 Linux 和 Windows |
| Node.js | 24.15.0 或更高版本；CI 覆盖 24.15.0 和 26 |
| 工作管理 | Matt 工作流的本地 Markdown Map、Spec 和 Ticket |
| 使用数据收集 | 不采集使用统计，不上传崩溃信息或仓库内容，不自动轮询更新 |

目前为 `0.x` 开源预览版，可能发生不兼容变更；相关变化会记录在文档中。

<a id="interactive-browser-sample"></a>

## 先看看 Portal

[打开交互演示](https://lagrangee.github.io/bearing/)，用固定的 Northstar 示例数据看看项目关系如何呈现。

演示完全在浏览器中运行，不读取你的仓库，不启动本地服务，不调用 provider 或 API，也不记录使用统计或保存浏览器状态。它展示的是虚构项目，不代表你的安装已经成功，也不进入 npm 发布包。实际使用从本地安装开始。

<a id="local-first-数据与信任边界"></a>

## 数据、安全与共享

- 项目规划保存在仓库的 `.bearing/state/` 中，原生工作保存在选定的本地 Markdown 范围；`.bearing/cache` 中的读取缓存可以重建。
- 安装文件和项目列表保存在本机的 Bearing 用户目录中。
- 显式安装或检查更新时会访问软件包仓库。Bearing 不自动上传使用统计、崩溃信息或项目内容；反馈只会在你主动提交时发出。
- Portal 会显示仓库的完整本地路径。分享截图或诊断信息前，请先去除私有内容并遮盖路径。
- 本机直接访问 Portal 使用 HTTP，会话 cookie 不带 `Secure` 标记；重启前台服务会使原有会话失效。
- 如果通过 Tailscale Serve 或自行管理的反向代理提供私有访问，需要自行负责加密、身份验证和访问控制。当前不支持无认证的公网访问。
- Bearing 用于你信任的本地仓库，不提供文件系统隔离，也不保证能抵御恶意的并发文件修改。

改变访问方式或分享项目资料前，请阅读[数据与安全](docs/data-and-security.zh-CN.md)及[安全说明](SECURITY.md)。

<a id="feedback-与支持"></a>

## 反馈与帮助

- 可复现的问题：[报告 bug](https://github.com/lagrangee/bearing/issues/new?template=bug_report.yml) 或[报告文档问题](https://github.com/lagrangee/bearing/issues/new?template=documentation.yml)。请使用对应模板。
- 使用疑问与想法：[Q&A](https://github.com/lagrangee/bearing/discussions/categories/q-a) 和 [Ideas](https://github.com/lagrangee/bearing/discussions/categories/ideas)。
- 疑似安全漏洞：通过 [GitHub 私密漏洞报告](https://github.com/lagrangee/bearing/security/advisories/new)提交，避免在公开 Issue 或 Discussion 中披露。

Issues 和 Discussions 的内容公开可见。请勿提交密钥、私有源码、完整规划记录、真实仓库路径或未经遮盖的截图，只提供定位问题所需的最小脱敏片段。社区支持尽力而为，不承诺响应时限；提交反馈不代表相关工作已经排期。

<a id="学习恢复与贡献"></a>

## 文档与参与

[入门指南](docs/getting-started.zh-CN.md) · [日常用法](docs/everyday-workflows.zh-CN.md) · [故障排查](docs/troubleshooting.zh-CN.md) · [CLI 使用说明](docs/cli.zh-CN.md) · [参与贡献](CONTRIBUTING.md) · [行为准则](CODE_OF_CONDUCT.md) · [第三方声明](THIRD_PARTY_NOTICES)

Bearing 按 MIT 协议开源。
