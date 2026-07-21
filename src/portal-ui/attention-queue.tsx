import { assertNever } from "./assert-never";
import { Icons } from "./icons";

export type AttentionKind = "diagnostic" | "alignment" | "review";

export type AttentionQueueItem = {
  readonly detail?: string;
  readonly key?: string;
  readonly kind: AttentionKind;
  readonly state?: "available" | "unresolved";
  readonly title: string;
};

function attentionKindLabel(kind: AttentionKind): string {
  switch (kind) {
    case "diagnostic":
      return "Blocking diagnostic";
    case "alignment":
      return "Alignment Check";
    case "review":
      return "Planning Review";
    default:
      return assertNever(kind);
  }
}

export function AttentionQueue({
  items,
  onSelect,
}: {
  readonly items: readonly AttentionQueueItem[];
  readonly onSelect?: (item: AttentionQueueItem, trigger: HTMLButtonElement) => void;
}) {
  return (
    <section
      id="attention-queue"
      className="attention-queue"
      tabIndex={-1}
      aria-labelledby="attention-title"
    >
      <div className="attention-heading">
        <span className="attention-icon" aria-hidden="true">
          <Icons.attention />
        </span>
        <div>
          <p className="eyebrow">Needs a decision before normal guidance</p>
          <h2 id="attention-title">Attention</h2>
          <p>{items.length} actionable project items</p>
        </div>
      </div>
      <div className="attention-items">
        {items.map((item) => (
          <button
            key={item.key ?? `${item.kind}:${item.title}`}
            className={`attention-item attention-${item.kind}${
              item.state === "unresolved" ? " is-unresolved" : ""
            }`}
            type="button"
            onClick={(event) => onSelect?.(item, event.currentTarget)}
          >
            <span>
              <small>{attentionKindLabel(item.kind)}</small>
              <strong>{item.title}</strong>
              {item.detail === undefined ? null : <span>{item.detail}</span>}
            </span>
            <Icons.arrow aria-hidden="true" />
          </button>
        ))}
      </div>
    </section>
  );
}
