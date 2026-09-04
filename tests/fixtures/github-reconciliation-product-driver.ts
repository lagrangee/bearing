import { rm } from "node:fs/promises";
import {
  captureProjectProviderScopes,
  rebuildProjectReadModel,
  reconcileProjectNative,
} from "../../src/project-read-model/provider-operations";
import { makeTemporaryDirectory } from "../helpers";
import {
  createReferenceGitHubFixtures,
  FixtureGitHubTransport,
  githubDeliveryIssue,
  githubMattProviderFactoryFor,
  githubSpecIssue,
  writeStandardGitHubMattProductRepository,
} from "./github-matt-api";

const root = await makeTemporaryDirectory("bearing-github-reconciliation-product-");
try {
  const { nativeScope } = await writeStandardGitHubMattProductRepository(root, {
    title: "GitHub delivery readback",
    intent: "Prove exact canonical URL reconciliation.",
    work: "- Complete the bound GitHub delivery.",
  });
  const providerFactory = githubMattProviderFactoryFor(
    new FixtureGitHubTransport(createReferenceGitHubFixtures()),
  );
  await rebuildProjectReadModel(root);
  await captureProjectProviderScopes(root, [nativeScope], { providerFactory });
  const result = await reconcileProjectNative(
    root,
    {
      binding: { provider: "matt-skills/v1", nativeScope },
      subjects: [githubSpecIssue.html_url, githubDeliveryIssue.html_url],
    },
    { providerFactory },
  );
  process.stdout.write(`${JSON.stringify(result)}\n`);
} finally {
  await rm(root, { recursive: true, force: true });
}
