import { expect, test } from "bun:test";
import {
  boundOperationDescriptors,
  boundOperationDispatchSource,
} from "../src/catalog/lock-bound-operation-registry";

test("registers every bound filesystem operation through one typed descriptor", () => {
  expect(Object.keys(boundOperationDescriptors)).toEqual([
    "write",
    "confirm",
    "reserve",
    "quarantine",
    "tombstone",
    "retire",
    "remove",
    "quarantine-file",
    "remove-file",
    "mkdir",
    "quarantine-entries",
    "quarantine-entry",
    "remove-entry",
    "publish",
    "replace-owner",
    "restore-owner",
  ]);
  expect(
    Object.entries(boundOperationDescriptors)
      .filter(([, descriptor]) => descriptor.failure === "reservation")
      .map(([operation]) => operation),
  ).toEqual(["reserve", "mkdir", "publish"]);
  for (const descriptor of Object.values(boundOperationDescriptors)) {
    expect(boundOperationDispatchSource).toContain(
      `${JSON.stringify(descriptor.operation)}: ${descriptor.handler}`,
    );
  }
});
