export type ReleaseJsonProvider = "npm" | "github";

export const releaseJsonHeaders = (
  provider: ReleaseJsonProvider,
  githubToken?: string,
): Headers => {
  const headers = new Headers({
    Accept: provider === "github" ? "application/vnd.github+json" : "application/json",
  });
  if (provider === "github") {
    headers.set("X-GitHub-Api-Version", "2022-11-28");
    if (githubToken !== undefined) headers.set("Authorization", `Bearer ${githubToken}`);
  }
  return headers;
};
