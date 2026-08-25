import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const read = (path: string): Promise<string> => readFile(path, "utf8");

test("public READMEs give Humans one Agent-mediated installation entry and a terminal fallback", async () => {
  const [english, chinese] = await Promise.all([read("README.md"), read("README.zh-CN.md")]);

  expect(english).toContain("https://github.com/lagrangee/bearing");
  expect(english).toContain("[Agent installation guide](docs/agent-installation.md)");
  expect(english).toMatch(/Ask your Agent[\s\S]*Install Bearing/iu);
  expect(english).toMatch(/Terminal fallback[\s\S]*npx @lagrangee\/bearing/iu);
  expect(english).toContain("@<resolved-version> install");
  expect(english).not.toMatch(/maintenance wizard/iu);
  expect(english).not.toMatch(/Install[／/,、 ]+Update[／/,、 ]+Repair/iu);

  expect(chinese).toContain("https://github.com/lagrangee/bearing");
  expect(chinese).toContain("[Agent 安装指南](docs/agent-installation.md)");
  expect(chinese).toMatch(/让你的 Agent[\s\S]*安装 Bearing/u);
  expect(chinese).toMatch(/Terminal fallback[\s\S]*npx @lagrangee\/bearing/iu);
  expect(chinese).toContain("@<resolved-version> install");
  expect(chinese).not.toMatch(/maintenance wizard/iu);
  expect(chinese).not.toMatch(/Install[／/,、 ]+Update[／/,、 ]+Repair/iu);
});

test("Agent guidance owns complete package installation, Skill Directory integration, and setup handoff", async () => {
  const guidance = await read("docs/agent-installation.md");

  expect(guidance).toContain("https://github.com/lagrangee/bearing");
  expect(guidance).toContain("npm view @lagrangee/bearing@latest");
  expect(guidance).toContain("npx --yes @lagrangee/bearing@<resolved-version> install");
  expect(guidance).toMatch(/published package[\s\S]*complete[\s\S]*canonical bundle/iu);
  expect(guidance).toMatch(/do not[\s\S]*(?:clone|mutable)[\s\S]*main/iu);
  expect(guidance).toMatch(/Skill Directory[\s\S]*symbolic link/iu);
  expect(guidance).toContain("~/.agents/skills");
  expect(guidance).toContain("~/.claude/skills");
  expect(guidance).toContain("~/.workbuddy/skills");
  expect(guidance).toMatch(/user-created copies[\s\S]*unsupported unmanaged[\s\S]*integration/iu);
  expect(guidance).not.toMatch(/hard copy[\s\S]*refresh[\s\S]*cleanup/iu);
  expect(guidance).toMatch(/does not[\s\S]*configure[\s\S]*repository/iu);
  expect(guidance).toMatch(/does not[\s\S]*start[\s\S]*Portal/iu);
  expect(guidance).toMatch(/does not[\s\S]*planning objects/iu);
  expect(guidance).toContain("git rev-parse --is-inside-work-tree");
  expect(guidance).toMatch(/Human confirms[\s\S]*explicitly load[\s\S]*Bearing skill/iu);
  expect(guidance).toContain("/bearing setup");
});

test("public installation guidance describes the same explicit basic CLI contract", async () => {
  const paths = [
    "docs/cli.md",
    "docs/cli.zh-CN.md",
    "docs/getting-started.md",
    "docs/getting-started.zh-CN.md",
    "docs/troubleshooting.md",
    "docs/troubleshooting.zh-CN.md",
    "docs/agent-installation.md",
  ];
  const documents = await Promise.all(paths.map(read));
  const installedSkill = await read("skills/bearing/SKILL.md");

  for (const [index, document] of [...documents, installedSkill].entries()) {
    expect(document).not.toContain("--confirm-downgrade");
    expect(document).not.toMatch(/maintenance wizard/iu);
    expect(document).not.toMatch(/Install[／/,、 ]+Update[／/,、 ]+Repair/iu);
    expect(document).not.toMatch(/hard copy[\s\S]*refresh/iu);
    if (index < 6) expect(document).toContain("bearing install");
  }

  const [cli, cliZh, gettingStarted, gettingStartedZh, troubleshooting, troubleshootingZh, agent] =
    documents;
  for (const document of [cli, cliZh, troubleshooting, troubleshootingZh]) {
    expect(document).toContain("bearing uninstall");
    expect(document).toContain('export PATH="$HOME/.bearing/bin:$PATH"');
  }
  for (const document of [gettingStarted, gettingStartedZh]) {
    expect(document).toMatch(/[Bb]are `bearing`|裸 `bearing`/u);
    expect(document).toMatch(/help/u);
  }
  expect(agent).toMatch(/Current Kit\s+Unverifiable/u);
  expect(agent).toContain("bearing uninstall");
  expect(agent).toContain("Fresh Install");
  for (const document of [cli, cliZh, troubleshooting, troubleshootingZh, agent]) {
    expect(document).toMatch(/workbuddy/iu);
  }
});
