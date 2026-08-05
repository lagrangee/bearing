import { expect, test } from "bun:test";
import { realpath } from "node:fs/promises";
import { CatalogBusyError, CatalogRecoveryRequiredError } from "../src/catalog/errors";
import { createProjectMaterializer } from "../src/portal/project-materializer";
import { operationError } from "../src/portal/project-operation-error";
import { createProjectService } from "../src/portal/project-service";
import { authorizeWritesDirectly } from "../src/portal/project-write-executor";
import { createValidBearingRepo } from "./helpers";

const catalogFor = (repoRoot: string) => async () => ({
  state: "ready" as const,
  entries: [
    {
      entryId: "entry-project",
      displayName: "Fixture",
      repoRoot,
      availability: "available" as const,
    },
  ],
});

const catalogValidationFailures = [
  {
    name: "busy Catalog transaction",
    create: () => new CatalogBusyError(),
  },
  {
    name: "Catalog recovery requirement",
    create: () =>
      new CatalogRecoveryRequiredError(
        "Sensitive degraded Catalog detail at /private/internal/catalog.sqlite.",
      ),
  },
] as const;

test("normalizes Catalog recovery admission without exposing its detail", () => {
  expect(
    operationError(
      new CatalogRecoveryRequiredError(
        "Sensitive degraded Catalog detail at /private/internal/catalog.sqlite.",
      ),
    ),
  ).toEqual({
    code: "input-validation-failed",
    message: "Project inputs could not be validated.",
  });
});

for (const scenario of catalogValidationFailures) {
  test(`reports ${scenario.name} as fixed input validation failure`, async () => {
    const repoRoot = await realpath(await createValidBearingRepo());
    let materializerCalls = 0;
    const service = createProjectService({
      readCatalog: catalogFor(repoRoot),
      packageVersion: "0.0.0-test",
      materializer: {
        run: async () => {
          materializerCalls += 1;
          throw new Error("Materializer must not run before Catalog ownership validation.");
        },
      },
      operationExecutorFor: () => async () => {
        throw scenario.create();
      },
    });

    const result = await service.sync("entry-project", "force");

    expect(result).toMatchObject({
      kind: "failed",
      error: {
        code: "input-validation-failed",
        message: "Project inputs could not be validated.",
      },
    });
    expect(materializerCalls).toBe(0);
    expect(JSON.stringify(result)).not.toContain("/private/internal");
  });
}

test("keeps a real reconciliation failure classified by its materializer phase", async () => {
  const repoRoot = await realpath(await createValidBearingRepo());
  const materializer = createProjectMaterializer({
    packageVersion: "0.0.0-test",
    dependencies: {
      commit: async () => {
        throw new Error(`sensitive reconciliation detail at ${repoRoot}`);
      },
    },
  });
  const service = createProjectService({
    readCatalog: catalogFor(repoRoot),
    packageVersion: "0.0.0-test",
    materializer,
    operationExecutorFor: () => (operation) => operation(authorizeWritesDirectly),
  });

  const result = await service.sync("entry-project", "force");

  expect(result).toMatchObject({
    kind: "failed",
    error: {
      code: "sync-failed",
      message: "Project reconciliation failed.",
    },
  });
  expect(JSON.stringify(result)).not.toContain(repoRoot);
});
