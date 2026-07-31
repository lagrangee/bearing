import { z } from "zod";

const githubOwnerSchema = z.string().regex(/^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/u);
const githubRepositoryNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9._-]+$/u)
  .refine((value) => value !== "." && value !== "..");

const githubNativeScopeSchema = z.object({
  host: z.literal("github.com"),
  rootKind: z.enum(["wayfinder-map", "parent-issue", "standalone-request"]),
  repository: z.object({
    owner: githubOwnerSchema,
    name: githubRepositoryNameSchema,
    databaseId: z.string().min(1),
    nodeId: z.string().min(1),
  }),
  root: z.object({
    objectKind: z.enum(["issue", "pull-request"]),
    number: z.number().int().positive(),
    databaseId: z.string().min(1),
    nodeId: z.string().min(1),
  }),
});

export type GitHubMattNativeScope = Readonly<z.infer<typeof githubNativeScopeSchema>>;

const QUERY_KEYS = [
  "rootKind",
  "repositoryDatabaseId",
  "repositoryNodeId",
  "objectDatabaseId",
  "objectNodeId",
] as const;
const queryKeys = new Set<string>(QUERY_KEYS);

export const encodeGitHubMattNativeScope = (scope: GitHubMattNativeScope): string => {
  const value = githubNativeScopeSchema.parse(scope);
  const route = value.root.objectKind === "issue" ? "issues" : "pulls";
  const url = new URL(
    `github-matt-v1://github.com/${encodeURIComponent(value.repository.owner)}/${encodeURIComponent(
      value.repository.name,
    )}/${route}/${value.root.number}`,
  );
  url.searchParams.set("rootKind", value.rootKind);
  url.searchParams.set("repositoryDatabaseId", value.repository.databaseId);
  url.searchParams.set("repositoryNodeId", value.repository.nodeId);
  url.searchParams.set("objectDatabaseId", value.root.databaseId);
  url.searchParams.set("objectNodeId", value.root.nodeId);
  return url.toString();
};

export const githubMattNativeScopeIdentity = (scope: GitHubMattNativeScope): string =>
  `github:${scope.repository.nodeId}:${scope.root.nodeId}`;

export const decodeGitHubMattNativeScope = (value: string): GitHubMattNativeScope | undefined => {
  try {
    const url = new URL(value);
    if (url.protocol !== "github-matt-v1:" || url.hostname !== "github.com" || url.hash !== "") {
      return undefined;
    }
    const segments = url.pathname
      .split("/")
      .filter((segment) => segment !== "")
      .map(decodeURIComponent);
    if (segments.length !== 4) return undefined;
    const [owner, name, route, numberInput] = segments;
    const objectKind =
      route === "issues"
        ? ("issue" as const)
        : route === "pulls"
          ? ("pull-request" as const)
          : undefined;
    const number = Number(numberInput);
    if (
      owner === undefined ||
      name === undefined ||
      objectKind === undefined ||
      !Number.isInteger(number) ||
      number <= 0 ||
      [...url.searchParams.keys()].some((key) => !queryKeys.has(key)) ||
      QUERY_KEYS.some((key) => url.searchParams.getAll(key).length !== 1)
    ) {
      return undefined;
    }
    const decoded = githubNativeScopeSchema.parse({
      host: "github.com",
      rootKind: url.searchParams.get("rootKind"),
      repository: {
        owner,
        name,
        databaseId: url.searchParams.get("repositoryDatabaseId"),
        nodeId: url.searchParams.get("repositoryNodeId"),
      },
      root: {
        objectKind,
        number,
        databaseId: url.searchParams.get("objectDatabaseId"),
        nodeId: url.searchParams.get("objectNodeId"),
      },
    });
    return encodeGitHubMattNativeScope(decoded) === value ? decoded : undefined;
  } catch {
    return undefined;
  }
};
