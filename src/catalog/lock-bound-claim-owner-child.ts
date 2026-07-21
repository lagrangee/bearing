export const BOUND_CLAIM_OWNER_OPERATIONS = String.raw`
const claimStagePath = () => {
  if (path.basename(request.stageName) !== request.stageName) throw new Error("unsafe-stage-name");
  return path.join("..", request.stageName);
};

const readClaimStage = (expected) => {
  const originalName = request.ownerName;
  request.ownerName = claimStagePath();
  try { return readOwner(expected); } finally { request.ownerName = originalName; }
};

const removeCreatedOwner = (created) => {
  let current;
  try { current = fs.lstatSync(request.ownerName, { bigint: true }); } catch { return false; }
  if (current.dev.toString() !== created.device || current.ino.toString() !== created.inode) {
    return false;
  }
  if (path.basename(request.tombstoneName) !== request.tombstoneName) return false;
  assertMissing(request.tombstoneName);
  fs.renameSync(request.ownerName, request.tombstoneName);
  const moved = fs.lstatSync(request.tombstoneName, { bigint: true });
  if (moved.dev.toString() !== created.device || moved.ino.toString() !== created.inode) return false;
  fs.unlinkSync(request.tombstoneName);
  return true;
};

const replaceClaimOwner = () => {
  const previousName = request.ownerName;
  const nextName = request.newOwnerName ?? previousName;
  if (path.basename(previousName) !== previousName || path.basename(nextName) !== nextName) {
    throw new Error("unsafe-owner-name");
  }
  verifyCandidate();
  const stage = claimStagePath();
  assertMissing(stage);
  if (request.owner !== undefined) {
    verifyCandidate();
    fs.renameSync(request.ownerName, stage);
    committed = true;
    assertBoundDirectory(request.path);
    readClaimStage(request.owner);
  }
  request.ownerName = nextName;
  let descriptor;
  let created;
  try {
    if (fs.readdirSync(".").length !== 0) throw new Error("claim-not-empty");
    const bytes = Buffer.from(JSON.stringify(request.newOwner) + "\n");
    descriptor = fs.openSync(
      request.ownerName,
      fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_EXCL |
        fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK,
      0o600,
    );
    committed = true;
    failAfterMutation("replace-owner-open");
    created = identityOf(fs.fstatSync(descriptor, { bigint: true }));
    fs.writeFileSync(descriptor, bytes);
    fs.fsyncSync(descriptor);
    fs.closeSync(descriptor);
    descriptor = undefined;
    assertBoundDirectory(request.path);
    const owner = readOwner(undefined);
    if (fs.readdirSync(".").join("\0") !== request.ownerName) throw new Error("claim-shape-changed");
    return { state: "ok", owner };
  } catch (error) {
    if (descriptor !== undefined) fs.closeSync(descriptor);
    const removed = created === undefined || removeCreatedOwner(created);
    if (removed && request.owner !== undefined) {
      request.ownerName = previousName;
      assertMissing(request.ownerName);
      fs.renameSync(stage, request.ownerName);
      verifyCandidate();
    }
    throw error;
  }
};

const restoreClaimOwner = () => {
  const currentName = request.ownerName;
  const previousName = request.previousOwnerName ?? currentName;
  if (path.basename(currentName) !== currentName || path.basename(previousName) !== previousName) {
    throw new Error("unsafe-owner-name");
  }
  verifyCandidate();
  const stage = claimStagePath();
  if (request.stagedOwner === undefined) assertMissing(stage);
  else readClaimStage(request.stagedOwner);
  tombstoneOwner();
  request.ownerName = request.tombstoneName;
  fs.unlinkSync(request.ownerName);
  assertBoundDirectory(request.path);
  request.ownerName = currentName;
  if (fs.readdirSync(".").length !== 0) throw new Error("claim-not-empty");
  if (request.stagedOwner !== undefined) {
    request.ownerName = previousName;
    assertMissing(request.ownerName);
    fs.renameSync(stage, request.ownerName);
    request.owner = request.stagedOwner;
    verifyCandidate();
  }
  return { state: "ok" };
};
`;
