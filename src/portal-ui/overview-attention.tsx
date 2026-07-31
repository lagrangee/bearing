import { planningLineageSubjectHref } from "../planning-lineage-route";
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
  entryId,
  onInspect,
  onNavigate,
}: {
  readonly attention: ProjectOverviewModel["attention"];
  readonly entryId: string;
  readonly onInspect: (selection: ProjectInspectorSelection, trigger: HTMLButtonElement) => void;
  readonly onNavigate: (href: string) => void;
}) {
  if (attention.length === 0) return null;
  const byKey = new Map(attention.map((item) => [item.key, item]));
  const items: AttentionQueueItem[] = attention.map((item) => {
    const subject =
      item.kind === "alignment"
        ? ({ kind: "alignment-check", id: item.key } as const)
        : item.kind === "review"
          ? ({ kind: "planning-review", id: item.key } as const)
          : item.nativeSubject;
    return {
      key: item.key,
      kind: item.kind,
      state: item.state,
      title: item.title,
      ...(item.detail === undefined ? {} : { detail: item.detail }),
      ...(subject === undefined ? {} : { href: planningLineageSubjectHref(entryId, subject) }),
    };
  });
  return (
    <AttentionQueue
      items={items}
      onOpen={(item, event) => {
        if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
          return;
        event.preventDefault();
        if (item.href !== undefined) onNavigate(item.href);
      }}
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
            ...(item.href === undefined ? {} : { fullDetailHref: item.href }),
          },
          trigger,
        );
      }}
    />
  );
}
