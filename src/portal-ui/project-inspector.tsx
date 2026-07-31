import type { RefObject } from "react";
import type { SourceRecord } from "../project-snapshot/contract";
import { AssetLocationCopy } from "./asset-location-copy";
import { Icons } from "./icons";
import { Inspector } from "./shell";

export type ProjectInspectorSelection = Readonly<{
  contentAction?: Readonly<{ href: string; label: string }> | undefined;
  detail?: string | undefined;
  eyebrow: string;
  facts?: readonly Readonly<{ label: string; value: string; code?: boolean | undefined }>[];
  fullDetailHref?: string | undefined;
  handoff?: boolean | undefined;
  copy?: Readonly<{ label: string; value: string }> | undefined;
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
  onOpenFullDetail,
  returnFocusRef,
  selection,
}: {
  readonly onClose: () => void;
  readonly onOpenFullDetail: (href: string) => void;
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
      {selection.copy === undefined ? null : (
        <AssetLocationCopy
          className="inspector-asset-location-copy"
          label={selection.copy.label}
          value={selection.copy.value}
        />
      )}
      {selection.sections?.map((section) => (
        <section className="inspector-section" key={section.title}>
          <h3>{section.title}</h3>
          {section.body === undefined ? null : <p>{section.body}</p>}
          {section.items === undefined ? null : (
            <InspectorItems items={section.items} title={section.title} />
          )}
        </section>
      ))}
      {selection.contentAction === undefined ? null : (
        <a
          className="action action-primary inspector-preview"
          href={selection.contentAction.href}
          rel="noopener noreferrer"
          target="_blank"
        >
          {selection.contentAction.label} <Icons.arrow />
        </a>
      )}
      {selection.fullDetailHref === undefined ? null : (
        <a
          className="action action-primary inspector-enter"
          href={selection.fullDetailHref}
          onClick={(event) => {
            if (
              event.button !== 0 ||
              event.metaKey ||
              event.ctrlKey ||
              event.shiftKey ||
              event.altKey
            ) {
              return;
            }
            event.preventDefault();
            onOpenFullDetail(selection.fullDetailHref ?? "");
          }}
        >
          Open full detail <Icons.arrow />
        </a>
      )}
      <p className="inspector-note">
        {selection.handoff
          ? "Agent Surface handoff remains outside this read-only preview."
          : "Provenance is display-only and grants no filesystem authority."}
      </p>
    </Inspector>
  );
}
