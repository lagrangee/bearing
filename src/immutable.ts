import { deepFreeze as freezeWithPackage } from "deep-freeze-es6";

export const deepFreeze = <T>(value: T): T => freezeWithPackage(value);
