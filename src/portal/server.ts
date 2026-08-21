import { randomBytes } from "node:crypto";
import type { AddressInfo } from "node:net";
import { serve } from "@hono/node-server";
import { readCatalog } from "../catalog/probe";
import type { DevelopmentRuntimeHealthIdentity } from "../development-portal-health";
import { createPortalApp } from "./app";
import { loadPortalAssets } from "./assets";

export type RunningPortalServer = Readonly<{
  url: string;
  close(): Promise<void>;
}>;

export const startPortalServer = async (options: {
  readonly packageRoot: string;
  readonly packageVersion: string;
  readonly homeDir: string;
  readonly port: number;
  readonly sessionSecret?: string;
  readonly developmentRuntimeIdentity?: DevelopmentRuntimeHealthIdentity;
}): Promise<RunningPortalServer> => {
  const assets = await loadPortalAssets(options.packageRoot, options.packageVersion);
  const app = createPortalApp({
    assets,
    sessions: {
      secret: options.sessionSecret ?? randomBytes(32).toString("base64url"),
    },
    readCatalog: () => readCatalog({ homeDir: options.homeDir }),
    ...(options.developmentRuntimeIdentity === undefined
      ? {}
      : { developmentRuntimeIdentity: options.developmentRuntimeIdentity }),
  });

  let resolveListening: ((address: AddressInfo) => void) | undefined;
  let rejectListening: ((error: Error) => void) | undefined;
  const listening = new Promise<AddressInfo>((resolve, reject) => {
    resolveListening = resolve;
    rejectListening = reject;
  });
  const server = serve(
    {
      fetch: app.fetch,
      hostname: "127.0.0.1",
      port: options.port,
    },
    (address) => resolveListening?.(address),
  );
  server.once("error", (error) => rejectListening?.(error));

  let address: AddressInfo;
  try {
    address = await listening;
  } catch (error) {
    server.close();
    throw new Error("Bearing Portal could not bind the loopback Host.", { cause: error });
  }
  let closed = false;
  return Object.freeze({
    url: `http://127.0.0.1:${address.port}`,
    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      await new Promise<void>((resolve, reject) => {
        server.close((error) => (error === undefined ? resolve() : reject(error)));
      });
    },
  });
};
