import type { ComponentType, KeyboardEvent, MouseEvent, RefObject, SVGProps } from "react";
import { useEffect, useRef } from "react";
import { Icons } from "./icons";
import { useNarrowViewport } from "./use-narrow";

export type ProjectSection = "overview" | "roadmaps" | "assets" | "audit";

const navigation = [
  ["overview", "Overview", Icons.overview],
  ["roadmaps", "Roadmaps", Icons.roadmap],
  ["assets", "Assets", Icons.asset],
  ["audit", "Audit", Icons.audit],
] as const;

type NavigationIcon = ComponentType<SVGProps<SVGSVGElement>>;

export function ProjectNavigationItem({
  active = false,
  href,
  icon: Icon,
  label,
  onClick,
}: Readonly<{
  active?: boolean;
  href?: string | undefined;
  icon: NavigationIcon;
  label: string;
  onClick?: ((event: MouseEvent<HTMLAnchorElement>) => void) | undefined;
}>) {
  const content = (
    <>
      <Icon />
      <span>{label}</span>
    </>
  );
  return href === undefined ? (
    <span
      className={`project-nav-item${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
    >
      {content}
    </span>
  ) : (
    <a
      className={`project-nav-item${active ? " active" : ""}`}
      aria-current={active ? "page" : undefined}
      href={href}
      onClick={onClick}
    >
      {content}
    </a>
  );
}

type ProjectNavigationProps = {
  readonly activeSection?: ProjectSection;
  readonly basePath?: string;
  readonly open: boolean;
  readonly onClose: () => void;
  readonly onNavigate?: (section: ProjectSection, href: string) => void;
  readonly projectTitle: string;
  readonly returnFocusRef: RefObject<HTMLElement | null>;
  readonly suspended: boolean;
};

export function ProjectNavigation({
  activeSection = "overview",
  basePath,
  open,
  onClose,
  onNavigate,
  projectTitle,
  returnFocusRef,
  suspended,
}: ProjectNavigationProps) {
  const narrow = useNarrowViewport();
  const navRef = useRef<HTMLElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const hidden = narrow && (!open || suspended);
  const close = () => {
    onClose();
    window.requestAnimationFrame(() => returnFocusRef.current?.focus());
  };

  useEffect(() => {
    if (narrow && open && !suspended) closeRef.current?.focus();
  }, [narrow, open, suspended]);

  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (!narrow || suspended) return;
    if (event.key === "Escape") {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== "Tab") return;
    const focusable = Array.from(
      navRef.current?.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ) ?? [],
    );
    const first = focusable[0];
    const last = focusable.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  };

  return (
    <>
      <nav
        ref={navRef}
        id="project-navigation"
        className="project-nav"
        aria-label="Project navigation"
        aria-hidden={hidden}
        inert={hidden}
        onKeyDown={handleKeyDown}
      >
        <div className="nav-project">
          <span>
            <small>Current project</small>
            <strong>{projectTitle}</strong>
          </span>
          <button
            ref={closeRef}
            className="nav-close"
            type="button"
            onClick={close}
            aria-label="Close navigation"
          >
            <Icons.close />
          </button>
        </div>
        {navigation.map(([section, label, Icon]) => {
          const href =
            basePath === undefined
              ? undefined
              : section === "overview"
                ? basePath
                : `${basePath}/${section}`;
          return (
            <ProjectNavigationItem
              key={section}
              active={activeSection === section}
              href={href}
              icon={Icon}
              label={label}
              onClick={
                href === undefined || onNavigate === undefined
                  ? undefined
                  : (event) => {
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
                      onNavigate(section, href);
                      if (narrow) close();
                    }
              }
            />
          );
        })}
        <div className="nav-footer">
          <span>Normalized local snapshot</span>
          <small>Read-only surface</small>
        </div>
      </nav>
      <button className="nav-scrim" type="button" onClick={close} aria-label="Close navigation" />
    </>
  );
}
