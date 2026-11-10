"use strict";

/**
 * Build installable packages for the current host (and optional targets),
 * then write dist/INSTALL.txt with exact filenames + install commands.
 *
 * Usage:
 *   node scripts/release.cjs              # host platform
 *   node scripts/release.cjs --mac
 *   node scripts/release.cjs --win
 *   node scripts/release.cjs --linux
 *   node scripts/release.cjs --all        # best-effort all platforms
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ROOT = path.join(__dirname, "..");
const DIST = path.join(ROOT, "dist");
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));

function run(cmd, args, opts = {}) {
  console.log(`\n› ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    stdio: "inherit",
    env: process.env,
    ...opts,
  });
  if (r.status !== 0) {
    throw new Error(`${cmd} failed with exit ${r.status}`);
  }
}

function parseArgs(argv) {
  const flags = new Set(argv);
  if (flags.has("--all")) return { mac: true, win: true, linux: true };
  const any = flags.has("--mac") || flags.has("--win") || flags.has("--linux");
  if (!any) {
    return {
      mac: process.platform === "darwin",
      win: process.platform === "win32",
      linux: process.platform === "linux",
    };
  }
  return {
    mac: flags.has("--mac"),
    win: flags.has("--win"),
    linux: flags.has("--linux"),
  };
}

function listInstallers() {
  if (!fs.existsSync(DIST)) return [];
  const exts = new Set([".dmg", ".zip", ".exe", ".AppImage", ".deb", ".rpm", ".msi"]);
  return fs.readdirSync(DIST)
    .filter((name) => exts.has(path.extname(name)))
    .map((name) => {
      const full = path.join(DIST, name);
      const stat = fs.statSync(full);
      return { name, full, sizeMb: (stat.size / (1024 * 1024)).toFixed(1) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

function writeInstallGuide(artifacts) {
  const lines = [
    `Omni Voice Desk v${pkg.version} — installation packages`,
    `Built: ${new Date().toISOString()}`,
    `Host: ${process.platform}/${process.arch}`,
    "",
    "Packages in dist/:",
  ];
  if (!artifacts.length) {
    lines.push("  (none yet)");
  } else {
    for (const a of artifacts) {
      lines.push(`  - ${a.name}  (${a.sizeMb} MB)`);
    }
  }
  lines.push(
    "",
    "macOS",
    "  1. Open the .dmg for your chip (mac-arm64 = Apple Silicon, mac-x64 = Intel).",
    "  2. Drag Omni Voice Desk → Applications.",
    "  3. First launch: Right-click → Open (unsigned local build).",
    "  Or from this repo: npm run install:mac",
    "",
    "Windows",
    "  - *-win-*-setup.exe  → guided NSIS installer (Start Menu + desktop shortcut).",
    "  - *-win-*-portable.exe → run without installing.",
    "",
    "Linux",
    "  - *.AppImage → chmod +x && ./Omni*.AppImage",
    "  - *.deb → sudo dpkg -i Omni*.deb  (then sudo apt -f install if needed)",
    "",
    "Dev / from source",
    "  npm install && npm start",
    "",
  );
  const out = path.join(DIST, "INSTALL.txt");
  fs.mkdirSync(DIST, { recursive: true });
  fs.writeFileSync(out, lines.join("\n"));
  console.log(`\nWrote ${out}`);
  return out;
}

function main() {
  const targets = parseArgs(process.argv.slice(2));
  console.log(`Omni Voice Desk release v${pkg.version}`);
  console.log("Targets:", Object.entries(targets).filter(([, v]) => v).map(([k]) => k).join(", ") || "(none)");

  run("node", ["scripts/generate-icons.cjs"]);

  const args = [];
  if (targets.mac) args.push("--mac");
  if (targets.win) args.push("--win");
  if (targets.linux) args.push("--linux");
  if (!args.length) {
    throw new Error("No release targets selected for this host. Pass --mac / --win / --linux / --all");
  }

  try {
    run("npx", ["electron-builder", ...args]);
  } catch (err) {
    console.error("\nPartial failure — listing whatever packages were produced.");
    console.error(String(err.message || err));
  }

  const artifacts = listInstallers();
  writeInstallGuide(artifacts);
  if (!artifacts.length) process.exitCode = 1;
  else {
    console.log("\nReady to install:");
    for (const a of artifacts) console.log(`  ${a.name} (${a.sizeMb} MB)`);
  }
}

main();
