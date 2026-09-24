import { expect, test } from "bun:test";
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("installed product fixtures package built bytes without re-running build lifecycle", async () => {
  const root = await mkdtemp(join(tmpdir(), "bearing-prebuilt-fixture-"));
  const cliSource = "#!/usr/bin/env node\nconsole.log('prebuilt');\n";
  const run = async (args: readonly string[]) => {
    const child = Bun.spawn([...args], {
      cwd: root,
      env: { ...process.env, npm_config_ignore_scripts: "false" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect(exitCode, stderr).toBe(0);
    return stdout;
  };
  try {
    await mkdir(join(root, "dist"));
    await writeFile(join(root, "dist/cli.js"), cliSource);
    await chmod(join(root, "dist/cli.js"), 0o755);
    await writeFile(
      join(root, "package.json"),
      JSON.stringify({
        name: "bearing-prebuilt-fixture",
        version: "1.0.0",
        bin: { bearing: "dist/cli.js" },
        files: ["dist/cli.js"],
        scripts: { prepack: "node rebuild.cjs" },
      }),
    );
    await writeFile(
      join(root, "rebuild.cjs"),
      "require('node:fs').writeFileSync('dist/cli.js', \"#!/usr/bin/env node\\nconsole.log('rebuilt');\\n\");\n",
    );
    await run(["git", "init", "--quiet"]);
    await run(["git", "add", "."]);
    await run([
      "git",
      "-c",
      "user.name=Bearing Test",
      "-c",
      "user.email=test@example.invalid",
      "commit",
      "--quiet",
      "-m",
      "prebuilt fixture",
    ]);
    const helperPath = join(import.meta.dirname, "product-seams/installed-product.ts");
    const output = await run([
      "bun",
      "--eval",
      `import { installPackedProduct } from ${JSON.stringify(helperPath)};
       const product = await installPackedProduct();
       try { console.log(JSON.stringify(await product.run([]))); }
       finally { await product.dispose(); }`,
    ]);
    expect(JSON.parse(output)).toMatchObject({ exitClass: "success", stdout: "prebuilt\n" });
    expect(await readFile(join(root, "dist/cli.js"), "utf8")).toBe(cliSource);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
