export const dependencyLicenseOverrides: ReadonlyMap<string, string> = new Map([
  ["@react-grab/cli@0.1.48", "MIT"],
  ["format@0.2.2", "MIT"],
]);

export const dependencyLicenseFor = (
  name: string,
  version: string | undefined,
  declaredLicense: string | undefined,
): string | undefined =>
  declaredLicense ??
  (version === undefined ? undefined : dependencyLicenseOverrides.get(`${name}@${version}`));
