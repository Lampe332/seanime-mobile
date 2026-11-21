// Anonymous usage count for the maintainer: reads the live D1 database (read-only SELECTs) through wrangler.
// Run: npm run stats   (needs `wrangler login`; add --local to read the local dev database instead)
import { execFileSync } from "node:child_process";

const where = process.argv.includes("--local") ? "--local" : "--remote";

function query(sql) {
  const out = execFileSync("npx", ["wrangler", "d1", "execute", "seanime-account", where, "--json", "--command", sql], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"],
  });
  const parsed = JSON.parse(out);
  return (Array.isArray(parsed) ? parsed[0] : parsed).results ?? [];
}

const day = (offset) => new Date(Date.now() - offset * 86400_000).toISOString().slice(0, 10);
const today = day(0);
const since7 = day(6);
const since30 = day(29);

const [counts] = query(
  `SELECT
     (SELECT COUNT(DISTINCT install) FROM active_installs WHERE day = '${today}') AS today,
     (SELECT COUNT(DISTINCT install) FROM active_installs WHERE day >= '${since7}') AS last7,
     (SELECT COUNT(DISTINCT install) FROM active_installs WHERE day >= '${since30}') AS last30,
     (SELECT COUNT(*) FROM users) AS accounts`,
);
const versions = query(
  `SELECT version, COUNT(DISTINCT install) AS installs FROM active_installs
   WHERE day >= '${since7}' GROUP BY version ORDER BY installs DESC, version DESC`,
);

console.log(`Active installs (UTC, ${where.slice(2)})`);
console.log(`  today (${today}):        ${counts.today}`);
console.log(`  last 7 days (${since7}+):  ${counts.last7}`);
console.log(`  last 30 days (${since30}+): ${counts.last30}`);
console.log(`Accounts: ${counts.accounts}`);
console.log("Versions, last 7 days:");
for (const v of versions) console.log(`  ${String(v.version).padEnd(16)} ${v.installs}`);
if (versions.length === 0) console.log("  (none)");
