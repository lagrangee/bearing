import { Icons } from "./icons";

export function GuidanceItem({
  detail,
  title,
}: {
  readonly detail: string;
  readonly title: string;
}) {
  return (
    <button className="guidance-item" type="button">
      <span className="guidance-mark" aria-hidden="true">
        <Icons.arrow />
      </span>
      <span>
        <strong>{title}</strong>
        <small>{detail}</small>
      </span>
      <span className="guidance-action">Continue</span>
    </button>
  );
}
