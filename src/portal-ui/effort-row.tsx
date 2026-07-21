import { Icons } from "./icons";

export function EffortRow({
  fog,
  frontier,
  gate,
  lifecycle,
  onSelect,
  title,
}: {
  readonly fog?: number;
  readonly frontier: string;
  readonly gate: string;
  readonly lifecycle: string;
  readonly onSelect?: ((trigger: HTMLButtonElement) => void) | undefined;
  readonly title: string;
}) {
  return (
    <button
      className={`effort-row effort-${lifecycle}`}
      type="button"
      aria-label={`${title}, ${lifecycle}, Target Gate ${gate}, ${frontier}${fog === undefined ? "" : `, Fog ${fog}`}`}
      onClick={(event) => onSelect?.(event.currentTarget)}
    >
      <span className="effort-title">
        <i aria-hidden="true" />
        <span>
          <strong>{title}</strong>
          <small>{lifecycle}</small>
        </span>
      </span>
      <span>
        <small>Target Gate</small>
        <strong>{gate}</strong>
      </span>
      <span className="effort-frontier">
        <small>Frontier</small>
        <strong>{frontier}</strong>
      </span>
      {fog === undefined ? null : (
        <span className="effort-fog">
          <small>Fog</small>
          <strong>{fog}</strong>
        </span>
      )}
      <Icons.arrow aria-hidden="true" />
    </button>
  );
}
