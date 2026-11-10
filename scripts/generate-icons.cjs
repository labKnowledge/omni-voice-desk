"use strict";

/**
 * Build cross-platform icons from assets/icon.png
 * - macOS: icon.icns via sips + iconutil
 * - Windows: icon.ico via png-to-ico
 * - Linux: assets/icons/{size}x{size}.png
 * - Tray: assets/tray.png (32px)
 */

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const pngToIco = require("png-to-ico").default || require("png-to-ico");

const ROOT = path.join(__dirname, "..");
const SRC = path.join(ROOT, "assets", "icon.png");
const ASSETS = path.join(ROOT, "assets");
const ICONSET = path.join(ASSETS, "icon.iconset");
const LINUX_DIR = path.join(ASSETS, "icons");

const MAC_SIZES = [16, 32, 64, 128, 256, 512, 1024];
const LINUX_SIZES = [16, 24, 32, 48, 64, 128, 256, 512];
const ICO_SIZES = [16, 24, 32, 48, 64, 128, 256];

function mustExist(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`Missing source icon: ${file}`);
  }
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: "utf8" });
  if (r.status !== 0) {
    throw new Error(`${cmd} ${args.join(" ")} failed:\n${r.stderr || r.stdout}`);
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function resizePng(dest, size) {
  run("sips", ["-z", String(size), String(size), SRC, "--out", dest]);
}

function buildMacIconset() {
  ensureDir(ICONSET);
  for (const size of MAC_SIZES) {
    resizePng(path.join(ICONSET, `icon_${size}x${size}.png`), size);
    if (size <= 512) {
      resizePng(path.join(ICONSET, `icon_${size}x${size}@2x.png`), size * 2);
    }
  }
  // Required naming aliases for iconutil
  const aliases = [
    ["icon_16x16.png", "icon_16x16.png"],
    ["icon_16x16@2x.png", "icon_32x32.png"],
    ["icon_32x32.png", "icon_32x32.png"],
    ["icon_32x32@2x.png", "icon_64x64.png"],
    ["icon_128x128.png", "icon_128x128.png"],
    ["icon_128x128@2x.png", "icon_256x256.png"],
    ["icon_256x256.png", "icon_256x256.png"],
    ["icon_256x256@2x.png", "icon_512x512.png"],
    ["icon_512x512.png", "icon_512x512.png"],
    ["icon_512x512@2x.png", "icon_1024x1024.png"],
  ];
  // Re-emit with canonical iconutil names (overwrite)
  for (const size of [16, 32, 128, 256, 512]) {
    resizePng(path.join(ICONSET, `icon_${size}x${size}.png`), size);
    resizePng(path.join(ICONSET, `icon_${size}x${size}@2x.png`), size * 2);
  }
  void aliases;
  run("iconutil", ["-c", "icns", ICONSET, "-o", path.join(ASSETS, "icon.icns")]);
  fs.rmSync(ICONSET, { recursive: true, force: true });
  console.log("wrote assets/icon.icns");
}

async function buildWindowsIco() {
  const tmp = path.join(ASSETS, ".ico-tmp");
  ensureDir(tmp);
  const files = [];
  for (const size of ICO_SIZES) {
    const out = path.join(tmp, `${size}.png`);
    resizePng(out, size);
    files.push(out);
  }
  const buf = await pngToIco(files);
  fs.writeFileSync(path.join(ASSETS, "icon.ico"), buf);
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log("wrote assets/icon.ico");
}

function buildLinuxIcons() {
  ensureDir(LINUX_DIR);
  for (const size of LINUX_SIZES) {
    resizePng(path.join(LINUX_DIR, `${size}x${size}.png`), size);
  }
  console.log("wrote assets/icons/*.png");
}

function buildTray() {
  resizePng(path.join(ASSETS, "tray.png"), 32);
  resizePng(path.join(ASSETS, "tray@2x.png"), 64);
  console.log("wrote assets/tray.png");
}

async function main() {
  mustExist(SRC);
  ensureDir(ASSETS);
  if (process.platform === "darwin") {
    buildMacIconset();
  } else {
    console.warn("Skipping .icns generation (needs macOS iconutil). Keeping existing icon.icns if present.");
  }
  await buildWindowsIco();
  buildLinuxIcons();
  buildTray();
  console.log("Icon set ready for macOS / Windows / Linux.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
