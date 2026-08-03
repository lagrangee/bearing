import { planningLineageSubjectHref } from "../planning-lineage-route";
import { AttentionQueue, type AttentionQueueItem } from "./attention-queue";
import type { ProjectOverviewModel } from "./project-overview-model";

export function OverviewAttention({
  attention,
  entryId,
  onNavigate,
}: {
  readonly attention: ProjectOverviewModel["attention"];
  readonly entryId: string;
  readonly onNavigate: (href: string) => void;
}) {
  if (attention.length === 0) return null;
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
    />
  );
}
