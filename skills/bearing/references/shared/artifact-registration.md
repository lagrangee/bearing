# Artifact Registration

Load this shared contract only when completion reconciliation contains a durable output.

The producing capability reports a produced-output manifest. The host decides whether each output is `transient`, `durable-registered`, or `durable-unregistered`; filesystem presence alone never establishes durability.

For registration, require explicit Asset identity, title, kind, location, owner, Producer Kind, Producer Name, optional durable Producer Reference, optional Produced For, and optional Produced At only when the producer or a trustworthy receipt supplies that exact value. Date-only Produced At remains date-only. Producer Kind is exactly `executor-profile`, `agent-capability`, or `external-source`; never persist model, task, thread, command, conversation, or Agent Surface brand as provenance.

Invoke `$HOME/.bearing/bin/bearing asset register` with the complete factual metadata and `--produced-at` only for that producer-owned value. On first registration, the route generates current UTC `Registered at` inside the protected operation and commits it with the Asset; failed registration and exact replay create no new event or time. Exact replay is a no-op; conflicting identity or invalid metadata fails closed. Registration and centralized Sync are one protected operation.

Registration creates no Planning Citation, Authority adoption, Asset Disposition, Effort binding, planning intent, or Gate Passage Evidence. A separately accepted registry-owned supersession or archive is owned by the `asset-lifecycle` branch, which records current UTC `Superseded at` or `Archived at` in the same successful owner transaction; this registration route does not perform that disposition. Route any such candidate to `asset-lifecycle` after factual registration. If metadata is incomplete or registration fails, classify the output `durable-unregistered`, mark artifact reconciliation `incomplete`, and report the exact resumption point.
