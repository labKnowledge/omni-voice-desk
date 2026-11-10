"use strict";

/** Remove build output and local junk so the tree stays Omni Voice Desk–focused. */

const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.join(__dirname, "..");

const TARGETS = [
  "dist",
  "out",
  "release",
  ".DS_Store",
  path.join("renderer", ".DS_Store"),
  path.join("assets", ".DS_Store"),
  path.join("electron", ".DS_Store"),
];

function rm(target) {
  const full = path.join(ROOT, target);
  if (!fs.existsSync(full)) return false;
  fs.rmSync(full, { recursive: true, force: true });
  console.log(`removed ${target}`);
  return true;
}

let n = 0;
for (const t of TARGETS) {
  if (rm(t)) n += 1;
}

// Sweep nested .DS_Store under the project (skip node_modules / .git)
function walk(dir) {
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    if (ent.name === "node_modules" || ent.name === ".git" || ent.name === "dist") continue;
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) walk(full);
    else if (ent.name === ".DS_Store") {
      fs.rmSync(full, { force: true });
      console.log(`removed ${path.relative(ROOT, full)}`);
      n += 1;
    }
  }
}
walk(ROOT);

console.log(n ? `Cleaned ${n} path(s).` : "Nothing to clean.");
