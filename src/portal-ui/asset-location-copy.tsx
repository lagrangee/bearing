import { useState } from "react";

export function AssetLocationCopy({
  className,
  label,
  value,
}: {
  readonly className?: string | undefined;
  readonly label: string;
  readonly value: string;
}) {
  const [result, setResult] = useState<
    Readonly<{ value: string; status: "copied" | "failed" }> | undefined
  >();
  const status = result?.value === value ? result.status : "idle";
  return (
    <div className={`asset-location-copy${className === undefined ? "" : ` ${className}`}`}>
      <button
        className="action"
        type="button"
        onClick={() => {
          void navigator.clipboard
            .writeText(value)
            .then(() => setResult({ value, status: "copied" }))
            .catch(() => setResult({ value, status: "failed" }));
        }}
      >
        {label}
      </button>
      <span role="status">
        {status === "copied"
          ? "Asset Location copied."
          : status === "failed"
            ? "Asset Location could not be copied."
            : ""}
      </span>
    </div>
  );
}
