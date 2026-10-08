// "A newer version is available" notice. Asks the public npm registry for the
// latest version at most once a day; sends nothing but the request itself.
// Turn off with GSC_CONNECT_UPDATE_CHECK=0.
import { promises as fs } from "node:fs";
import path from "node:path";
import { CONFIG_DIR } from "./store.js";
import { VERSION } from "./version.js";

const PACKAGE = "google-search-console-connector";
const CACHE = path.join(CONFIG_DIR, "update-check.json");
const DAY = 86_400_000;

function newer(a: string, b: string): boolean {
  const pa = a.split(".").map(Number);
  const pb = b.split(".").map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) > (pb[i] ?? 0);
  }
  return false;
}

/** Returns the newer version if one exists, otherwise null. Never throws. */
export async function latestVersion(): Promise<string | null> {
  if (process.env.GSC_CONNECT_UPDATE_CHECK === "0" || process.env.GSC_CONNECT_DEMO === "1") return null;
  try {
    const cached = JSON.parse(await fs.readFile(CACHE, "utf8").catch(() => "{}"));
    let latest: string | undefined = cached.latest;
    if (!latest || !cached.checkedAt || Date.now() - cached.checkedAt > DAY) {
      const res = await fetch(`https://registry.npmjs.org/${PACKAGE}/latest`, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) return null;
      latest = ((await res.json()) as { version?: string }).version;
      await fs.mkdir(CONFIG_DIR, { recursive: true });
      await fs.writeFile(CACHE, JSON.stringify({ latest, checkedAt: Date.now() }));
    }
    return latest && /^\d+\.\d+\.\d+$/.test(latest) && newer(latest, VERSION) ? latest : null;
  } catch {
    return null;
  }
}

export const updateCommand = `npx -y ${PACKAGE}@latest`;
