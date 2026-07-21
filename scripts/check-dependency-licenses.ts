import { readFileSync } from "node:fs";
import { join } from "node:path";
import lockfile from "../package-lock.json";
import {
  type BundleDependencyMetadata,
  findBundleNoticeMismatches,
} from "./bundle-dependency-boundary";

type LockPackage = Readonly<{
  version?: string;
  license?: string;
  dev?: boolean;
}>;

type PackageLock = Readonly<{
  packages?: Record<string, LockPackage>;
}>;

const restrictedNames = new Set(["react-doctor", "deslop-js", "oxlint-plugin-react-doctor"]);
const acceptedLicenses = new Set([
  "0BSD",
  "Apache-2.0",
  "BSD-3-Clause",
  "ISC",
  "MIT",
  "MIT OR Apache-2.0",
  "MPL-2.0",
]);
const requiredNoticeMarkers = [
  "Copyright (c) 2022 - present, Yusuke Wada and Hono contributors",
  "Copyright (c) 2021 - present, Yusuke Wada and Hono contributors",
  "Copyright (c) Meta Platforms, Inc. and affiliates.",
  "Copyright (c) 2024-present VoidZero Inc. & Contributors",
  "Copyright (c) 2025 Colin McDonnell",
  "Copyright (c) 2026 Lucide Icons and Contributors",
  "Copyright Eemeli Aro <eemeli@gmail.com>",
  "Copyright (c) 2013-present Cole Bemis",
] as const;
const licenseOverrides = new Map([["@react-grab/cli@0.1.48", "MIT"]]);

const packages = (lockfile as PackageLock).packages ?? {};
const findings: string[] = [];
for (const [locator, metadata] of Object.entries(packages)) {
  const name = locator.split("node_modules/").pop();
  if (locator.length === 0 || name === undefined) continue;
  if (name !== undefined && restrictedNames.has(name)) {
    findings.push(`${name}@${metadata.version ?? "unknown"} remains in package-lock.json`);
  }
  const identity = `${name}@${metadata.version ?? "unknown"}`;
  const license = metadata.license ?? licenseOverrides.get(identity);
  if (license === undefined) findings.push(`${identity} has no verified license metadata`);
  else if (!acceptedLicenses.has(license))
    findings.push(`${identity} uses unaccepted license ${license}`);

  if (metadata.license === undefined && licenseOverrides.has(identity)) {
    const evidence = readFileSync(join(process.cwd(), locator, "LICENSE"), "utf8");
    if (!evidence.includes("MIT License"))
      findings.push(`${identity} license override lacks MIT evidence`);
  }
}

const notices = readFileSync(join(process.cwd(), "THIRD_PARTY_NOTICES"), "utf8");
const bundleMetadata = JSON.parse(
  readFileSync(join(process.cwd(), "dist/bundle-dependencies.json"), "utf8"),
) as BundleDependencyMetadata;
if (
  bundleMetadata.packages.length === 0 ||
  bundleMetadata.bundles.cli.moduleCount === 0 ||
  bundleMetadata.bundles.portal.moduleCount === 0
) {
  findings.push("bundle dependency metadata does not describe the built CLI and Portal graphs");
}
for (const dependency of bundleMetadata.packages) {
  const locked = packages[`node_modules/${dependency.name}`];
  if (
    locked?.version !== dependency.version ||
    locked.license !== dependency.license ||
    dependency.bundles.length === 0
  ) {
    findings.push(
      `bundle dependency metadata does not match package-lock.json: ${dependency.name}`,
    );
  }
}
findings.push(...findBundleNoticeMismatches(bundleMetadata, notices));
for (const marker of requiredNoticeMarkers) {
  if (!notices.includes(marker)) findings.push(`THIRD_PARTY_NOTICES is missing ${marker}`);
}

if (findings.length > 0) {
  throw new Error(`Dependency license check failed:\n${findings.join("\n")}`);
}

process.stdout.write("Dependency license check passed.\n");
