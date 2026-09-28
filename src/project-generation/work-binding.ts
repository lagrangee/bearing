export const workBindingStateAllowsScopeInspection = (
  bindingState: Readonly<{ state: "bound" | "invalid" | "not-created"; reason?: string }>,
): boolean =>
  bindingState.state === "bound" ||
  (bindingState.state === "invalid" && bindingState.reason === "unresolved");
