import { access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * `relative` (e.g. "node_modules/x/y.js") in the directory of the module at `from` (its
 * `import.meta.url`) or the nearest ancestor that has it, the way Node finds packages. Starting from
 * the module (in apps/web, as source or as a built chunk) rather than the working directory keeps it
 * working however the server was started.
 */
export async function findUp(relative: string, from: string): Promise<string> {
  for (let dir = path.dirname(fileURLToPath(from)); ; dir = path.dirname(dir)) {
    const file = path.join(dir, relative);
    if (await access(file).then(() => true, () => false)) return file;
    if (path.dirname(dir) === dir) throw new Error(`${relative} not found`);
  }
}
