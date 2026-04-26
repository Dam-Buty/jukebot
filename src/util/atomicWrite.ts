import { writeFileSync, renameSync } from "node:fs";

export const atomicWrite = (filePath: string, data: string): void => {
  const tmp = `${filePath}.tmp`;
  writeFileSync(tmp, data, "utf-8");
  renameSync(tmp, filePath);
};
