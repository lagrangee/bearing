export const BOUND_ENTRY_OPERATIONS = `
const entryIdentity = (metadata) => ({
  device: metadata.dev.toString(), inode: metadata.ino.toString(),
  mode: metadata.mode.toString(), links: metadata.nlink.toString(), size: metadata.size.toString(),
});

const sameEntry = (metadata, expected) => {
  const kind = metadata.isDirectory() ? "directory" : metadata.isFile() ? "regular" : "other";
  const identity = entryIdentity(metadata);
  return kind === expected.kind && Object.keys(identity).every((key) => identity[key] === expected.identity[key]);
};

const verifyEntry = () => {
  assertBoundDirectory(request.path);
  if (path.basename(request.ownerName) !== request.ownerName) throw new Error("unsafe-name");
  const metadata = fs.lstatSync(request.ownerName, { bigint: true });
  if (!sameEntry(metadata, request.entry)) throw new Error("entry-changed");
  if (request.entry.kind === "directory" && fs.readdirSync(request.ownerName).length !== 0) {
    throw new Error("entry-not-empty");
  }
};

const quarantineEntry = () => {
  verifyEntry();
  if (path.basename(request.tombstoneName) !== request.tombstoneName) throw new Error("unsafe-name");
  assertMissing(request.tombstoneName);
  verifyEntry();
  fs.renameSync(request.ownerName, request.tombstoneName);
  committed = true;
  request.ownerName = request.tombstoneName;
  assertBoundDirectory(request.path);
  verifyEntry();
  return { state: "ok" };
};

const removeEntry = () => {
  quarantineEntry();
  if (request.entry.kind === "directory") fs.rmdirSync(request.ownerName);
  else fs.unlinkSync(request.ownerName);
  assertBoundDirectory(request.path);
  return { state: "ok" };
};
`;
