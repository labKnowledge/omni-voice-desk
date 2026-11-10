"use strict";

const path = require("node:path");
const fs = require("node:fs");

const ROOT = path.join(__dirname, "..");
const ASSETS = path.join(ROOT, "assets");

const PRODUCT_NAME = "Omni Voice Desk";
const APP_ID = "desk.omni.voice";

function electron() {
  // Lazily require so path helpers work outside the Electron process.
  return require("electron");
}

function asset(...parts) {
  return path.join(ASSETS, ...parts);
}

function firstExisting(...candidates) {
  for (const file of candidates) {
    if (file && fs.existsSync(file)) return file;
  }
  return null;
}

/** Best icon path for the current OS (window / dock / installer-facing). */
function resolveAppIconPath() {
  if (process.platform === "darwin") {
    return firstExisting(asset("icon.icns"), asset("icon.png"));
  }
  if (process.platform === "win32") {
    return firstExisting(asset("icon.ico"), asset("icon.png"));
  }
  return firstExisting(
    asset("icons", "512x512.png"),
    asset("icons", "icon.png"),
    asset("icon.png"),
  );
}

function resolveTrayIconPath() {
  if (process.platform === "darwin") {
    return firstExisting(asset("tray.png"), asset("icons", "32x32.png"), asset("icon.png"));
  }
  if (process.platform === "win32") {
    return firstExisting(asset("icon.ico"), asset("tray.png"), asset("icon.png"));
  }
  return firstExisting(asset("icons", "32x32.png"), asset("tray.png"), asset("icon.png"));
}

function loadNative(filePath) {
  if (!filePath) return null;
  try {
    const { nativeImage } = electron();
    const img = nativeImage.createFromPath(filePath);
    return img.isEmpty() ? null : img;
  } catch {
    return null;
  }
}

function loadAppIcon() {
  return loadNative(resolveAppIconPath());
}

function loadTrayIcon() {
  const { nativeImage } = electron();
  const img = loadNative(resolveTrayIconPath());
  if (!img) return nativeImage.createEmpty();
  if (process.platform === "darwin") {
    // Keep color mark in menu bar; template icons wash out the orb.
    return img.resize({ width: 18, height: 18, quality: "best" });
  }
  if (process.platform === "win32") {
    return img.resize({ width: 16, height: 16, quality: "best" });
  }
  return img.resize({ width: 22, height: 22, quality: "best" });
}

function applyAppIdentity() {
  try {
    const { app } = electron();
    app.setName(PRODUCT_NAME);
    if (process.platform === "win32") {
      app.setAppUserModelId(APP_ID);
    }
  } catch { /* ignore outside Electron */ }
}

function applyAboutPanel() {
  if (process.platform !== "darwin") return;
  const iconPath = firstExisting(asset("icon.png"), resolveAppIconPath());
  try {
    const { app } = electron();
    app.setAboutPanelOptions({
      applicationName: PRODUCT_NAME,
      applicationVersion: app.getVersion(),
      version: app.getVersion(),
      copyright: "Hands-free LFM3-Omni on WebGPU",
      credits: "Local voice conductor · attached coding agents",
      ...(iconPath ? { iconPath } : {}),
    });
  } catch { /* ignore */ }
}

function windowChromeOptions() {
  const icon = loadAppIcon();
  const base = {
    title: PRODUCT_NAME,
    backgroundColor: "#e9ecef",
    autoHideMenuBar: true,
    show: false,
    ...(icon ? { icon } : {}),
  };

  if (process.platform === "darwin") {
    return {
      ...base,
      titleBarStyle: "hiddenInset",
      trafficLightPosition: { x: 14, y: 16 },
      vibrancy: undefined,
    };
  }

  if (process.platform === "win32") {
    return {
      ...base,
      // Keep a normal frame so the branded icon shows in the title bar.
      backgroundColor: "#e9ecef",
    };
  }

  return base;
}

module.exports = {
  PRODUCT_NAME,
  APP_ID,
  ASSETS,
  resolveAppIconPath,
  resolveTrayIconPath,
  loadAppIcon,
  loadTrayIcon,
  applyAppIdentity,
  applyAboutPanel,
  windowChromeOptions,
};
