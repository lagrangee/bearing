# Data and security

[简体中文](data-and-security.zh-CN.md)

Bearing is local-first and no-telemetry, but it is not a security sandbox.

## What is stored

- Repository governance state: under the repository's Bearing state directory.
- Disposable projections and diagnostics: under the repository cache directory.
- Native work management: under the supported local Markdown Map and Ticket scope.
- User-level installation and Project Catalog: under the user's Bearing home directory.

Cache can be rebuilt. Accepted governance and native work files are source truth.

## What is not sent

Bearing performs no analytics, crash upload, repository-content upload, update polling, or background cloud sync.

Feedback, logs, diagnostics, or repository excerpts are shared only when the user deliberately submits them.

Before sharing a screenshot, log, diagnostic, or repository excerpt, inspect and redact it. Catalog responses and Portal UI surfaces intentionally include absolute repository roots, so captured or copied material may reveal local paths even when it contains no source code.

## Portal boundary

Portal is a foreground, single-user Host that binds loopback for local inspection. Its owner-facing Catalog API and UI intentionally return and display each repository's absolute `repoRoot`. Browser actions use opaque Catalog entry IDs, but screenshots, copied responses, and submitted diagnostics can still disclose local filesystem paths.

The direct loopback URL uses HTTP. The Portal session cookie is therefore not marked `Secure` on that local transport. The session is ephemeral and becomes invalid whenever the Portal Host restarts.

Private Tailscale Serve or an owner-managed reverse proxy may provide private multi-device reachability. The owner, not Bearing, is responsible for TLS, authentication, access control, reachability, and the resulting exposure. Use HTTPS at the browser-facing proxy boundary, and do not treat the direct loopback HTTP cookie contract as a remote-transport security mechanism.

Unsupported:

- unauthenticated public Internet exposure;
- hosted multi-user operation;
- product-managed remote authentication;
- treating Portal as a write surface for canonical decisions.

## Trusted checkout assumption

Bearing validates expected file shapes and rejects many unsafe repository states, but it is not a filesystem security sandbox. Do not run it in a repository you would not trust your coding agent or build tooling to inspect.
