export const ASSET_STATUS_FILTERS = [
  { value: "current", label: "Current" },
  { value: "replaced", label: "Replaced" },
  { value: "archived", label: "Archived" },
  { value: "all", label: "All" },
] as const;

export type AssetStatusFilter = (typeof ASSET_STATUS_FILTERS)[number]["value"];

const values = new Set<string>(ASSET_STATUS_FILTERS.map((filter) => filter.value));

export const isAssetStatusFilter = (value: unknown): value is AssetStatusFilter =>
  typeof value === "string" && values.has(value);
