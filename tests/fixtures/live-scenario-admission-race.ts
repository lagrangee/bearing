import { mock } from "bun:test";
import { join } from "node:path";

type AdmissionInput = Parameters<
  typeof import("../../scripts/live-scenario-admission").prepareLiveScenarioGenerationAdmission
>[0];

const fs = { ...(await import("node:fs/promises")) };
const input = JSON.parse(await fs.readFile(process.argv[2] as string, "utf8")) as AdmissionInput;
const concurrent = process.argv[3] === "concurrent";
let creatorsAtMkdir = 0;
let releaseCreators = () => {};
const creatorsReady = new Promise<void>((resolve) => {
  releaseCreators = resolve;
});

// Keep filesystem interception in this child process, after the public precheck and before mkdir.
mock.module("node:fs/promises", () => ({
  ...fs,
  mkdir: async (...args: Parameters<typeof fs.mkdir>) => {
    if (args[0] === input.workspaceRoot) {
      if (concurrent) {
        creatorsAtMkdir += 1;
        if (creatorsAtMkdir === 2) releaseCreators();
        await creatorsReady;
      } else {
        await fs.mkdir(input.workspaceRoot);
        await fs.writeFile(join(input.workspaceRoot, "winner.txt"), "winner evidence\n");
      }
    }
    return fs.mkdir(...args);
  },
}));

const { prepareLiveScenarioGenerationAdmission } = await import(
  "../../scripts/live-scenario-admission"
);
const inputs = concurrent
  ? [input, { ...input, generationId: "22222222-2222-4222-8222-222222222222" }]
  : [input];
console.log(JSON.stringify(await Promise.all(inputs.map(prepareLiveScenarioGenerationAdmission))));
