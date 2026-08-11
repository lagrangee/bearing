import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";

const read = (path: string): Promise<string> => readFile(path, "utf8");

test("public READMEs give Humans one Agent-mediated installation entry and a terminal fallback", async () => {
  const [english, chinese] = await Promise.all([read("README.md"), read("README.zh-CN.md")]);

  expect(english).toContain("https://github.com/lagrangee/bearing");
  expect(english).toContain("[Agent installation guide](docs/agent-installation.md)");
  expect(english).toMatch(/Ask your Agent[\s\S]*Install Bearing/iu);
  expect(english).toMatch(/Terminal fallback[\s\S]*npx @lagrangee\/bearing/iu);

  expect(chinese).toContain("https://github.com/lagrangee/bearing");
  expect(chinese).toContain("[Agent 安装指南](docs/agent-installation.md)");
  expect(chinese).toMatch(/让你的 Agent[\s\S]*安装 Bearing/u);
  expect(chinese).toMatch(/Terminal fallback[\s\S]*npx @lagrangee\/bearing/iu);
});

test("Agent guidance owns complete package installation, Skill Directory integration, and setup handoff", async () => {
  const guidance = await read("docs/agent-installation.md");

  expect(guidance).toContain("https://github.com/lagrangee/bearing");
  expect(guidance).toContain("npm view @lagrangee/bearing@latest");
  expect(guidance).toContain("npx --yes @lagrangee/bearing@<resolved-version> install");
  expect(guidance).toMatch(/published package[\s\S]*complete[\s\S]*canonical bundle/iu);
  expect(guidance).toMatch(/do not[\s\S]*(?:clone|mutable)[\s\S]*main/iu);
  expect(guidance).toMatch(/Skill Directory[\s\S]*symbolic link/iu);
  expect(guidance).toMatch(/hard copy[\s\S]*refresh[\s\S]*cleanup/iu);
  expect(guidance).toMatch(/does not[\s\S]*configure[\s\S]*repository/iu);
  expect(guidance).toMatch(/does not[\s\S]*start[\s\S]*Portal/iu);
  expect(guidance).toMatch(/does not[\s\S]*planning objects/iu);
  expect(guidance).toContain("git rev-parse --is-inside-work-tree");
  expect(guidance).toMatch(/Human confirms[\s\S]*explicitly load[\s\S]*Bearing skill/iu);
  expect(guidance).toContain("/bearing setup");
  expect(guidance).not.toMatch(/\b(?:Codex|Claude|WorkBuddy)\b/u);
});
