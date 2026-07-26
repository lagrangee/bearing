import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import packageMetadata from "../package.json";
import { assertCanonicalPackageBoundary, assertPackagedReadmeTargets } from "./release-boundary";

const expectedFiles = [
  "dist",
  "docs/cli.md",
  "docs/cli.zh-CN.md",
  "docs/data-and-security.md",
  "docs/data-and-security.zh-CN.md",
  "docs/everyday-workflows.md",
  "docs/everyday-workflows.zh-CN.md",
  "docs/getting-started.md",
  "docs/getting-started.zh-CN.md",
  "docs/troubleshooting.md",
  "docs/troubleshooting.zh-CN.md",
  "skills",
  "README.md",
  "README.zh-CN.md",
  "CHANGELOG.md",
  "LICENSE",
  "THIRD_PARTY_NOTICES",
  "SECURITY.md",
  "CONTRIBUTING.md",
  "CODE_OF_CONDUCT.md",
];

const disallowedPackageFields = ["main", "module", "browser", "exports", "types", "typings"];
const requiredKeywords = [
  "agent-skills",
  "codex",
  "claude-code",
  "project-governance",
  "local-first",
];

const fail = (message: string): never => {
  throw new Error(message);
};

if (packageMetadata.name !== "@lagrangee/bearing") fail("package name must be @lagrangee/bearing");
if (packageMetadata.license !== "MIT") fail("package license must be MIT");
if (packageMetadata.author !== "lagrangee") fail("package author must be lagrangee");
if (packageMetadata.engines?.node !== ">=22") {
  fail("package engines.node must be >=22");
}
if (JSON.stringify(packageMetadata.bin) !== JSON.stringify({ bearing: "dist/cli.js" })) {
  fail("package bin must expose only bearing -> dist/cli.js");
}
for (const field of disallowedPackageFields) {
  if (Object.hasOwn(packageMetadata, field))
    fail(`package must not declare public JS API field: ${field}`);
}
if (JSON.stringify(packageMetadata.files) !== JSON.stringify(expectedFiles)) {
  fail(`package files allowlist mismatch: ${JSON.stringify(packageMetadata.files)}`);
}
for (const keyword of requiredKeywords) {
  if (!packageMetadata.keywords?.includes(keyword)) fail(`missing package keyword: ${keyword}`);
}

const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
  encoding: "utf8",
});
if (pack.status !== 0) fail(`npm pack --dry-run failed:\n${pack.stderr}`);
const [{ files }] = JSON.parse(pack.stdout) as [{ files: { path: string }[] }];
const paths = files.map((file) => file.path).sort();
assertCanonicalPackageBoundary(paths);
assertPackagedReadmeTargets(
  paths,
  await Promise.all([readFile("README.md", "utf8"), readFile("README.zh-CN.md", "utf8")]),
);

process.stdout.write("Package boundary check passed.\n");
