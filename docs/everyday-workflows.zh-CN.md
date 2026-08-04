# 日常工作流

[English](everyday-workflows.md)

当问题不只是“能不能改代码”，而是“这个改动是否和项目对齐”时，使用 Bearing。

## 检查一个 proposed change

可以问：

```text
实现前，请根据当前方向、已接受决策和活跃工作检查这个请求。
```

期望结果：agent 要么带来源确认 fit，要么暴露 conflict。

## 重新理解项目

可以问：

```text
请根据当前 Project Summary、focused Roadmap 和 Gate、active Efforts、Attention 给我做项目 orientation。
```

它应该引用当前 source truth，而不是复述聊天历史。

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

Planning Audit 查找实质 drift。Next Work Guidance 给出一个主方向和两个 alternatives。它们本身都不会启动实现。

## 检查 Bearing Scope

Fresh Setup 完成后，Bearing 可以提供一次可选的 Bearing Scope Review。后续只有在你显式要求比较当前 managed scope 与临时 Work Management inventory 时才运行。Review 完成后，Bearing 会丢弃 inventory、recommendation 和 disposition，不会持久化这些数据。只有通过你显式接受的后续 planning change，standalone work 才会进入 managed scope。

## 使用 Portal

当你需要视觉化检查 Project Brief、Project Summary、active Roadmap focus、managed-scope Attention、managed contributing work 和 evidence provenance 时使用 Portal。Standalone native-work inventory 不进入 Portal。Next Work Guidance 与 mutation 仍应留在所属 Agent Surface flow 中。
