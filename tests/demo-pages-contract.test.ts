import { expect, test } from "bun:test";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { parse } from "yaml";

const repoRoot = join(import.meta.dirname, "..");
const vite = join(repoRoot, "node_modules/vite/bin/vite.js");

const readTree = async (root: string): Promise<Readonly<Record<string, string>>> => {
  const files: Record<string, string> = {};
  const visit = async (directory: string): Promise<void> => {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile()) {
        files[relative(root, path)] = createHash("sha256")
          .update(await readFile(path))
          .digest("hex");
      }
    }
  };
  await visit(root);
  return files;
};

const buildDemo = (outDir: string): void => {
  const result = spawnSync(
    "node",
    [vite, "build", "demo", "--base", "/bearing/", "--outDir", outDir, "--emptyOutDir"],
    { cwd: repoRoot, encoding: "utf8" },
  );
  if (result.status !== 0) {
    throw new Error(`Vite demo build failed:\n${result.stdout}\n${result.stderr}`);
  }
};

test("the demo exposes one deterministic production Pages build command", async () => {
  const packageMetadata = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
    readonly scripts?: Readonly<Record<string, string>>;
  };
  expect(packageMetadata.scripts?.["demo:build"]).toBe(
    "vite build demo --base /bearing/ --outDir ../pages-artifact --emptyOutDir",
  );

  const root = await mkdtemp(join(tmpdir(), "bearing-demo-pages-"));
  const first = join(root, "first");
  const second = join(root, "second");
  try {
    buildDemo(first);
    buildDemo(second);
    const firstTree = await readTree(first);
    expect(firstTree).toEqual(await readTree(second));
    const paths = Object.keys(firstTree).sort();
    expect(paths).toHaveLength(3);
    expect(paths).toContain("index.html");
    expect(paths.filter((path) => /^assets\/index-[\w-]+\.css$/u.test(path))).toHaveLength(1);
    expect(paths.filter((path) => /^assets\/index-[\w-]+\.js$/u.test(path))).toHaveLength(1);
    expect(await readFile(join(first, "index.html"), "utf8")).not.toContain("@vite/client");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("the Pages workflow validates pull requests and deploys only the verified main artifact", async () => {
  const source = await readFile(join(repoRoot, ".github/workflows/demo-pages.yml"), "utf8");
  const workflow = parse(source) as {
    readonly on: {
      readonly pull_request: { readonly branches: readonly string[] };
      readonly push: { readonly branches: readonly string[] };
    };
    readonly permissions: Readonly<Record<string, unknown>>;
    readonly jobs: Readonly<Record<string, unknown>>;
  };
  expect(workflow.on.pull_request.branches).toEqual(["main"]);
  expect(workflow.on.push.branches).toEqual(["main"]);
  expect(workflow.permissions).toEqual({});

  const validate = workflow.jobs["validate"] as {
    readonly permissions: Readonly<Record<string, string>>;
    readonly steps: readonly Readonly<Record<string, unknown>>[];
  };
  expect(validate.permissions).toEqual({ contents: "read" });
  expect(validate.steps.some((step) => step["run"] === "bun run demo:verify")).toBe(true);
  expect(validate.steps).toContainEqual(
    expect.objectContaining({
      if: "github.event_name == 'push' && github.ref == 'refs/heads/main'",
      uses: "actions/upload-pages-artifact@fc324d3547104276b827a68afc52ff2a11cc49c9",
      with: { path: "pages-artifact" },
    }),
  );

  const deploy = workflow.jobs["deploy"] as {
    readonly needs: string;
    readonly if: string;
    readonly permissions: Readonly<Record<string, string>>;
    readonly concurrency: Readonly<Record<string, unknown>>;
    readonly steps: readonly Readonly<Record<string, unknown>>[];
  };
  expect(deploy.needs).toBe("validate");
  expect(deploy.if).toBe("github.event_name == 'push' && github.ref == 'refs/heads/main'");
  expect(deploy.permissions).toEqual({ pages: "write", "id-token": "write" });
  expect(deploy.concurrency).toEqual({ group: "github-pages", "cancel-in-progress": false });
  expect(deploy.steps).toEqual([
    {
      name: "Deploy verified artifact",
      id: "deployment",
      uses: "actions/deploy-pages@cd2ce8fcbc39b97be8ca5fce6e763baed58fa128",
    },
  ]);
});

test("the demo verification command proves the package exclusion boundary", async () => {
  const packageMetadata = JSON.parse(await readFile(join(repoRoot, "package.json"), "utf8")) as {
    readonly scripts?: Readonly<Record<string, string>>;
    readonly files?: readonly string[];
  };
  expect(packageMetadata.scripts?.["demo:verify"]).toBe(
    "bun run build && bun run demo:build && bun test tests/demo-pages-contract.test.ts && playwright test --config browser-tests/demo-pages.playwright.config.ts && bun run package:check",
  );
  expect(packageMetadata.files).not.toContain("demo");
  expect(packageMetadata.files).not.toContain("pages-artifact");
  expect(packageMetadata.files).not.toContain(".github");

  const npmCache = await mkdtemp(join(tmpdir(), "bearing-demo-npm-cache-"));
  try {
    const pack = spawnSync("npm", ["pack", "--dry-run", "--json", "--ignore-scripts"], {
      cwd: repoRoot,
      encoding: "utf8",
      env: { ...process.env, npm_config_cache: npmCache },
    });
    expect(pack.status).toBe(0);
    const [{ files }] = JSON.parse(pack.stdout) as [
      { readonly files: readonly { path: string }[] },
    ];
    const packagedPaths = files.map((file) => file.path);
    expect(
      packagedPaths.filter(
        (path) =>
          path.startsWith("demo/") ||
          path.startsWith("pages-artifact/") ||
          path.startsWith(".github/workflows/demo-pages"),
      ),
    ).toEqual([]);
  } finally {
    await rm(npmCache, { recursive: true, force: true });
  }
});

test("the Pages browser gate runs every delivered demo contract against one artifact", async () => {
  const config = await readFile(
    join(repoRoot, "browser-tests/demo-pages.playwright.config.ts"),
    "utf8",
  );
  for (const spec of [
    "demo-overview.pw.ts",
    "demo-outcome-spine.pw.ts",
    "demo-attention-audit.pw.ts",
    "demo-assets-lineage.pw.ts",
    "demo-project-find.pw.ts",
    "demo-governance-walkthrough.pw.ts",
    "demo-pages.pw.ts",
  ]) {
    expect(config).toContain(spec);
  }
});

test("the demo footer uses the existing visual system without a one-off underline offset", async () => {
  const styles = await readFile(join(repoRoot, "demo/styles.css"), "utf8");
  expect(styles).not.toContain("text-underline-offset: 3px");
});

test("the public docs keep the browser sample separate from the supported local Portal", async () => {
  for (const path of ["README.md", "README.zh-CN.md", "SECURITY.md"]) {
    const source = await readFile(join(repoRoot, path), "utf8");
    expect(source).toContain("browser-only");
    expect(source).toContain("mock");
    expect(source).toContain("docs/data-and-security");
  }
});
