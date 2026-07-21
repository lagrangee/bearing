import { parseCatalogEntryId } from "./entry-id";

const BASE32_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567";
const MAX_ENCODED_LENGTH = 205;

const encodeBytes = (bytes: Uint8Array): string => {
  let buffer = 0;
  let bitCount = 0;
  let encoded = "";
  for (const byte of bytes) {
    buffer = (buffer << 8) | byte;
    bitCount += 8;
    while (bitCount >= 5) {
      bitCount -= 5;
      encoded += BASE32_ALPHABET[(buffer >> bitCount) & 31];
      buffer &= (1 << bitCount) - 1;
    }
  }
  if (bitCount > 0) encoded += BASE32_ALPHABET[(buffer << (5 - bitCount)) & 31];
  return encoded;
};

export const encodeCatalogEntryIdFilename = (input: unknown): string => {
  const entryId = parseCatalogEntryId(input);
  return encodeBytes(Buffer.from(entryId, "ascii"));
};

export const decodeCatalogEntryIdFilename = (input: unknown): string => {
  if (
    typeof input !== "string" ||
    input.length < 2 ||
    input.length > MAX_ENCODED_LENGTH ||
    !/^[a-z2-7]+$/u.test(input)
  ) {
    throw new Error("Catalog entry lease filename is invalid.");
  }
  let buffer = 0;
  let bitCount = 0;
  const bytes: number[] = [];
  for (const character of input) {
    const value = BASE32_ALPHABET.indexOf(character);
    buffer = (buffer << 5) | value;
    bitCount += 5;
    if (bitCount >= 8) {
      bitCount -= 8;
      bytes.push((buffer >> bitCount) & 255);
      buffer &= (1 << bitCount) - 1;
    }
  }
  if (buffer !== 0 || bytes.some((byte) => byte > 127)) {
    throw new Error("Catalog entry lease filename is not canonical.");
  }
  const entryId = parseCatalogEntryId(String.fromCharCode(...bytes));
  if (encodeCatalogEntryIdFilename(entryId) !== input) {
    throw new Error("Catalog entry lease filename is not canonical.");
  }
  return entryId;
};
