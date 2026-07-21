import { expect, test } from "bun:test";
import {
  canonicalLockBasenameFromDebris,
  parseLockDebrisName,
  quarantineLockPath,
} from "../src/catalog/lock-artifact-name";

const UUID_A = "00000000-0000-4000-8000-000000000000";
const UUID_B = "11111111-1111-4111-8111-111111111111";
const TOKEN = "AAAAAAAAAAAAAAAAAAAAAA";

test("accepts only standalone compact debris generations", () => {
  expect(parseLockDebrisName(`catalog.lock.1.${TOKEN}.initializing`)).toEqual({
    canonical: "catalog.lock",
    kind: "initializing",
    initializer: { pid: 1, token: TOKEN },
  });
  expect(parseLockDebrisName(`catalog.lock.${TOKEN}.quarantine`)).toEqual({
    canonical: "catalog.lock",
    kind: "quarantine",
  });
});

test("accepts only legacy debris sequences the implementation could produce", () => {
  expect(parseLockDebrisName(`catalog.lock.${UUID_A}.initializing`)).toMatchObject({
    canonical: "catalog.lock",
    kind: "initializing",
  });
  expect(
    parseLockDebrisName(`catalog.lock.${UUID_A}.initializing.${UUID_B}.quarantine`),
  ).toMatchObject({ canonical: "catalog.lock", kind: "initializing" });
  expect(parseLockDebrisName(`catalog.lock.${UUID_A}.quarantine`)).toMatchObject({
    canonical: "catalog.lock",
    kind: "quarantine",
  });
  expect(
    parseLockDebrisName(`catalog.lock.${UUID_A}.quarantine.${UUID_B}.quarantine`),
  ).toMatchObject({ canonical: "catalog.lock", kind: "quarantine" });
});

test("rejects impossible legacy orderings instead of targeting them for repair", () => {
  for (const name of [
    `catalog.lock.${UUID_A}.quarantine.${UUID_B}.initializing`,
    `catalog.lock.${UUID_A}.initializing.${UUID_B}.initializing`,
    `catalog.lock.${UUID_A}.quarantine.${UUID_B}.initializing.${UUID_A}.quarantine`,
  ]) {
    expect(parseLockDebrisName(name)).toBeUndefined();
    expect(canonicalLockBasenameFromDebris(name)).toBeUndefined();
  }
});

test("rejects mixed compact and legacy debris generations", () => {
  for (const name of [
    `catalog.lock.${UUID_A}.initializing.${TOKEN}.quarantine`,
    `catalog.lock.${UUID_A}.quarantine.${TOKEN}.quarantine`,
    `catalog.lock.1.${TOKEN}.initializing.${TOKEN}.quarantine`,
    `catalog.lock.${TOKEN}.quarantine.${TOKEN}.quarantine`,
    `catalog.lock.${UUID_A}.initializing.1.${TOKEN}.initializing`,
    `catalog.lock.${UUID_A}.quarantine.1.${TOKEN}.initializing`,
    `catalog.lock.1.${TOKEN}.initializing.${UUID_A}.quarantine`,
    `catalog.lock.${TOKEN}.quarantine.${UUID_A}.quarantine`,
    `catalog.lock.1.${TOKEN}.initializing.${UUID_A}.initializing`,
    `catalog.lock.${TOKEN}.quarantine.${UUID_A}.initializing`,
    `catalog.lock.1.${TOKEN}.initializing.2.${TOKEN}.initializing`,
    `catalog.lock.${UUID_A}.quarantine.${UUID_B}.initializing.${TOKEN}.quarantine`,
  ]) {
    expect(parseLockDebrisName(name)).toBeUndefined();
    expect(canonicalLockBasenameFromDebris(name)).toBeUndefined();
  }
});

test("compact quarantine names collapse recognized transient suffixes", () => {
  const initializer = `/tmp/catalog.lock.1.${TOKEN}.initializing`;
  expect(quarantineLockPath(initializer, TOKEN)).toBe(`/tmp/catalog.lock.${TOKEN}.quarantine`);
});
