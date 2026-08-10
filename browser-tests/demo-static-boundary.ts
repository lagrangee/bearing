interface StaticRequest {
  readonly method: string;
  readonly url: string;
}

const viteEnvironmentPath = new URL("../node_modules/vite/dist/client/env.mjs", import.meta.url)
  .pathname;
const staticPaths = new Set([
  `/bearing/@fs${viteEnvironmentPath}`,
  "/bearing/@vite/client",
  "/bearing/",
  "/bearing/app.js",
  "/bearing/mock-data.js",
  "/bearing/styles.css",
]);
const productionAsset = /^\/bearing\/assets\/index-[\w-]+\.(?:css|js)$/u;

export const unexpectedStaticRequests = (
  requests: readonly StaticRequest[],
  expectedOrigin: string,
): readonly StaticRequest[] =>
  requests.filter(({ method, url }) => {
    const requestUrl = new URL(url);
    return (
      method !== "GET" ||
      requestUrl.origin !== expectedOrigin ||
      (!staticPaths.has(requestUrl.pathname) && !productionAsset.test(requestUrl.pathname))
    );
  });
