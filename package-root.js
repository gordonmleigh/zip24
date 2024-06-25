import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

export const PackageRoot = dirname(fileURLToPath(import.meta.url));
