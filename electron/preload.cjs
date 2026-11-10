"use strict";

const { contextBridge, ipcRenderer } = require("electron");
const path = require("node:path");

const PRODUCT_NAME = "Omni Voice Desk";
const logoPath = path.join(__dirname, "..", "assets", "icon.png");

const api = {
  isDesktop: true,
  platform: process.platform,
  arch: process.arch,
  productName: PRODUCT_NAME,
  /** file:// URL for the branded orb mark in the UI */
  logoUrl: `file://${logoPath}`,
  getSnapshot: () => ipcRenderer.invoke("harness:snapshot"),
  setWorkspace: (workspace) => ipcRenderer.invoke("harness:set-workspace", workspace),
  pickWorkspace: () => ipcRenderer.invoke("harness:pick-workspace"),
  inspectWorkspace: (opts) => ipcRenderer.invoke("harness:inspect-workspace", opts),
  getEnvironment: () => ipcRenderer.invoke("harness:environment"),
  spawnAgent: (payload) => ipcRenderer.invoke("harness:spawn", payload),
  listAgents: () => ipcRenderer.invoke("harness:list"),
  listInstalledAgents: (opts) => ipcRenderer.invoke("harness:list-installed", opts),
  agentStatus: (id) => ipcRenderer.invoke("harness:status", id),
  updateAgent: (id, patch) => ipcRenderer.invoke("harness:update", id, patch),
  nextQueued: (opts) => ipcRenderer.invoke("harness:next-queued", opts || { backend: "local-omni" }),
  isAborted: (id) => ipcRenderer.invoke("harness:aborted", id),
  cancelAgent: (id) => ipcRenderer.invoke("harness:cancel", id),
  clearAgents: (opts) => ipcRenderer.invoke("harness:clear-agents", opts),
  doctor: () => ipcRenderer.invoke("harness:doctor"),
  fs: {
    list: (opts) => ipcRenderer.invoke("fs:list", opts),
    read: (opts) => ipcRenderer.invoke("fs:read", opts),
    write: (opts) => ipcRenderer.invoke("fs:write", opts),
    append: (opts) => ipcRenderer.invoke("fs:append", opts),
    mkdir: (opts) => ipcRenderer.invoke("fs:mkdir", opts),
    remove: (opts) => ipcRenderer.invoke("fs:remove", opts),
    rename: (opts) => ipcRenderer.invoke("fs:rename", opts),
    copy: (opts) => ipcRenderer.invoke("fs:copy", opts),
    stat: (opts) => ipcRenderer.invoke("fs:stat", opts),
    search: (opts) => ipcRenderer.invoke("fs:search", opts),
    grep: (opts) => ipcRenderer.invoke("fs:grep", opts),
    glob: (opts) => ipcRenderer.invoke("fs:glob", opts),
    strReplace: (opts) => ipcRenderer.invoke("fs:str-replace", opts),
    applyEdits: (opts) => ipcRenderer.invoke("fs:apply-edits", opts),
    insertLines: (opts) => ipcRenderer.invoke("fs:insert-lines", opts),
    replaceLines: (opts) => ipcRenderer.invoke("fs:replace-lines", opts),
    tree: (opts) => ipcRenderer.invoke("fs:tree", opts),
    organize: (opts) => ipcRenderer.invoke("fs:organize", opts),
    findReplace: (opts) => ipcRenderer.invoke("fs:find-replace", opts),
    run: (opts) => ipcRenderer.invoke("fs:run", opts),
    openTerminal: (opts) => ipcRenderer.invoke("fs:open-terminal", opts),
    open: (opts) => ipcRenderer.invoke("fs:open", opts),
  },
  onChange: (handler) => {
    const listener = (_event, snapshot) => handler(snapshot);
    ipcRenderer.on("harness:change", listener);
    return () => ipcRenderer.removeListener("harness:change", listener);
  },
  onAgentEvent: (handler) => {
    const listener = (_event, payload) => handler(payload);
    ipcRenderer.on("harness:event", listener);
    return () => ipcRenderer.removeListener("harness:event", listener);
  },
};

contextBridge.exposeInMainWorld("omniDesktop", api);
