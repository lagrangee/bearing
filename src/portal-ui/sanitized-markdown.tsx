import { ReadDisclosure } from "./read-disclosure";

export function SanitizedMarkdownContent({
  html,
  label,
  presentation,
}: {
  readonly html: string;
  readonly label: string;
  readonly presentation: "rendered" | "fallback";
}) {
  return (
    <ReadDisclosure label={label}>
      <div
        className={`provider-markdown provider-markdown-${presentation}`}
        data-markdown-presentation={presentation}
        // The Portal Host rendered and sanitized this value. The browser owns no Markdown or HTML policy.
        // biome-ignore lint/security/noDangerouslySetInnerHtml: This is the single controlled Host-sanitized HTML sink.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </ReadDisclosure>
  );
}
