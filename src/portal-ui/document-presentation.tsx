import {
  type DocumentPresentationBlock,
  type DocumentPresentationInline,
  type DocumentPresentationList,
  isExternalDocumentPresentationHref,
} from "../document-presentation";
import { assertNever } from "./assert-never";

const withStableKeys = <Value,>(values: readonly Value[]) => {
  const occurrences = new Map<string, number>();
  return values.map((value) => {
    const signature = JSON.stringify(value);
    const occurrence = (occurrences.get(signature) ?? 0) + 1;
    occurrences.set(signature, occurrence);
    return { key: `${signature}:${occurrence}`, value };
  });
};

function Inlines({ inlines }: { readonly inlines: readonly DocumentPresentationInline[] }) {
  return withStableKeys(inlines).map(({ key, value: inline }) => {
    switch (inline.kind) {
      case "text":
        return inline.value;
      case "strong":
        return (
          <strong key={key}>
            <Inlines inlines={inline.inlines} />
          </strong>
        );
      case "emphasis":
        return (
          <em key={key}>
            <Inlines inlines={inline.inlines} />
          </em>
        );
      case "inline-code":
        return <code key={key}>{inline.value}</code>;
      case "link":
        return (
          <a
            href={inline.href}
            key={key}
            title={inline.title}
            {...(isExternalDocumentPresentationHref(inline.href)
              ? { rel: "noopener noreferrer", target: "_blank" }
              : {})}
          >
            <Inlines inlines={inline.inlines} />
          </a>
        );
      default:
        return assertNever(inline);
    }
  });
}

function DocumentList({ list }: { readonly list: DocumentPresentationList }) {
  const items = withStableKeys(list.items).map(({ key, value: item }) => (
    <li key={key}>
      <Inlines inlines={item.inlines} />
      {withStableKeys(item.children).map(({ key: childKey, value: child }) => (
        <DocumentList key={childKey} list={child} />
      ))}
    </li>
  ));
  return list.style === "ordered" ? <ol start={list.start}>{items}</ol> : <ul>{items}</ul>;
}

export function DocumentPresentationBlocks({
  blocks,
}: {
  readonly blocks: readonly DocumentPresentationBlock[];
}) {
  return (
    <div className="document-presentation">
      {withStableKeys(blocks).map(({ key, value: block }) => {
        if (block.kind === "paragraph") {
          return (
            <p key={key}>
              <Inlines inlines={block.inlines} />
            </p>
          );
        }
        if (block.kind === "list") return <DocumentList key={key} list={block} />;
        const content = <Inlines inlines={block.inlines} key={`${key}:content`} />;
        switch (block.level) {
          case 3:
            return <h3 key={key}>{content}</h3>;
          case 4:
            return <h4 key={key}>{content}</h4>;
          case 5:
            return <h5 key={key}>{content}</h5>;
          case 6:
            return <h6 key={key}>{content}</h6>;
          default:
            return assertNever(block.level);
        }
      })}
    </div>
  );
}
