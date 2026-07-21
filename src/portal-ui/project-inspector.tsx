import type { RefObject } from "react";
import type { SourceRecord } from "../project-snapshot/contract";
import { Icons } from "./icons";
import { Action } from "./primitives";
import { Inspector } from "./shell";

export type ProjectInspectorSelection = Readonly<{
  detail?: string | undefined;
  eyebrow: string;
  facts?: readonly Readonly<{ label: string; value: string; code?: boolean | undefined }>[];
  handoff?: boolean | undefined;
  nativeSourceHandoff?: boolean | undefined;
  sections?: readonly Readonly<{
    title: string;
    body?: string | undefined;
    items?: readonly string[] | undefined;
  }>[];
  source?: SourceRecord | undefined;
  title: string;
}>;

function InspectorItems({
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

export function ProjectContextInspector({
  onClose,
  returnFocusRef,
  selection,
}: {
  readonly onClose: () => void;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly selection: ProjectInspectorSelection;
}) {
  return (
    <Inspector
      eyebrow={selection.eyebrow}
      onClose={onClose}
      returnFocusRef={returnFocusRef}
      title={selection.title}
    >
      {selection.detail === undefined ? null : <p className="inspector-body">{selection.detail}</p>}
      <dl className="inspector-list">
        {selection.handoff ? (
          <>
            <div>
              <dt>Authority</dt>
              <dd>Agent Surface</dd>
            </div>
            <div>
              <dt>Portal role</dt>
              <dd>Read and orient</dd>
            </div>
          </>
        ) : null}
        {selection.facts?.map((fact) => (
          <div key={fact.label}>
            <dt>{fact.label}</dt>
            <dd>{fact.code ? <code>{fact.value}</code> : fact.value}</dd>
          </div>
        ))}
        <div>
          <dt>Source</dt>
          <dd>
            {selection.source === undefined
              ? "Unavailable in the current Snapshot"
              : selection.source.displayLocator}
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
      {selection.sections?.map((section) => (
        <section className="inspector-section" key={section.title}>
          <h3>{section.title}</h3>
          {section.body === undefined ? null : <p>{section.body}</p>}
          {section.items === undefined ? null : (
            <InspectorItems items={section.items} title={section.title} />
          )}
        </section>
      ))}
      {selection.handoff ? (
        <>
          <Action className="inspector-enter" tone="primary" disabled>
            Resume in Agent Surface <Icons.arrow />
          </Action>
          {selection.nativeSourceHandoff ? (
            <Action className="inspector-enter" disabled>
              Open native source
            </Action>
          ) : null}
          <p className="inspector-note">
            Placeholder only · Agent Surface handoff
            {selection.nativeSourceHandoff ? " and native source opening are" : " is"} intentionally
            deferred
          </p>
        </>
      ) : (
        <p className="inspector-note">
          Provenance is display-only and grants no filesystem authority.
        </p>
      )}
    </Inspector>
  );
}
