import { expect, test } from "bun:test";
import { discoverPlanningAuditInputs } from "../src/discovery";
import {
  decodeMattProviderConfiguration,
  mattProviderConfigurationSchema,
} from "../src/provider-configuration";
import {
  LOCAL_MATT_CONTRACT,
  LOCAL_MATT_TRIAGE_LABELS,
  makeTemporaryDirectory,
  writeFixture,
} from "./helpers";

test("uses one strict package-owned Matt Provider Configuration schema", async () => {
  const valid = {
    schemaVersion: 1,
    provider: "matt-skills/v1",
    contractLocator: "docs/agents/issue-tracker.md",
  } as const;
  expect(decodeMattProviderConfiguration(JSON.stringify(valid))).toEqual(valid);
  expect(
    mattProviderConfigurationSchema.safeParse({
      ...valid,
      contractLocator: "../outside.md",
    }).success,
  ).toBe(false);
  expect(
    mattProviderConfigurationSchema.safeParse({ ...valid, driver: "local-markdown" }).success,
  ).toBe(false);

  const root = await makeTemporaryDirectory("bearing-provider-configuration-");
  await writeFixture(
    root,
    ".bearing/provider.json",
    JSON.stringify({ ...valid, contractLocator: "../outside.md" }),
  );
  const discovery = await discoverPlanningAuditInputs(root);
  expect(discovery.inputs).toEqual([".bearing/provider.json"]);
  expect(discovery.inputs).not.toContain("../outside.md");

  const customRoot = await makeTemporaryDirectory("bearing-custom-provider-configuration-");
  const customContract = "config/matt/issue-tracker.md";
  const customTriage = "config/matt/triage-labels.md";
  await writeFixture(customRoot, customContract, LOCAL_MATT_CONTRACT);
  await writeFixture(customRoot, customTriage, LOCAL_MATT_TRIAGE_LABELS);
  await writeFixture(
    customRoot,
    ".bearing/provider.json",
    JSON.stringify({ ...valid, contractLocator: customContract }),
  );
  expect((await discoverPlanningAuditInputs(customRoot)).inputs).toEqual([
    ".bearing/provider.json",
    customContract,
    customTriage,
  ]);
});
