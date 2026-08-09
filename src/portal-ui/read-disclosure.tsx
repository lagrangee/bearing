import { type PropsWithChildren, useId, useLayoutEffect, useRef, useState } from "react";

const previewLineCount = 6;
const overflowTolerance = 1;
const focusableContent =
  'a[href], button, input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

type ContentFit = "pending" | "short" | "long";

export function ReadDisclosure({ children, label }: PropsWithChildren<{ readonly label: string }>) {
  const generatedId = useId();
  const contentId = `read-disclosure-${generatedId.replaceAll(":", "")}`;
  const contentRef = useRef<HTMLDivElement>(null);
  const [contentFit, setContentFit] = useState<ContentFit>("pending");
  const [expanded, setExpanded] = useState(false);

  useLayoutEffect(() => {
    const content = contentRef.current;
    if (content === null) return;
    let active = true;
    const measure = () => {
      if (!active) return;
      const lineHeight = Number.parseFloat(getComputedStyle(content).lineHeight);
      const nextFit =
        Number.isFinite(lineHeight) &&
        content.scrollHeight > lineHeight * previewLineCount + overflowTolerance
          ? "long"
          : "short";
      setContentFit((current) => (current === nextFit ? current : nextFit));
      if (nextFit === "short") setExpanded(false);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(content);
    void document.fonts?.ready.then(measure);
    return () => {
      active = false;
      observer.disconnect();
    };
  }, []);

  const collapsible = contentFit === "long";
  const collapsed = collapsible && !expanded;
  useLayoutEffect(() => {
    const content = contentRef.current;
    if (!collapsed || content === null) return;
    const priorTabIndex = new Map<HTMLElement, string | null>();
    let active = true;
    const updateTabOrder = () => {
      if (!active) return;
      const clippingBottom = content.getBoundingClientRect().top + content.clientHeight;
      const candidates = new Set([
        ...content.querySelectorAll<HTMLElement>(focusableContent),
        ...priorTabIndex.keys(),
      ]);
      for (const element of candidates) {
        const clipped = element.getBoundingClientRect().bottom > clippingBottom + overflowTolerance;
        if (clipped) {
          if (!priorTabIndex.has(element)) {
            priorTabIndex.set(element, element.getAttribute("tabindex"));
          }
          element.setAttribute("tabindex", "-1");
        } else if (priorTabIndex.has(element)) {
          const tabIndex = priorTabIndex.get(element);
          if (tabIndex === null) element.removeAttribute("tabindex");
          else if (tabIndex !== undefined) element.setAttribute("tabindex", tabIndex);
          priorTabIndex.delete(element);
        }
      }
    };
    updateTabOrder();
    const mutationObserver = new MutationObserver(updateTabOrder);
    mutationObserver.observe(content, { childList: true, subtree: true });
    const resizeObserver = new ResizeObserver(updateTabOrder);
    resizeObserver.observe(content);
    void document.fonts?.ready.then(updateTabOrder);
    return () => {
      active = false;
      mutationObserver.disconnect();
      resizeObserver.disconnect();
      for (const [element, tabIndex] of priorTabIndex) {
        if (tabIndex === null) element.removeAttribute("tabindex");
        else element.setAttribute("tabindex", tabIndex);
      }
    };
  }, [collapsed]);

  const action = expanded ? "Show less" : "Show more";
  return (
    <div
      className="read-disclosure"
      data-collapsed={collapsed || undefined}
      data-content-fit={contentFit}
    >
      <div className="read-disclosure-content" id={contentId} ref={contentRef}>
        {children}
      </div>
      {collapsible ? (
        <button
          aria-controls={contentId}
          aria-expanded={expanded}
          aria-label={`${action}: ${label}`}
          className="read-disclosure-toggle"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          {action}
        </button>
      ) : null}
    </div>
  );
}
