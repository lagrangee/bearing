export const BOUND_DIRECTORY_OPERATIONS = `
const sameEntries = (actual, expected) =>
  actual.length === expected.length && actual.every((entry, index) => entry === expected[index]);

const verifyEntries = () => {
  assertBoundDirectory(request.path);
  const actual = fs.readdirSync(".").sort();
  const expected = [...request.entries].sort();
  if (!sameEntries(actual, expected)) throw new Error("directory-shape-changed");
};

const quarantineEntries = () => {
  verifyEntries();
  const source = siblingPath(request.path);
  const destination = siblingPath(request.destination);
  assertMissing(destination);
  verifyEntries();
  fs.renameSync(source, destination);
  committed = true;
  request.path = request.destination;
  assertBoundDirectory(request.path);
  verifyEntries();
  return { state: "ok" };
};

const mkdirChild = () => {
  assertBoundDirectory(request.path);
  if (path.dirname(request.destination) !== request.path) throw new Error("unsafe-child-parent");
  const name = path.basename(request.destination);
  fs.mkdirSync(name, { mode: 0o700 });
  committed = true;
  const relative = fs.lstatSync(name, { bigint: true });
  assertBoundDirectory(request.path);
  const absolute = fs.lstatSync(request.destination, { bigint: true });
  if (!relative.isDirectory() || relative.dev !== absolute.dev || relative.ino !== absolute.ino) {
    throw new Error("child-changed");
  }
  return { state: "ok", directory: directoryIdentity(relative) };
};

const publishCandidate = () => {
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
  if (!metadata.isDirectory()) throw new Error("unsafe-publish");
  const directory = directoryIdentity(metadata);
  process.chdir(destination);
  request.path = request.destination;
  request.directory = directory;
  return { state: "ok", directory, owner: writeOwner() };
};
`;
