"use strict";

/**
 * Electron's stock postinstall uses extract-zip, which can abort after the first
 * entry on Node 26+. This script verifies the platform binary and, when needed,
 * downloads via @electron/get and extracts with the system unzip/Expand-Archive.
 */

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const electronRoot = path.dirname(require.resolve("electron/package.json"));
const { version } = require(path.join(electronRoot, "package.json"));
const distDir = path.join(electronRoot, "dist");
const pathFile = path.join(electronRoot, "path.txt");

const platform = process.env.npm_config_platform || process.platform;
const arch = process.env.npm_config_arch || process.arch;

function platformPath() {
  switch (platform) {
    case "mas":
    case "darwin":
      return "Electron.app/Contents/MacOS/Electron";
    case "win32":
      return "electron.exe";
    case "linux":
    case "freebsd":
    case "openbsd":
      return "electron";
    default:
      throw new Error(`Electron builds are not available on platform: ${platform}`);
  }
}

function binaryLooksNative(filePath) {
  if (!fs.existsSync(filePath)) return false;
  try {
    const fd = fs.openSync(filePath, "r");
    const buf = Buffer.alloc(4);
    fs.readSync(fd, buf, 0, 4, 0);
    fs.closeSync(fd);
    // Mach-O 64-bit (arm64/x64) or fat/magic, vs ELF
    if (platform === "darwin") {
      return (
        buf.equals(Buffer.from([0xfe, 0xed, 0xfa, 0xce])) ||
        buf.equals(Buffer.from([0xfe, 0xed, 0xfa, 0xcf])) ||
        buf.equals(Buffer.from([0xcf, 0xfa, 0xed, 0xfe])) ||
        buf.equals(Buffer.from([0xce, 0xfa, 0xed, 0xfe])) ||
        buf.equals(Buffer.from([0xca, 0xfe, 0xba, 0xbe])) ||
        buf.equals(Buffer.from([0xbe, 0xba, 0xfe, 0xca]))
      );
    }
    if (platform === "win32") {
      return buf[0] === 0x4d && buf[1] === 0x5a; // MZ
    }
    return buf[0] === 0x7f && buf[1] === 0x45 && buf[2] === 0x4c && buf[3] === 0x46; // ELF
  } catch {
    return false;
  }
}

function isHealthy() {
  const expected = platformPath();
  try {
    const recorded = fs.readFileSync(pathFile, "utf8").replace(/\r?\n$/, "");
    const ver = fs.readFileSync(path.join(distDir, "version"), "utf8").replace(/^v/, "").trim();
    if (recorded !== expected || ver !== version) return false;
  } catch {
    return false;
  }
  return binaryLooksNative(path.join(distDir, expected));
}

function extractZip(zipPath, dest) {
  fs.rmSync(dest, { recursive: true, force: true });
  fs.mkdirSync(dest, { recursive: true });

  if (process.platform === "win32") {
    const ps = spawnSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        `Expand-Archive -LiteralPath '${zipPath.replace(/'/g, "''")}' -DestinationPath '${dest.replace(/'/g, "''")}' -Force`,
      ],
      { stdio: "inherit" }
    );
    if (ps.status !== 0) throw new Error("Expand-Archive failed");
    return;
  }

  const unzip = spawnSync("unzip", ["-q", "-o", zipPath, "-d", dest], { stdio: "inherit" });
  if (unzip.status !== 0) {
    throw new Error(
      "unzip failed — install unzip (macOS/Linux) so Electron can be extracted on Node 26+"
    );
  }
}

async function main() {
  if (process.env.ELECTRON_SKIP_BINARY_DOWNLOAD) {
    console.log("ensure-electron: skipped (ELECTRON_SKIP_BINARY_DOWNLOAD)");
    return;
  }

  if (isHealthy()) {
    console.log(`ensure-electron: ok (${platform}-${arch} v${version})`);
    return;
  }

  console.log(`ensure-electron: repairing Electron ${version} for ${platform}-${arch}…`);

  const { downloadArtifact } = require("@electron/get");
  const zipPath = await downloadArtifact({
    version,
    artifactName: "electron",
    force: process.env.force_no_cache === "true",
    cacheRoot: process.env.electron_config_cache,
    platform,
    arch,
  });

  extractZip(zipPath, distDir);
  fs.writeFileSync(pathFile, platformPath());

  if (!isHealthy()) {
    throw new Error("ensure-electron: binary still missing or wrong platform after extract");
  }

  console.log(`ensure-electron: installed ${platformPath()}`);
}

main().catch((err) => {
  console.error(err.stack || err);
  process.exit(1);
});
