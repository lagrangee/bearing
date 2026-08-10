import type { RefObject } from "react";
import type { SourceRecord } from "../project-generation/contract";
import { TechnicalDetailsPanel } from "./shell";

export type TechnicalDetailsSelection = Readonly<{
  facts: readonly Readonly<{ label: string; value: string; code?: boolean | undefined }>[];
  sections: readonly Readonly<{
    title: string;
    items: readonly string[];
  }>[];
  source?: SourceRecord | undefined;
  sourceHref?: string | undefined;
  title: string;
}>;

function DetailItems({
  items,
  title,
}: {
  readonly items: readonly string[];
  readonly title: string;
}) {
  const occurrences = new Map<string, number>();
  return (
    <ul>
      {items.map((item) => {
        const occurrence = occurrences.get(item) ?? 0;
        occurrences.set(item, occurrence + 1);
        return <li key={`${title}:${item}:${occurrence}`}>{item}</li>;
      })}
    </ul>
  );
}

export function TechnicalDetails({
  onClose,
  returnFocusRef,
  selection,
}: {
  readonly onClose: () => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly selection: TechnicalDetailsSelection;
}) {
  return (
    <TechnicalDetailsPanel
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      title={selection.title}
    >
      <dl className="technical-details-list">
        {selection.facts.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.code ? <code>{fact.value}</code> : fact.value}</dd>
          </div>
        ))}
        <div>
          <dt>Source</dt>
          <dd>
            {selection.source === undefined ? (
              "Unavailable in the current Project Read Model generation"
            ) : selection.sourceHref === undefined ? (
              selection.source.displayLocator
            ) : (
              <a href={selection.sourceHref} rel="noreferrer" target="_blank">
                {selection.source.displayLocator}
              </a>
            )}
          </dd>
        </div>
        {selection.source === undefined ? null : (
          <div>
            <dt>Reference</dt>
            <dd>
              <code>{selection.source.reference}</code>
            </dd>
          </div>
        )}
      </dl>
      {selection.sections.map((section) => (
        <section className="technical-details-section" key={section.title}>
          <h3>{section.title}</h3>
          <DetailItems items={section.items} title={section.title} />
        </section>
      ))}
      <p className="technical-details-note">
        Provenance is display-only and grants no filesystem authority.
      </p>
    </TechnicalDetailsPanel>
  );
}
