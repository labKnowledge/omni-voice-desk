"use strict";

const { EventEmitter } = require("node:events");
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const workspaceFs = require("./workspace-fs.cjs");
const externalAgents = require("./external-agents.cjs");

const HOME = process.env.OMNI_DESK_HOME
  || path.join(os.homedir(), ".local", "share", "omni-voice-desk");
const STATE_PATH = path.join(HOME, "harness-state.json");
const RUNS_DIR = path.join(HOME, "runs");

const SKIP_NAMES = new Set([
  "node_modules", ".git", ".svn", ".hg", ".DS_Store",
  "dist", "build", ".next", ".turbo", "coverage", "__pycache__",
]);

function ensureHome() {
  fs.mkdirSync(HOME, { recursive: true });
}

function readState() {
  ensureHome();
  try {
    return JSON.parse(fs.readFileSync(STATE_PATH, "utf8"));
  } catch {
    return { workspace: null, agents: {} };
  }
}

function writeState(state) {
  ensureHome();
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

function listEntries(dir, { depth = 1, max = 40 } = {}) {
  const out = [];
  const walk = (current, level, prefix) => {
    if (out.length >= max || level > depth) return;
    let names;
    try {
      names = fs.readdirSync(current);
    } catch {
      return;
    }
    names.sort((a, b) => a.localeCompare(b));
    for (const name of names) {
      if (out.length >= max) break;
      if (SKIP_NAMES.has(name) || name.startsWith(".git")) continue;
      const full = path.join(current, name);
      let stat;
      try {
        stat = fs.lstatSync(full);
      } catch {
        continue;
      }
      const rel = prefix ? `${prefix}/${name}` : name;
      if (stat.isDirectory()) {
        out.push({ path: rel, type: "dir" });
        if (level < depth) walk(full, level + 1, rel);
      } else if (stat.isFile()) {
        out.push({ path: rel, type: "file", size: stat.size });
      }
    }
  };
  walk(dir, 0, "");
  return out;
}

function describeWorkspace(workspacePath) {
  if (!workspacePath) {
    return { path: null, exists: false, entries: [], summary: "No workspace selected." };
  }
  const exists = fs.existsSync(workspacePath) && fs.statSync(workspacePath).isDirectory();
  if (!exists) {
    return {
      path: workspacePath,
      exists: false,
      entries: [],
      summary: `Workspace path is missing: ${workspacePath}`,
    };
  }
  const entries = listEntries(workspacePath, { depth: 1, max: 48 });
  const dirs = entries.filter((e) => e.type === "dir").length;
  const files = entries.filter((e) => e.type === "file").length;
  const top = entries.slice(0, 24).map((e) => (e.type === "dir" ? `${e.path}/` : e.path));
  return {
    path: workspacePath,
    name: path.basename(workspacePath),
    exists: true,
    entries,
    summary: `${path.basename(workspacePath)} · ${dirs} folders, ${files} files at top level. Notable: ${top.join(", ") || "(empty)"}`,
  };
}

/**
 * Self-contained agent harness.
 * Jobs run as:
 *  - local-omni — in-app LFM3 text agent + workspace tools
 *  - installed CLIs — cursor-agent / claude / … (OmnishPilot-style detect→spawn)
 */
class AgentHarness extends EventEmitter {
  constructor() {
    super();
    this.state = readState();
    this.abortFlags = new Map();
    /** @type {Map<string, import('child_process').ChildProcess>} */
    this.externalChildren = new Map();
  }

  listInstalledAgents({ force = false } = {}) {
    return externalAgents.detectAgents({ force }).map((a) => ({
      id: a.id,
      label: a.label,
      available: a.available,
      version: a.version,
      bin: a.bin,
    }));
  }

  resolveBackend(requested = "auto") {
    const raw = String(requested || "auto").trim().toLowerCase() || "auto";
    if (raw === "local" || raw === "local-omni" || raw === "omni") {
      return { backend: "local-omni", agentId: "local-omni", label: "Local Omni" };
    }
    if (raw === "auto") {
      const picked = externalAgents.pickAgent("auto");
      if (picked) {
        return { backend: picked.id, agentId: picked.id, label: picked.label };
      }
      return { backend: "local-omni", agentId: "local-omni", label: "Local Omni" };
    }
    const picked = externalAgents.pickAgent(raw);
    if (!picked) {
      const known = externalAgents.ADAPTERS.some((a) => a.id === raw);
      throw new Error(
        known
          ? `Agent "${raw}" is not installed or not on PATH.`
          : `Unknown agent "${raw}". Use local-omni, auto, or an installed id from list_installed_agents.`,
      );
    }
    return { backend: picked.id, agentId: picked.id, label: picked.label };
  }

  snapshot() {
    const info = describeWorkspace(this.state.workspace);
    const installed = this.listInstalledAgents();
    return {
      workspace: this.state.workspace,
      workspaceInfo: info,
      agents: Object.values(this.state.agents).sort((a, b) => b.createdAt - a.createdAt),
      installedAgents: installed,
      capabilities: {
        localOmni: true,
        workspaceFs: true,
        externalAgents: installed.filter((a) => a.available).map((a) => a.id),
      },
      environment: this.environmentBrief(),
    };
  }

  environmentBrief() {
    const installed = this.listInstalledAgents();
    const available = installed.filter((a) => a.available);
    return {
      app: "Omni Voice Desk",
      platform: process.platform,
      arch: process.arch,
      home: HOME,
      workspace: this.state.workspace,
      backends: {
        localOmni: "LFM3-Omni text agent (in-app)",
        installed: available.map((a) => `${a.id} (${a.version || "ok"})`),
      },
      installedAgents: installed,
      tools: [
        // Front conversation conductor
        "pick_workspace",
        "set_workspace",
        "inspect_workspace",
        "get_environment",
        "list_installed_agents",
        "spawn_coding_agent",
        "list_agents",
        "agent_status",
        "cancel_agent",
        "clear_agent_board",
        // Device helpers (conductor)
        "get_local_time",
        "set_timer",
        "get_device_info",
        "copy_to_clipboard",
        "set_theme",
        // Subagent-only workspace tools (not on the front agent)
        "list_dir",
        "tree",
        "read_file",
        "write_file",
        "edit_file",
        "apply_edits",
        "insert_lines",
        "replace_lines",
        "append_file",
        "str_replace",
        "find_replace",
        "make_dir",
        "organize_files",
        "remove_path",
        "rename_path",
        "copy_path",
        "stat_path",
        "search_files",
        "grep",
        "glob",
        "run_command",
        "open_terminal",
        "open_path",
        "launch_app",
      ],
    };
  }

  persist() {
    writeState(this.state);
    this.emit("change", this.snapshot());
  }

  setWorkspace(workspace) {
    if (!workspace) throw new Error("workspace path is required");
    const resolved = path.resolve(workspace);
    if (!fs.existsSync(resolved)) throw new Error(`workspace does not exist: ${resolved}`);
    const stat = fs.statSync(resolved);
    if (!stat.isDirectory()) throw new Error(`workspace is not a directory: ${resolved}`);
    this.state.workspace = resolved;
    this.persist();
    return {
      workspace: resolved,
      workspaceInfo: describeWorkspace(resolved),
    };
  }

  getWorkspace() {
    return this.state.workspace;
  }

  inspectWorkspace({ depth = 1 } = {}) {
    const ws = this.state.workspace;
    if (!ws) throw new Error("No workspace is set. Call pick_workspace first.");
    const info = describeWorkspace(ws);
    if (!info.exists) throw new Error(info.summary);
    if (depth > 1) {
      info.entries = listEntries(ws, { depth: Math.min(depth, 3), max: 80 });
      info.summary = `${info.name} · ${info.entries.length} entries (depth ${Math.min(depth, 3)})`;
    }
    return info;
  }

  /**
   * Queue a coding job.
   * agent: local-omni | auto | cursor-agent | claude | …
   * auto prefers an installed CLI, else local Omni.
   */
  async spawnAgent({ goal, workspace, acceptance, title, agent } = {}) {
    const text = String(goal || "").trim();
    if (!text) throw new Error("goal is required");
    const ws = path.resolve(workspace || this.state.workspace || "");
    if (!ws || !fs.existsSync(ws) || !fs.statSync(ws).isDirectory()) {
      throw new Error(
        this.state.workspace
          ? `workspace is missing or not a directory: ${ws || "(empty)"}`
          : "No workspace set. Ask the user to pick a project folder first.",
      );
    }
    this.state.workspace = ws;

    const resolved = this.resolveBackend(agent == null ? "auto" : agent);
    const id = `agent_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    const isLocal = resolved.backend === "local-omni";
    const record = {
      id,
      title: String(title || text).slice(0, 80),
      goal: text,
      workspace: ws,
      acceptance: acceptance ? String(acceptance) : null,
      status: "queued",
      backend: resolved.backend,
      agentId: resolved.agentId,
      agentLabel: resolved.label,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      summary: isLocal
        ? "Queued for local Omni text agent…"
        : `Queued for ${resolved.label}…`,
      logTail: [],
    };
    this.state.agents[id] = record;
    this.abortFlags.set(id, false);
    this.persist();
    this.emit("queued", { ...record });
    return { ...record };
  }

  updateAgent(id, patch = {}) {
    const record = this.state.agents[id];
    if (!record) throw new Error(`unknown agent ${id}`);
    const allowed = ["status", "summary", "logTail", "result", "agentId", "agentLabel", "backend"];
    for (const key of allowed) {
      if (patch[key] !== undefined) record[key] = patch[key];
    }
    if (Array.isArray(patch.logAppend) && patch.logAppend.length) {
      record.logTail = [...(record.logTail || []), ...patch.logAppend.map(String)].slice(-40);
    }
    if (typeof patch.logLine === "string" && patch.logLine) {
      record.logTail = [...(record.logTail || []), patch.logLine].slice(-40);
      if (!patch.summary) record.summary = patch.logLine;
    }
    record.updatedAt = Date.now();
    this.persist();
    return { ...record };
  }

  isAborted(id) {
    return Boolean(this.abortFlags.get(id));
  }

  async refresh(id) {
    const record = this.state.agents[id];
    if (!record) throw new Error(`unknown agent ${id}`);
    return { ...record };
  }

  listAgents() {
    return Object.values(this.state.agents).sort((a, b) => b.createdAt - a.createdAt);
  }

  nextQueued({ backend } = {}) {
    return this.listAgents().find((a) => {
      if (a.status !== "queued") return false;
      if (!backend) return true;
      if (backend === "local-omni") return a.backend === "local-omni" || !a.backend;
      if (backend === "external") return a.backend && a.backend !== "local-omni";
      return a.backend === backend;
    }) || null;
  }

  /**
   * Main-process runner for installed CLI agents (cursor-agent, claude, …).
   */
  startExternalJob(job) {
    if (!job?.id) throw new Error("job id required");
    if (job.backend === "local-omni" || !job.backend) {
      throw new Error("startExternalJob is for installed CLI backends only");
    }
    if (this.externalChildren.has(job.id)) {
      throw new Error(`job ${job.id} already has a running process`);
    }

    this.abortFlags.set(job.id, false);
    this.updateAgent(job.id, {
      status: "running",
      summary: `Starting ${job.agentLabel || job.backend}…`,
      logLine: `Spawn ${job.backend}`,
    });

    const runDir = path.join(RUNS_DIR, job.id);
    let { child, agent: resolved } = { child: null, agent: null };
    try {
      ({ child, agent: resolved } = externalAgents.spawnInstalledAgent({
        agentId: job.agentId || job.backend,
        workspace: job.workspace,
        goal: job.goal,
        acceptance: job.acceptance,
        title: job.title,
        runDir,
        onStdout: (line) => {
          this.updateAgent(job.id, {
            logLine: line.slice(0, 200),
            summary: line.slice(0, 120),
          });
        },
        onStderr: (line) => {
          this.updateAgent(job.id, {
            logLine: `stderr: ${line.slice(0, 180)}`,
          });
        },
      }));
    } catch (err) {
      this.updateAgent(job.id, {
        status: "failed",
        summary: err?.message || String(err),
        logLine: `Spawn failed: ${err?.message || err}`,
      });
      return null;
    }

    this.externalChildren.set(job.id, child);
    this.updateAgent(job.id, {
      summary: `Running ${resolved.label}…`,
      logLine: `${resolved.label} pid ${child.pid}`,
      agentLabel: resolved.label,
      agentId: resolved.id,
    });

    const finish = (status, summary, result) => {
      this.externalChildren.delete(job.id);
      if (this.isAborted(job.id) && status !== "completed") {
        this.updateAgent(job.id, {
          status: "failed",
          summary: "Cancelled",
          logLine: "Cancelled",
        });
        return;
      }
      this.updateAgent(job.id, {
        status,
        summary: String(summary || status).slice(0, 200),
        logLine: status === "completed" ? "Done" : summary,
        result: result ? String(result).slice(0, 4000) : undefined,
      });
    };

    child.on("error", (err) => {
      finish("failed", err?.message || String(err));
    });
    child.on("close", (code, signal) => {
      if (this.isAborted(job.id)) {
        finish("failed", "Cancelled");
        return;
      }
      if (code === 0) {
        const tail = (this.state.agents[job.id]?.logTail || []).slice(-6).join("\n");
        finish("completed", `${resolved.label} finished`, tail || `${resolved.label} exited 0`);
      } else {
        finish("failed", `${resolved.label} exited ${signal || code}`);
      }
    });

    return child;
  }

  async cancelAgent(id) {
    const record = this.state.agents[id];
    if (!record) throw new Error(`unknown agent ${id}`);
    this.abortFlags.set(id, true);
    const child = this.externalChildren.get(id);
    if (child) {
      externalAgents.killProcessTree(child);
      this.externalChildren.delete(id);
    }
    if (["queued", "starting", "running"].includes(record.status)) {
      record.status = "failed";
      record.summary = "Cancelled";
      record.updatedAt = Date.now();
      this.persist();
    }
    return { ...record };
  }

  /**
   * Clear the local agent board.
   * @param {{ scope?: "finished" | "all" }} opts
   *   finished — drop completed/failed/cancelled only (default)
   *   all — abort active jobs and wipe the board
   */
  clearAgents({ scope = "finished" } = {}) {
    const mode = scope === "all" ? "all" : "finished";
    const before = Object.keys(this.state.agents).length;
    const kept = {};
    let removed = 0;
    let aborted = 0;

    for (const [id, record] of Object.entries(this.state.agents)) {
      const active = ["queued", "starting", "running", "scheduled"].includes(record.status);
      if (mode === "all") {
        if (active) {
          this.abortFlags.set(id, true);
          const child = this.externalChildren.get(id);
          if (child) {
            externalAgents.killProcessTree(child);
            this.externalChildren.delete(id);
          }
          aborted += 1;
        }
        removed += 1;
        continue;
      }
      // finished: keep active jobs
      if (active) {
        kept[id] = record;
      } else {
        removed += 1;
        this.abortFlags.delete(id);
      }
    }

    this.state.agents = mode === "all" ? {} : kept;
    if (mode === "all") this.abortFlags.clear();
    this.persist();
    return {
      scope: mode,
      removed,
      aborted,
      remaining: Object.keys(this.state.agents).length,
      before,
    };
  }

  // Workspace file tools (used by the local text agent via IPC)
  _ws(opts) {
    return { ...opts, workspace: opts?.workspace || this.state.workspace };
  }
  fsList(opts) {
    return workspaceFs.list(this._ws(opts));
  }
  fsRead(opts) {
    return workspaceFs.readFile(this._ws(opts));
  }
  fsWrite(opts) {
    return workspaceFs.writeFile(this._ws(opts));
  }
  fsAppend(opts) {
    return workspaceFs.appendFile(this._ws(opts));
  }
  fsMkdir(opts) {
    return workspaceFs.mkdir(this._ws(opts));
  }
  fsRemove(opts) {
    return workspaceFs.remove(this._ws(opts));
  }
  fsRename(opts) {
    return workspaceFs.rename(this._ws(opts));
  }
  fsCopy(opts) {
    return workspaceFs.copy(this._ws(opts));
  }
  fsStat(opts) {
    return workspaceFs.statPath(this._ws(opts));
  }
  fsSearch(opts) {
    return workspaceFs.searchFiles(this._ws(opts));
  }
  fsGrep(opts) {
    return workspaceFs.grep(this._ws(opts));
  }
  fsGlob(opts) {
    return workspaceFs.globFiles(this._ws(opts));
  }
  fsStrReplace(opts) {
    return workspaceFs.strReplace(this._ws(opts));
  }
  fsApplyEdits(opts) {
    return workspaceFs.applyEdits(this._ws(opts));
  }
  fsInsertLines(opts) {
    return workspaceFs.insertLines(this._ws(opts));
  }
  fsReplaceLines(opts) {
    return workspaceFs.replaceLines(this._ws(opts));
  }
  fsTree(opts) {
    return workspaceFs.tree(this._ws(opts));
  }
  fsOrganize(opts) {
    return workspaceFs.organizeFiles(this._ws(opts));
  }
  fsFindReplace(opts) {
    return workspaceFs.findReplace(this._ws(opts));
  }
  fsRun(opts) {
    return workspaceFs.runCommand(this._ws(opts));
  }
  fsOpenTerminal(opts) {
    return workspaceFs.openTerminal(this._ws(opts));
  }
  fsOpen(opts) {
    return workspaceFs.openPath(this._ws(opts));
  }

  doctor() {
    const installed = this.listInstalledAgents({ force: true });
    return {
      home: HOME,
      workspace: this.state.workspace,
      workspaceInfo: describeWorkspace(this.state.workspace),
      backend: "local-omni + installed CLIs",
      installedAgents: installed,
      agentCount: Object.keys(this.state.agents).length,
    };
  }
}

module.exports = { AgentHarness, HOME, RUNS_DIR, describeWorkspace };
