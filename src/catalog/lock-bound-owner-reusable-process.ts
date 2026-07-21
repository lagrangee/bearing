import { spawn } from "node:child_process";
import type { Readable, Writable } from "node:stream";
import { CatalogLockRecoveryError } from "./errors";
import { BOUND_LOCK_CHILD } from "./lock-bound-owner-child";
import {
  BoundLockMutationError,
  BoundLockReservationError,
  type ChildRequest,
  type SuccessfulChildReply,
} from "./lock-bound-owner-contract";

type PendingRequest = Readonly<{
  reservation: boolean;
  resolve: (reply: SuccessfulChildReply) => void;
  reject: (error: Error) => void;
}>;
type RefableStream = Readable | Writable;
type ActiveHelper = {
  child: ReturnType<typeof spawn>;
  input: Writable;
  output: Readable;
  pending: Map<number, PendingRequest>;
  nextId: number;
  buffer: string;
  idleTimer: ReturnType<typeof setTimeout> | undefined;
  forceTimer: ReturnType<typeof setTimeout> | undefined;
  settleTimer: ReturnType<typeof setTimeout> | undefined;
  failureStarted: boolean;
  settled: boolean;
  failureCause: unknown;
};
type HelperEnvelope = Readonly<{
  id: number;
  reply: SuccessfulChildReply | Readonly<{ state: "error"; committed: boolean }>;
}>;

const MAX_HELPERS = 4;
const IDLE_TIMEOUT_MS = 250;
const FORCE_CLOSE_MS = 100;
const SETTLE_TIMEOUT_MS = 1_000;
const active = new Set<ActiveHelper>();

const failure = (reservation: boolean, committed: boolean, cause?: unknown): Error =>
  reservation
    ? new BoundLockReservationError(committed, cause === undefined ? undefined : { cause })
    : new BoundLockMutationError(committed, cause === undefined ? undefined : { cause });

const setReferenced = (helper: ActiveHelper, referenced: boolean): void => {
  const operation = referenced ? "ref" : "unref";
  helper.child[operation]();
  (helper.input as RefableStream & Record<typeof operation, () => void>)[operation]?.();
  (helper.output as RefableStream & Record<typeof operation, () => void>)[operation]?.();
};

const settleHelper = (helper: ActiveHelper): void => {
  if (helper.settled) return;
  helper.settled = true;
  if (helper.idleTimer !== undefined) {
    clearTimeout(helper.idleTimer);
    helper.idleTimer = undefined;
  }
  if (helper.forceTimer !== undefined) clearTimeout(helper.forceTimer);
  if (helper.settleTimer !== undefined) clearTimeout(helper.settleTimer);
  active.delete(helper);
  setReferenced(helper, false);
  for (const request of helper.pending.values()) {
    request.reject(failure(request.reservation, true, helper.failureCause));
  }
  helper.pending.clear();
};

const failHelper = (helper: ActiveHelper, cause?: unknown): void => {
  if (helper.settled) return;
  if (!helper.failureStarted) {
    helper.failureStarted = true;
    helper.failureCause = cause;
  }
  if (helper.idleTimer !== undefined) {
    clearTimeout(helper.idleTimer);
    helper.idleTimer = undefined;
  }
  active.delete(helper);
  if (helper.child.exitCode !== null || helper.child.signalCode !== null) {
    settleHelper(helper);
    return;
  }
  try {
    helper.child.kill();
  } catch (killCause) {
    if (!(killCause instanceof Error)) throw killCause;
    if (helper.failureCause === undefined) helper.failureCause = killCause;
  }
  if (helper.forceTimer === undefined) {
    helper.forceTimer = setTimeout(() => {
      try {
        helper.child.kill("SIGKILL");
      } catch (killCause) {
        if (!(killCause instanceof Error)) throw killCause;
        if (helper.failureCause === undefined) helper.failureCause = killCause;
      }
    }, FORCE_CLOSE_MS);
  }
  if (helper.settleTimer === undefined) {
    helper.settleTimer = setTimeout(() => settleHelper(helper), SETTLE_TIMEOUT_MS);
  }
};

