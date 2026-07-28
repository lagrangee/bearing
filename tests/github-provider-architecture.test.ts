import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const assertNoNativeMutationCredentialOrLogCapability = (source: string): void => {
  expect(source).not.toMatch(/["'](?:POST|PATCH|PUT|DELETE)["']/u);
  expect(source).not.toMatch(
    /\bgh\s+(?:issue|pr)\s+(?:create|edit|comment|close|reopen|review|merge)\b/u,
  );
  expect(source).not.toMatch(
    /["'](?:issue|pr)["']\s*,\s*["'](?:create|edit|comment|close|reopen|review|merge)["']/u,
  );
  expect(source).not.toMatch(/["'](?:graphql|--field|--raw-field|--input|-f|-F)["']/u);
  expect(source).not.toMatch(/\bmutation\s*(?:[({]|[A-Za-z_])/u);
  expect(source).not.toMatch(
    /\b(?:writeFile|appendFile|mkdir|rename|unlink|rm|createWriteStream)\s*\(/u,
  );
  expect(source).not.toMatch(
    /\b(?:GH_TOKEN|GITHUB_TOKEN|Authorization|oauth_token|credential-store)\b/u,
  );
  expect(source).not.toMatch(/\bconsole\.(?:debug|error|info|log|warn)\s*\(/u);
  expect(source).not.toMatch(/\bprocess\.(?:stdout|stderr)\.write\s*\(/u);
};

test("keeps GitHub capture provider-internal, read-only and behind shared boundaries", async () => {
  const source = await readFile("src/providers/matt-skills-v1/github.ts", "utf8");
  const responseBoundary = await readFile(
    "src/providers/matt-skills-v1/github-cli-response.ts",
    "utf8",
  );
  const packageDocument = JSON.parse(await readFile("package.json", "utf8")) as {
    devDependencies?: Readonly<Record<string, string>>;
  };

  expect(source).toContain('from "../../markdown-document"');
  expect(source).toContain("parseMarkdownDocument");
  expect(source).not.toMatch(/from\s+["'](?:mdast|mdast-util-|micromark|unist)/u);

  expect(source).toContain("execFile(\n      command,\n      [...args]");
  expect(source).toContain('"--method"');
  expect(source).toContain('"GET"');
  expect(source).toContain('"--hostname"');
  expect(source).toContain('"github.com"');
  expect(source).toContain("createGhCliGitHubReadTransport");
  assertNoNativeMutationCredentialOrLogCapability(source);
  expect(source).toContain('from "./github-cli-response"');
  expect(source).not.toContain('from "parse-headers"');
  expect(responseBoundary).toContain('from "parse-headers"');
  expect(source).toContain('from "safe-stable-stringify"');
  expect(packageDocument.devDependencies?.["parse-headers"]).toBe("^2.0.6");
  expect(packageDocument.devDependencies?.["safe-stable-stringify"]).toBe("^2.5.0");
});

test("keeps every Matt provider module free of native mutation and credential ownership", async () => {
  const files = [
    ...new Bun.Glob("src/providers/matt-skills-v1/**/*.ts").scanSync({
      cwd: process.cwd(),
      onlyFiles: true,
    }),
  ].sort();
  expect(files).toContain("src/providers/matt-skills-v1/github-cli-response.ts");
  expect(files).toContain("src/providers/matt-skills-v1/github.ts");
  expect(files).toContain("src/providers/matt-skills-v1/local-markdown.ts");
  const sources = await Promise.all(files.map((file) => readFile(file, "utf8")));
  const completeSource = sources.join("\n");
  assertNoNativeMutationCredentialOrLogCapability(completeSource);
  expect(completeSource.match(/from\s+["']node:child_process["']/gu)).toHaveLength(1);
  expect(completeSource.match(/\bexecFile\s*\(/gu)).toHaveLength(1);
  expect(completeSource).not.toMatch(/(?<![.\w])(?:exec|execSync|spawn|spawnSync|fork)\s*\(/u);
  expect(completeSource).not.toMatch(/\bBun\.spawn(?:Sync)?\s*\(/u);
  expect(completeSource.match(/\bexecute\s*\(\s*["']gh["']/gu)).toHaveLength(1);
  expect(completeSource.match(/["']--method["']/gu)).toHaveLength(1);
  expect(completeSource).toContain(
    'const args = [\n        "api",\n        "--method",\n        "GET",',
  );
});
