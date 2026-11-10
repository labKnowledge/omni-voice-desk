"use strict";

const { app, BrowserWindow, ipcMain, dialog, Menu, Tray, shell } = require("electron");
const path = require("node:path");
const { AgentHarness } = require("./harness/index.cjs");
const brand = require("./brand.cjs");

// WebGPU must be enabled before ready (especially on Linux).
app.commandLine.appendSwitch("enable-unsafe-webgpu");
app.commandLine.appendSwitch("ignore-gpu-blocklist");
app.commandLine.appendSwitch("enable-features", "SharedArrayBuffer,Vulkan,WebGPUService");
if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform-hint", "auto");
}

brand.applyAppIdentity();

const isDev = process.argv.includes("--dev");
const harness = new AgentHarness();
let mainWindow = null;
let tray = null;
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1180,
    height: 820,
    minWidth: 820,
    minHeight: 640,
    ...brand.windowChromeOptions(),
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      webgl: true,
    },
  });

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
    mainWindow.focus();
  });

  mainWindow.loadFile(path.join(__dirname, "..", "renderer", "index.html"));

  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function createTray() {
  tray = new Tray(brand.loadTrayIcon());
  tray.setToolTip(brand.PRODUCT_NAME);
  const menu = Menu.buildFromTemplate([
    {
      label: `Open ${brand.PRODUCT_NAME}`,
      click: () => {
        if (!mainWindow) createWindow();
        else {
          mainWindow.show();
          mainWindow.focus();
        }
      },
    },
    {
      label: "Pick workspace…",
      click: async () => {
        const result = await dialog.showOpenDialog({
          properties: ["openDirectory", "createDirectory"],
          title: "Choose coding workspace",
        });
        if (!result.canceled && result.filePaths[0]) {
          harness.setWorkspace(result.filePaths[0]);
        }
      },
    },
    { type: "separator" },
    {
      label: `Quit ${brand.PRODUCT_NAME}`,
      click: () => app.quit(),
    },
  ]);
  tray.setContextMenu(menu);
  tray.on("click", () => {
    if (!mainWindow) createWindow();
    else mainWindow.isVisible() ? mainWindow.focus() : mainWindow.show();
  });
}

