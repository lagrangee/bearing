export type RuntimeReceipt = Readonly<{
  schemaVersion: 1;
  channel: "stable" | "development";
  runtimeIdentity: string;
  stateRootIdentity: string;
  buildIdentity?: string;
  sourceProvenance?: Readonly<{ gitHead: string; dirty: boolean }>;
  cliSha256?: string;
  portalBuildId?: string;
}>;

export type RuntimeExecutionContext = Readonly<{
  repositoryRoot: string;
  homeDir: string;
  projectReadModelPath: string;
  receipt: RuntimeReceipt;
}>;

let currentContext: RuntimeExecutionContext | undefined;

export const withRuntimeExecutionContext = async <Result>(
  context: RuntimeExecutionContext,
  operation: () => Promise<Result>,
): Promise<Result> => {
  const prior = currentContext;
  currentContext = context;
  try {
    return await operation();
  } finally {
    currentContext = prior;
  }
};

export const activeRuntimeExecutionContext = (
  repositoryRoot: string,
): RuntimeExecutionContext | undefined => {
  const context = currentContext;
  return context?.repositoryRoot === repositoryRoot ? context : undefined;
};

export const activeRuntimeContext = (): RuntimeExecutionContext | undefined => currentContext;
