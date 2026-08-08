# 日常工作流

[English](everyday-workflows.md)

当问题不只是“能不能改代码”，而是“这个改动是否和项目对齐”时，使用 Bearing。

## 检查一个 proposed change

可以问：

```text
实现前，请根据当前方向、已接受决策和活跃工作检查这个请求。
```

期望结果：agent 要么带来源确认 fit，要么暴露 conflict。

## 运行 Bearing Project Orientation

可以问：

```text
请根据当前 repository 和已有工作，为我做一次 Bearing Project Orientation。
```

Project Orientation 会读取当前项目文件、canonical planning，以及一个有边界的临时 existing-work 视图；它会区分 facts、inferences、evidence gaps 和 unresolved questions，并给出当前理解、已交付 baseline、active-work landscape、Project Summary draft，以及零个或多个未来 Roadmap／Gate candidates。它应该引用当前 source truth，而不是复述聊天历史。

结果是 read-only：不会写入 Summary、创建 planning 或 work、生成 Project Brief，也不会把 standalone work 自动纳入 Bearing Scope。任何后续变更仍需你明确接受，并由对应 owner 执行。

### 相关概念

- **Bearing Project Orientation** 是对当前 repository、planning 和有边界 work evidence 的只读综合；它只产出 drafts 与 candidates，不写 canonical change。
- **Bearing Scope Review** 是更窄的临时比较，用于识别 standalone work 与可能的 enrollment candidates，不负责完整项目 orientation。
- **Project Summary** 是 canonical accepted long-horizon synthesis。Orientation 可以提出 Summary draft，但不能写入。
- **Project Brief** 只从符合条件且已接受的 lifecycle transition 派生；Repository Configuration 与 Orientation 都不会创建它。

## 有意识地修改 Roadmap

方向变化时，让 agent 先呈现决策：

```text
这会改变 Roadmap。请说明后果，并在更新 governance 前征求我的确认。
```

Bearing 的 Roadmaps 很轻，但仍然是 accepted direction。

## Review 一个 Milestone Gate

Gate readiness 可以派生；Gate passage 必须由人决策。

可以问：

```text
Review 这个 Gate 是否 ready for passage，并列出 evidence 与 exceptions。
```

## 运行 Planning Audit 或 Next Work

显式 Planning Audit 查找实质 drift，并可 promotion 一个去重后的 pending Planning Review。Next Work 请求只返回 transient Agent judgment：一个有证据的方向，以及确有意义的 alternatives。它们本身都不会启动实现。

## 检查 Bearing Scope

Bearing Scope Review 比 Project Orientation 更窄：它只比较当前 managed scope 与临时 Work Management inventory，用来识别 standalone work 和可能的 enrollment candidate。后续只有在你显式要求时才运行。Review 完成后，Bearing 会丢弃 inventory、recommendation 和 disposition，不会持久化这些数据。只有通过你显式接受的后续 planning change，standalone work 才会进入 managed scope。

## 使用 Portal

当你需要视觉化检查 Project Brief、Project Summary、active Roadmap focus、managed-scope Attention、managed contributing work 和 evidence provenance 时使用 Portal。Planning Audit 页面分为 current review、等待 attention 的 decisions，以及 accepted decision history。Standalone native-work inventory 不进入 Portal。Transient Next Work judgment 与所有 mutation 仍应留在所属 Agent Surface flow 中。
