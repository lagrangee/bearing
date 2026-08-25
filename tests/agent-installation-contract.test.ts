import { expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { parseMarkdownDocument, queryMarkdownSection } from "../src/markdown-document";

const read = (path: string): Promise<string> => readFile(path, "utf8");

const sectionMarkdown = (source: string, title: string): string => {
  const section = queryMarkdownSection(parseMarkdownDocument(source), { title });
  if (section.state !== "found") throw new Error(`Expected one ${title} Markdown section.`);
  return section.value.markdown;
};

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
    expect(document).toContain("bearing update");
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
  for (const document of [cli, cliZh, gettingStarted, gettingStartedZh, agent, installedSkill]) {
    expect(document).toMatch(/update check|更新检查/iu);
    expect(document).toMatch(/separate(?:\s+Human)?\s+confirmation|单独\s*确认|独立\s*确认/iu);
  }
  for (const document of [cli, cliZh, agent, installedSkill]) {
    expect(document).toMatch(/Global Kit (?:Update|更新)[\s\S]*Repository Update/iu);
  }
});

test("installed Skill and public guidance describe target-driven repository updates", async () => {
  const [configure, update, cli, cliZh, troubleshooting, troubleshootingZh] = await Promise.all([
    read("skills/bearing/references/journeys/configure.md"),
    read("skills/bearing/references/journeys/update.md"),
    read("docs/cli.md"),
    read("docs/cli.zh-CN.md"),
    read("docs/troubleshooting.md"),
    read("docs/troubleshooting.zh-CN.md"),
  ]);

  expect(configure).toMatch(/schema 2[\s\S]*explicit `runtime`/iu);
  expect(configure).toMatch(/public Stable[\s\S]*`stable`/iu);
  expect(configure).toMatch(/Development Runtime[\s\S]*`development`/iu);
  expect(configure).toMatch(/Do not ask the Human[\s\S]*migration mode/iu);
  expect(update).toMatch(/Required target fields:[\s\S]*`schemaVersion`[\s\S]*`runtime`/iu);
  expect(update).toMatch(/Semantic invariants:[\s\S]*byte-for-byte/iu);
  expect(update).toMatch(/Bounded write domains:[\s\S]*\.bearing\/manifest\.json/iu);
  expect(update).toMatch(/one Human confirmation before any write/iu);
  expect(update).toMatch(/material source change invalidates the acceptance/iu);
  expect(update).toMatch(/zero provider acquisition[\s\S]*original functional operation/iu);
  expect(update).not.toMatch(/Supported source identities|Source repository 0\.1\.1/iu);

  expect(cli).toMatch(/schema 2[\s\S]*`runtime: stable`/iu);
  expect(cli).toMatch(/target contract[\s\S]*provenance[\s\S]*migration dispatch key/iu);
  expect(cliZh).toMatch(/schema 2[\s\S]*`runtime: stable`/iu);
  expect(cliZh).toMatch(/target contract[\s\S]*provenance[\s\S]*migration dispatch key/iu);
  for (const document of [troubleshooting, troubleshootingZh]) {
    expect(document).toMatch(/target contract[\s\S]*provenance[\s\S]*migration dispatch key/iu);
    expect(document).not.toMatch(/listed supported older Preview|列明支持的旧 Preview/iu);
  }
});

test("installed update guidance keeps unsafe and deactivated outcomes bounded and actionable", async () => {
  const [update, troubleshooting, troubleshootingZh] = await Promise.all([
    read("skills/bearing/references/journeys/update.md"),
    read("docs/troubleshooting.md"),
    read("docs/troubleshooting.zh-CN.md"),
  ]);

  const targetContract = sectionMarkdown(update, "Target contract");
  const operation = sectionMarkdown(update, "Operation");
  const after = sectionMarkdown(update, "After this operation");
  expect(targetContract).toMatch(/deactivated\s+target[\s\S]*no\s+active Project Read Model/iu);
  expect(operation).toMatch(/Reactivation[\s\S]*separate Repository Configuration/iu);
  expect(operation).toMatch(/Human declines[\s\S]*all repository bytes remain unchanged/iu);
  expect(operation).toMatch(/material source change[\s\S]*re-evaluate[\s\S]*confirmation/iu);
  expect(operation).toMatch(/new write scope[\s\S]*separate authority/iu);
  expect(operation).toMatch(
    /normal retry[\s\S]*scoped repair[\s\S]*without another confirmation/iu,
  );
  expect(operation).toMatch(/target\s+manifest remains valid[\s\S]*exact resumption point/iu);
  expect(after).toMatch(
    /corrupt[\s\S]*unreadable[\s\S]*unsafe[\s\S]*ambiguous[\s\S]*exact reason[\s\S]*no\s+repository bytes were written[\s\S]*case-specific next step/iu,
  );
  expect(after).toMatch(/newer repository[\s\S]*separately authorized Global Kit\s+Update/iu);

  for (const document of [troubleshooting, troubleshootingZh]) {
    const unsupported = sectionMarkdown(document, "Unsupported schema");
    expect(unsupported).toMatch(
      /Unsupported[\s\S]*(?:no\s+repository bytes were written|repository bytes\s+未被写入)/iu,
    );
    expect(unsupported).toMatch(/exact reason|准确原因/iu);
    expect(unsupported).toMatch(/next step|下一步/iu);
    expect(unsupported).not.toMatch(/source-version migration matrix|source-version 迁移矩阵/iu);
    expect(unsupported).not.toMatch(
      /repair (?:the )?(?:raw )?(?:SQLite|manifest)|修复 raw (?:SQLite|manifest)/iu,
    );
  }
});
