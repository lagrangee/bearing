import type { MouseEvent } from "react";
import { assertNever } from "./assert-never";
import { Icons } from "./icons";

export type AttentionKind = "diagnostic" | "alignment" | "review";

export type AttentionQueueItem = {
  readonly detail?: string;
  readonly href?: string;
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
  onOpen,
  onSelect,
}: {
  readonly items: readonly AttentionQueueItem[];
  readonly onOpen?: (item: AttentionQueueItem, event: MouseEvent<HTMLAnchorElement>) => void;
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
        {items.map((item) => {
          const className = `attention-item attention-${item.kind}${
            item.state === "unresolved" ? " is-unresolved" : ""
          }`;
          const content = (
            <>
              <span>
                <small>{attentionKindLabel(item.kind)}</small>
                <strong>{item.title}</strong>
                {item.detail === undefined ? null : <span>{item.detail}</span>}
              </span>
              <Icons.arrow aria-hidden="true" />
            </>
          );
          return item.href === undefined ? (
            <button
              key={item.key ?? `${item.kind}:${item.title}`}
              className={className}
              type="button"
              onClick={(event) => onSelect?.(item, event.currentTarget)}
            >
              {content}
            </button>
          ) : (
            <div className="attention-route-item" key={item.key ?? `${item.kind}:${item.title}`}>
              <a className={className} href={item.href} onClick={(event) => onOpen?.(item, event)}>
                {content}
              </a>
              {onSelect === undefined ? null : (
                <button
                  className="row-quick-look"
                  type="button"
                  aria-label={`Quick Look ${item.title}`}
                  onClick={(event) => onSelect(item, event.currentTarget)}
                >
                  Quick Look
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
