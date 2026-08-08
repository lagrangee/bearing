import { expect, test } from "bun:test";
import {
  projectSnapshotEnvelopeSchema as serverSnapshotSchema,
  projectSyncEnvelopeSchema as serverSyncSchema,
} from "../src/portal/project-contract";
import {
  projectSnapshotEnvelopeSchema as browserSnapshotSchema,
  projectSyncEnvelopeSchema as browserSyncSchema,
} from "../src/portal-project-wire";

test("server and browser consume the same Project v1 runtime contract", () => {
  expect(serverSnapshotSchema).toBe(browserSnapshotSchema);
  expect(serverSyncSchema).toBe(browserSyncSchema);
});
