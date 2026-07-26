# Artifact Registration

Load this shared contract only when completion reconciliation contains a durable output.

The producing capability reports a produced-output manifest. The host decides whether each output is `transient`, `durable-registered`, or `durable-unregistered`; filesystem presence alone never establishes durability.

For registration, require explicit Asset identity, title, kind, location, owner, Producer Kind, Producer Name, optional durable Producer Reference, and optional Produced For. Producer Kind is exactly `executor-profile`, `agent-capability`, or `external-source`; never persist model, task, thread, command, conversation, or Agent Surface brand as provenance.

Invoke `$HOME/.bearing/bin/bearing asset register` with the complete factual metadata. Exact replay is a no-op; conflicting identity or invalid metadata fails closed. Registration and centralized Sync are one protected operation.

Registration creates no Planning Citation, Authority adoption, Asset Disposition, Effort binding, planning intent, or Gate Passage Evidence. Route any such candidate to its own mutation owner after factual registration. If metadata is incomplete or registration fails, classify the output `durable-unregistered`, mark artifact reconciliation `incomplete`, and report the exact resumption point.
