import { BOUND_CLAIM_OWNER_OPERATIONS } from "./lock-bound-claim-owner-child";
import { BOUND_DIRECTORY_OPERATIONS } from "./lock-bound-directory-child";
import { BOUND_ENTRY_OPERATIONS } from "./lock-bound-entry-child";
import { boundOperationDispatchSource } from "./lock-bound-operation-registry";
import { BOUND_OWNER_FILE_OPERATIONS } from "./lock-bound-owner-file-child";

export const BOUND_LOCK_CHILD = String.raw`
const fs = require("node:fs");
const path = require("node:path");
let request; let committed = false;
const directoryMatches = (metadata, expected) =>
  metadata.isDirectory() &&
  metadata.dev === BigInt(expected.device) &&
  metadata.ino === BigInt(expected.inode);
const identityOf = (metadata) => ({
  device: metadata.dev.toString(),
  inode: metadata.ino.toString(),
  links: metadata.nlink.toString(),
  size: metadata.size.toString(),
  modifiedAt: metadata.mtimeNs.toString(),
  changedAt: metadata.ctimeNs.toString(),
});
const sameIdentity = (left, right) =>
  left.device === right.device &&
  left.inode === right.inode &&
  left.links === right.links &&
  left.size === right.size &&
  left.modifiedAt === right.modifiedAt &&
  left.changedAt === right.changedAt;
const assertBoundDirectory = (path) => {
  const pathMetadata = fs.lstatSync(path, { bigint: true });
  const cwdMetadata = fs.statSync(".", { bigint: true });
  if (
    !directoryMatches(pathMetadata, request.directory) ||
    !directoryMatches(cwdMetadata, request.directory)
  ) {
    throw new Error("directory-changed");
  }
  if (request.parent !== undefined) {
    const parentPath = fs.lstatSync(request.parent.path, { bigint: true });
    const cwdParent = fs.statSync("..", { bigint: true });
    if (
      !directoryMatches(parentPath, request.parent.directory) ||
      !directoryMatches(cwdParent, request.parent.directory)
    ) {
      throw new Error("parent-changed");
    }
  }
};

const siblingPath = (target) => {
  if (request.parent === undefined || path.dirname(target) !== request.parent.path) {
    throw new Error("destination-parent-changed");
  }
  return path.join("..", path.basename(target));
};

const readOwner = (expected) => {
  const descriptor = fs.openSync(
    request.ownerName,
    fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
  );
  try {
    const before = fs.fstatSync(descriptor, { bigint: true });
    if (!before.isFile() || before.nlink !== 1n || before.size > 4096n) {
      throw new Error("unsafe-owner");
    }
    const bytes = fs.readFileSync(descriptor);
    const after = fs.fstatSync(descriptor, { bigint: true });
    const identity = identityOf(before);
    if (!sameIdentity(identity, identityOf(after))) throw new Error("owner-changed");
    if (
      expected !== undefined &&
      (identity.device !== expected.identity.device ||
        identity.inode !== expected.identity.inode ||
        identity.links !== expected.identity.links ||
        identity.size !== expected.identity.size ||
        bytes.toString("base64") !== expected.bytes)
    ) {
      throw new Error("owner-replaced");
    }
    return { identity, bytes: bytes.toString("base64") };
  } finally {
    fs.closeSync(descriptor);
  }
};

const assertMissing = (path) => {
  try {
    fs.lstatSync(path);
  } catch (error) {
    if (error && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error("destination-exists");
};

const verifyCandidate = () => {
  assertBoundDirectory(request.path);
  if (request.owner === undefined) {
    if (fs.readdirSync(".").length !== 0) throw new Error("candidate-not-empty");
    return undefined;
  }
  const owner = readOwner(request.owner);
  if (fs.readdirSync(".").join("\0") !== request.ownerName) {
    throw new Error("candidate-shape-changed");
  }
  return owner;
};

const directoryIdentity = (metadata) => ({ device: metadata.dev.toString(), inode: metadata.ino.toString() });

const failAfterMutation = (phase) => {
  if (
    shouldTriggerFault(
      "BEARING_INTERNAL_BOUND_LOCK_FAIL_AFTER_MUTATION",
      phase,
      request.path,
    )
  ) {
    throw new Error("injected-post-mutation-failure");
  }
};

const writeOwner = () => {
  assertBoundDirectory(request.path);
  const bytes = Buffer.from(JSON.stringify(request.newOwner) + "\n");
  const descriptor = fs.openSync(
    request.ownerName,
    fs.constants.O_WRONLY |
      fs.constants.O_CREAT |
      fs.constants.O_EXCL |
      fs.constants.O_NOFOLLOW |
      fs.constants.O_NONBLOCK,
    0o600,
  );
  committed = true;
  try {
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
  } finally {
    fs.closeSync(descriptor);
  }
  assertBoundDirectory(request.path);
  return readOwner(undefined);
};

const reserve = () => {
  verifyCandidate();
  const destination = siblingPath(request.destination);
  try {
    fs.mkdirSync(destination, { mode: 0o700 });
  } catch (error) {
    if (error && error.code === "EEXIST") return { state: "contended" };
    throw error;
  }
  committed = true;
  const metadata = fs.lstatSync(destination, { bigint: true });
  if (!metadata.isDirectory()) throw new Error("unsafe-reservation");
  return { state: "ok", directory: directoryIdentity(metadata) };
};

const confirmOwner = () => {
  assertBoundDirectory(request.path);
  return { state: "ok", owner: readOwner(request.owner) };
};

const writeOwnerOperation = () => ({ state: "ok", owner: writeOwner() });
const quarantineCandidate = () => move(request.destination);

const move = (destination) => {
  const owner = verifyCandidate();
  const source = siblingPath(request.path);
  const boundDestination = siblingPath(destination);
  assertMissing(boundDestination);
  verifyCandidate();
  fs.renameSync(source, boundDestination);
  committed = true;
  const originalPath = request.path;
  request.path = destination;
  try {
    assertBoundDirectory(destination);
    if (owner !== undefined) readOwner(request.owner);
    return { state: "ok", owner };
  } finally {
    request.path = originalPath;
  }
};

const tombstoneOwner = () => {
  verifyCandidate();
  assertMissing(request.tombstoneName);
  fs.renameSync(request.ownerName, request.tombstoneName);
  committed = true;
  failAfterMutation("tombstone-owner");
  const originalName = request.ownerName;
  request.ownerName = request.tombstoneName;
  try {
    verifyCandidate();
    return { state: "ok" };
  } finally {
    request.ownerName = originalName;
  }
};

const remove = () => {
  verifyCandidate();
  if (request.owner !== undefined) {
    fs.unlinkSync(request.ownerName);
    committed = true;
    failAfterMutation("remove-owner");
  }
  assertBoundDirectory(request.path);
  if (fs.readdirSync(".").length !== 0) throw new Error("candidate-not-empty");
  fs.rmdirSync(siblingPath(request.path));
  committed = true;
  return { state: "ok" };
};

${BOUND_OWNER_FILE_OPERATIONS}
${BOUND_DIRECTORY_OPERATIONS}
${BOUND_ENTRY_OPERATIONS}
${BOUND_CLAIM_OWNER_OPERATIONS}
const retire = () => {
  const destination = request.destination;
  move(destination);
  request.path = destination;
  if (request.owner !== undefined) {
    tombstoneOwner();
    request.ownerName = request.tombstoneName;
  }
  return remove();
};

${boundOperationDispatchSource}

const execute = (nextRequest) => {
  request = nextRequest;
  committed = false;
  try {
    process.chdir(request.path);
    return dispatchBoundOperation();
  } catch {
    return { state: "error", committed };
  }
};

const shouldTriggerFault = (variable, operation, requestPath) => {
  if (process.env[variable] !== operation) return false;
  const expectedPath = process.env.BEARING_INTERNAL_BOUND_LOCK_FAULT_PATH;
  if (expectedPath !== undefined && expectedPath !== requestPath) return false;
  const expectedSuffix = process.env.BEARING_INTERNAL_BOUND_LOCK_FAULT_PATH_SUFFIX;
  if (expectedSuffix !== undefined && !requestPath.endsWith(expectedSuffix)) return false;
  const marker = process.env.BEARING_INTERNAL_BOUND_LOCK_EXIT_MARKER;
  if (marker === undefined) return true;
  try {
    fs.writeFileSync(marker, operation + "\n", { flag: "wx" });
    return true;
  } catch (error) {
    if (error && error.code === "EEXIST") return false;
    throw error;
  }
};

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  input += chunk;
  let boundary = input.indexOf("\n");
  while (boundary >= 0) {
    const line = input.slice(0, boundary);
    input = input.slice(boundary + 1);
    const envelope = JSON.parse(line);
    if (
      shouldTriggerFault(
        "BEARING_INTERNAL_BOUND_LOCK_EXIT_BEFORE_MUTATION",
        envelope.request.operation,
        envelope.request.path,
      )
    ) {
      process.exit(85);
    }
    const reply = execute(envelope.request);
    if (
      reply.state === "ok" &&
      committed &&
      shouldTriggerFault(
        "BEARING_INTERNAL_BOUND_LOCK_EXIT_AFTER_COMMIT",
        envelope.request.operation,
        envelope.request.path,
      )
    ) {
      process.exit(86);
    }
    process.stdout.write(JSON.stringify({ id: envelope.id, reply }) + "\n");
    boundary = input.indexOf("\n");
  }
});
process.stdin.on("end", () => process.exit(0));
`;