const releaseWhenIdle = (helper: ActiveHelper): void => {
  if (helper.pending.size !== 0 || !active.has(helper)) return;
  if (helper.idleTimer !== undefined) clearTimeout(helper.idleTimer);
  setReferenced(helper, false);
  helper.idleTimer = setTimeout(() => {
    helper.idleTimer = undefined;
    if (helper.pending.size === 0) active.delete(helper);
    failHelper(helper);
  }, IDLE_TIMEOUT_MS);
  helper.idleTimer.unref();
};

const consumeLine = (helper: ActiveHelper, line: string): void => {
  let envelope: HelperEnvelope;
  try {
    envelope = JSON.parse(line) as HelperEnvelope;
  } catch (cause) {
    if (!(cause instanceof SyntaxError)) throw cause;
    failHelper(helper, cause);
    return;
  }
  const pending = helper.pending.get(envelope.id);
  if (pending === undefined) return;
  helper.pending.delete(envelope.id);
  if (envelope.reply.state === "error") {
    pending.reject(failure(pending.reservation, envelope.reply.committed));
  } else {
    pending.resolve(envelope.reply);
  }
  releaseWhenIdle(helper);
};

const startHelper = (): ActiveHelper => {
  const child = spawn(process.execPath, ["-e", BOUND_LOCK_CHILD], {
    stdio: ["pipe", "pipe", "ignore"],
  });
  if (child.stdin === null || child.stdout === null) {
    child.kill();
    throw new CatalogLockRecoveryError();
  }
  const helper: ActiveHelper = {
    child,
    input: child.stdin,
    output: child.stdout,
    pending: new Map(),
    nextId: 1,
    buffer: "",
    idleTimer: undefined,
    forceTimer: undefined,
    settleTimer: undefined,
    failureStarted: false,
    settled: false,
    failureCause: undefined,
  };
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => {
    helper.buffer += chunk;
    if (helper.buffer.length > 32 * 1024) {
      failHelper(helper);
      return;
    }
    let boundary = helper.buffer.indexOf("\n");
    while (boundary >= 0) {
      consumeLine(helper, helper.buffer.slice(0, boundary));
      helper.buffer = helper.buffer.slice(boundary + 1);
      boundary = helper.buffer.indexOf("\n");
    }
  });
  child.once("error", (cause) => failHelper(helper, cause));
  child.once("close", () => settleHelper(helper));
  child.stdin.once("error", (cause) => failHelper(helper, cause));
  child.stdout.once("error", (cause) => failHelper(helper, cause));
  active.add(helper);
  return helper;
};

const selectHelper = (): ActiveHelper => {
  let selected: ActiveHelper | undefined;
  for (const helper of active) {
    if (selected === undefined || helper.pending.size < selected.pending.size) selected = helper;
  }
  if (selected === undefined || (selected.pending.size !== 0 && active.size < MAX_HELPERS)) {
    return startHelper();
  }
  return selected;
};

export const runBoundOwner = (
  request: ChildRequest,
  reservation: boolean,
): Promise<SuccessfulChildReply> => {
  let helper: ActiveHelper;
  try {
    helper = selectHelper();
  } catch (cause) {
    if (!(cause instanceof Error)) return Promise.reject(cause);
    return Promise.reject(failure(reservation, true, cause));
  }
  if (helper.idleTimer !== undefined) {
    clearTimeout(helper.idleTimer);
    helper.idleTimer = undefined;
  }
  setReferenced(helper, true);
  const id = helper.nextId++;
  return new Promise((resolve, reject) => {
    helper.pending.set(id, { reservation, resolve, reject });
    try {
      helper.input.write(`${JSON.stringify({ id, request })}\n`, (cause) => {
        if (cause === null || cause === undefined) return;
        failHelper(helper, cause);
      });
    } catch (cause) {
      if (!(cause instanceof Error)) {
        failHelper(helper);
        throw cause;
      }
      failHelper(helper, cause);
    }
  });
};
