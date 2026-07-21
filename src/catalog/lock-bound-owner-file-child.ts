export const BOUND_OWNER_FILE_OPERATIONS = `
const quarantineOwnerFile = () => {
  assertBoundDirectory(request.path);
  readOwner(request.owner);
  if (path.basename(request.tombstoneName) !== request.tombstoneName) throw new Error("unsafe-name");
  assertMissing(request.tombstoneName);
  fs.renameSync(request.ownerName, request.tombstoneName);
  committed = true;
  request.ownerName = request.tombstoneName;
  assertBoundDirectory(request.path);
  return { state: "ok", owner: readOwner(request.owner) };
};

const removeOwnerFile = () => {
  quarantineOwnerFile();
  fs.unlinkSync(request.ownerName);
  assertBoundDirectory(request.path);
  return { state: "ok" };
};
`;
