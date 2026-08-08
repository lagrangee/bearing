const labels = {
  audit: "Planning Audit",
} as const;

export function ProjectDestinationPlaceholder({ section }: { readonly section: "audit" }) {
  return (
    <div className="page destination-placeholder">
      <p className="eyebrow">Project destination</p>
      <h1>{labels[section]}</h1>
      <p>This destination will use the same current Project Read Model generation.</p>
    </div>
  );
}