function installAppMenu() {
  if (process.platform !== "darwin") {
    Menu.setApplicationMenu(null);
    return;
  }
  const template = [
    {
      label: brand.PRODUCT_NAME,
      submenu: [
        { role: "about" },
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    },
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

function broadcast() {
  const snapshot = harness.snapshot();
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("harness:change", snapshot);
  }
}

harness.on("change", () => {
  broadcast();
  // When an external job finishes, start the next queued CLI agent.
  setTimeout(pumpExternalJobs, 50);
});
harness.on("queued", (agent) => {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send("harness:event", { type: "queued", agent });
  }
  pumpExternalJobs();
});

function pumpExternalJobs() {
  // Installed CLI agents run in main (no GPU). Parallelism: one external at a time for clarity.
  const busy = [...(harness.externalChildren?.keys?.() || [])].length > 0;
  if (busy) return;
  const job = harness.nextQueued({ backend: "external" });
  if (!job) return;
  try {
    harness.startExternalJob(job);
  } catch (err) {
    harness.updateAgent(job.id, {
      status: "failed",
      summary: err?.message || String(err),
      logLine: `External spawn error: ${err?.message || err}`,
    });
  }
}

function wireIpc() {
  ipcMain.handle("harness:snapshot", () => harness.snapshot());
  ipcMain.handle("harness:doctor", () => harness.doctor());
  ipcMain.handle("harness:list", () => harness.listAgents());
  ipcMain.handle("harness:list-installed", (_e, opts) => harness.listInstalledAgents(opts || {}));
  ipcMain.handle("harness:inspect-workspace", (_e, opts) => harness.inspectWorkspace(opts || {}));
  ipcMain.handle("harness:environment", () => harness.environmentBrief());
  ipcMain.handle("harness:set-workspace", (_e, workspace) => harness.setWorkspace(workspace));
  ipcMain.handle("harness:pick-workspace", async () => {
    const result = await dialog.showOpenDialog(mainWindow || undefined, {
      properties: ["openDirectory", "createDirectory"],
      title: "Choose coding workspace",
      defaultPath: harness.getWorkspace() || app.getPath("documents"),
    });
    if (result.canceled || !result.filePaths[0]) return null;
    return harness.setWorkspace(result.filePaths[0]);
  });
  ipcMain.handle("harness:spawn", async (_e, payload) => {
    const agent = await harness.spawnAgent(payload || {});
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("harness:event", { type: "spawned", agent });
    }
    pumpExternalJobs();
    return agent;
  });
  ipcMain.handle("harness:status", async (_e, id) => harness.refresh(id));
  ipcMain.handle("harness:update", (_e, id, patch) => harness.updateAgent(id, patch || {}));
  ipcMain.handle("harness:next-queued", (_e, opts) => harness.nextQueued(opts || { backend: "local-omni" }));
  ipcMain.handle("harness:aborted", (_e, id) => harness.isAborted(id));
  ipcMain.handle("harness:cancel", async (_e, id) => {
    const agent = await harness.cancelAgent(id);
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("harness:event", { type: "cancelled", agent });
    }
    setTimeout(pumpExternalJobs, 200);
    return agent;
  });
  ipcMain.handle("harness:clear-agents", (_e, opts) => {
    const result = harness.clearAgents(opts || {});
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send("harness:event", { type: "cleared", ...result });
    }
    setTimeout(pumpExternalJobs, 200);
    return result;
  });

  // Full workspace FS + app launch for the in-app text agent
  ipcMain.handle("fs:list", (_e, opts) => harness.fsList(opts || {}));
  ipcMain.handle("fs:read", (_e, opts) => harness.fsRead(opts || {}));
  ipcMain.handle("fs:write", (_e, opts) => harness.fsWrite(opts || {}));
  ipcMain.handle("fs:append", (_e, opts) => harness.fsAppend(opts || {}));
  ipcMain.handle("fs:mkdir", (_e, opts) => harness.fsMkdir(opts || {}));
  ipcMain.handle("fs:remove", (_e, opts) => harness.fsRemove(opts || {}));
  ipcMain.handle("fs:rename", (_e, opts) => harness.fsRename(opts || {}));
  ipcMain.handle("fs:copy", (_e, opts) => harness.fsCopy(opts || {}));
  ipcMain.handle("fs:stat", (_e, opts) => harness.fsStat(opts || {}));
  ipcMain.handle("fs:search", (_e, opts) => harness.fsSearch(opts || {}));
  ipcMain.handle("fs:grep", (_e, opts) => harness.fsGrep(opts || {}));
  ipcMain.handle("fs:glob", (_e, opts) => harness.fsGlob(opts || {}));
  ipcMain.handle("fs:str-replace", (_e, opts) => harness.fsStrReplace(opts || {}));
  ipcMain.handle("fs:apply-edits", (_e, opts) => harness.fsApplyEdits(opts || {}));
  ipcMain.handle("fs:insert-lines", (_e, opts) => harness.fsInsertLines(opts || {}));
  ipcMain.handle("fs:replace-lines", (_e, opts) => harness.fsReplaceLines(opts || {}));
  ipcMain.handle("fs:tree", (_e, opts) => harness.fsTree(opts || {}));
  ipcMain.handle("fs:organize", (_e, opts) => harness.fsOrganize(opts || {}));
  ipcMain.handle("fs:find-replace", (_e, opts) => harness.fsFindReplace(opts || {}));
  ipcMain.handle("fs:run", (_e, opts) => harness.fsRun(opts || {}));
  ipcMain.handle("fs:open-terminal", (_e, opts) => harness.fsOpenTerminal(opts || {}));
  ipcMain.handle("fs:open", (_e, opts) => harness.fsOpen(opts || {}));
}

app.whenReady().then(() => {
  brand.applyAboutPanel();
  installAppMenu();
  wireIpc();
  const dockIcon = brand.loadAppIcon();
  if (process.platform === "darwin" && dockIcon && app.dock) {
    try { app.dock.setIcon(dockIcon); } catch { /* optional */ }
  }
  createWindow();
  // Tray works on all desktops; Linux often prefers no tray unless forced.
  if (process.platform !== "linux" || process.env.OMNI_FORCE_TRAY) {
    try { createTray(); } catch { /* tray optional */ }
  }
  pumpExternalJobs();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

app.on("web-contents-created", (_event, contents) => {
  contents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
});
