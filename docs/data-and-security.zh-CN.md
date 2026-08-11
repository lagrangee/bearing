# 数据与安全

[English](data-and-security.md)

Bearing 是 local-first 且无 telemetry，但它不是安全沙箱。

## 存储了什么

- 仓库治理 state：在仓库的 Bearing state directory 下。
- Disposable projections 与 diagnostics：在仓库 cache directory 下。
- Native work management：在受支持的本地 Markdown Map 与 Ticket scope 下。
- 用户级安装与 Project Catalog：在用户的 Bearing home directory 下。

Cache 可以重建。Accepted governance 与 native work files 才是 source truth。

## 不会发送什么

Bearing 不执行 analytics、crash upload、repository-content upload、update polling 或后台 cloud sync。

只有当用户主动提交时，feedback、logs、diagnostics 或 repository excerpts 才会被分享。

分享 screenshot、log、diagnostic 或 repository excerpt 前，请先检查并打码。Catalog responses 与 Portal UI 会有意包含 absolute repository roots，因此即使截图或复制内容没有 source code，也可能暴露本地路径。

## Public feedback 与 private security reporting

- 问题和故障排查使用 [Q&A](https://github.com/lagrangee/bearing/discussions/categories/q-a)。
- 体验、建议和 feature ideas 使用 [Ideas](https://github.com/lagrangee/bearing/discussions/categories/ideas)。
- 可执行的文档问题使用 [Documentation problem](https://github.com/lagrangee/bearing/issues/new?template=documentation.yml)。
- 疑似漏洞使用 [GitHub private vulnerability reporting](https://github.com/lagrangee/bearing/security/advisories/new)。绝不能在公开 Issue 或 Discussion 中披露。

Issues 与 Discussions 是公开 GitHub 数据。请勿包含 tokens、secrets、private source、完整 planning state、真实 absolute repository paths 或未打码 screenshots。社区支持是 best-effort 且没有 SLA；公开报告不代表排期或交付承诺。

## Portal 边界

Portal 是绑定 loopback、供本地检查的前台 single-user Host。它面向 owner 的 Catalog API 与 UI 会有意返回并显示每个仓库的 absolute `repoRoot`。浏览器操作使用 opaque Catalog entry IDs，但 screenshots、复制的 responses 与主动提交的 diagnostics 仍可能暴露本地 filesystem paths。

直接 loopback URL 使用 HTTP，因此该本地传输上的 Portal session cookie 不带 `Secure`。Session 是临时的；每次重启 Portal Host 都会使它失效。

私有 Tailscale Serve 或 owner-managed reverse proxy 可以提供私有多设备 reachability。TLS、认证、访问控制、reachability 与由此产生的暴露边界由 owner 而不是 Bearing 负责。浏览器侧 proxy boundary 应使用 HTTPS；不要把直接 loopback 的 HTTP cookie contract 当作远程传输安全机制。

不支持：

- 未认证的 public Internet exposure；
- hosted multi-user operation；
- 产品托管 remote authentication；
- 把 Portal 当成 canonical decisions 的写入界面。

## Trusted checkout 假设

Bearing 会验证预期文件形状并拒绝许多不安全仓库状态，但它不是 filesystem security sandbox。不要在你不愿让 coding agent 或 build tooling 检查的仓库里运行它。
