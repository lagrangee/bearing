import { AttentionQueue, type AttentionQueueItem } from "./attention-queue";
import type { ProjectInspectorSelection } from "./project-inspector";
import type { ProjectOverviewModel } from "./project-overview-model";

const eyebrowFor = (kind: AttentionQueueItem["kind"]): string => {
  switch (kind) {
    case "diagnostic":
      return "Blocking diagnostic";
    case "alignment":
      return "Alignment Check";
    case "review":
      return "Planning Review";
  }
};

export function OverviewAttention({
  attention,
  onInspect,
}: {
  readonly attention: ProjectOverviewModel["attention"];
  readonly onInspect: (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;
}) {
  if (attention.length === 0) return null;
  const byKey = new Map(attention.map((item) => [item.key, item]));
  const items: AttentionQueueItem[] = attention.map((item) => ({
    key: item.key,
    kind: item.kind,
    state: item.state,
    title: item.title,
    ...(item.detail === undefined ? {} : { detail: item.detail }),
  }));
  return (
    <AttentionQueue
      items={items}
      onSelect={(item, trigger) => {
        const selected = item.key === undefined ? undefined : byKey.get(item.key);
        onInspect(
          {
            eyebrow: eyebrowFor(item.kind),
            title: item.title,
            detail:
              selected?.detail ??
              (selected?.state === "unresolved"
                ? "The referenced Attention source is unavailable in this Snapshot."
                : undefined),
            source: selected?.source,
          },
          trigger,
        );
      }}
    />
  );
}
