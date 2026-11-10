"use strict";

/**
 * Distilled from OmnishPilot's agent-run engine:
 * detect already-installed coding-agent CLIs → pick one → spawn non-interactively.
 * No OmnishPilot daemon required; Desk owns the job board.
 */

const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawn, spawnSync } = require("node:child_process");

const ADAPTERS = [
  {
    id: "cursor-agent",
    label: "Cursor Agent",
    binNames: ["cursor-agent"],
    versionArgs: ["--version"],
    commandTemplate: '{BIN} --yolo -p --workspace "{WORKSPACE}" "{PROMPT}"',
    flattenPrompt: false,
  },
  {
    id: "claude",
    label: "Claude Code",
    binNames: ["claude"],
    versionArgs: ["--version"],
    commandTemplate: '{BIN} -p --dangerously-skip-permissions "{PROMPT}"',
    flattenPrompt: true,
  },
  {
    id: "agy",
    label: "Agy",
    binNames: ["agy"],
    versionArgs: ["--version"],
    commandTemplate: '{BIN} -p --dangerously-skip-permissions "{PROMPT}"',
    flattenPrompt: true,
  },
  {
    id: "codex",
    label: "Codex",
    binNames: ["codex"],
    versionArgs: ["--version"],
    commandTemplate: '{BIN} exec --full-auto "{PROMPT}"',
    flattenPrompt: true,
  },
  {
    id: "gemini",
    label: "Gemini CLI",
    binNames: ["gemini"],
    versionArgs: ["--version"],
    commandTemplate: '{BIN} -p "{PROMPT}"',
    flattenPrompt: true,
  },
];

const PREFERRED_ORDER = ["cursor-agent", "claude", "agy", "codex", "gemini"];

function agentBinDirs() {
  const home = os.homedir();
  const dirs = [
    path.join(home, ".local", "bin"),
    path.join(home, "bin"),
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
  ];
  const cursorVersions = path.join(home, ".local", "share", "cursor-agent", "versions");
  try {
    if (fs.existsSync(cursorVersions)) {
      const vers = fs.readdirSync(cursorVersions)
        .map((name) => path.join(cursorVersions, name))
        .filter((p) => {
          try { return fs.statSync(p).isDirectory(); } catch { return false; }
        })
        .sort()
        .reverse()
        .slice(0, 3);
      // Prepend newest first (unshift in reverse chronological order would invert).
      dirs.unshift(...vers);
    }
  } catch { /* ignore */ }
  return dirs.filter((d) => d && fs.existsSync(d));
}

function augmentedPath(base = process.env.PATH || "") {
  const parts = [];
  const seen = new Set();
  for (const d of [...agentBinDirs(), ...String(base).split(path.delimiter)]) {
    if (!d || seen.has(d)) continue;
    seen.add(d);
    parts.push(d);
  }
  return parts.join(path.delimiter);
}

function whichBin(name) {
  const pathEnv = augmentedPath();
  try {
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [name], {
      encoding: "utf8",
      timeout: 5000,
      env: { ...process.env, PATH: pathEnv },
    });
    if (r.status === 0) {
      const line = String(r.stdout || "").split(/\r?\n/).map((s) => s.trim()).find(Boolean);
      if (line && fs.existsSync(line)) return line;
    }
  } catch { /* ignore */ }
  for (const dir of agentBinDirs()) {
    const candidate = path.join(dir, name);
    if (fs.existsSync(candidate)) return candidate;
    if (process.platform === "win32") {
      for (const ext of [".cmd", ".exe", ".bat"]) {
        const w = candidate + ext;
        if (fs.existsSync(w)) return w;
      }
    }
  }
  return null;
}

function findBin(names) {
  for (const name of names) {
    const found = whichBin(name);
    if (found) return found;
  }
  return null;
}

function probeVersion(binPath, versionArgs) {
  try {
    const r = spawnSync(binPath, versionArgs, {
      encoding: "utf8",
      timeout: 10000,
      env: { ...process.env, PATH: augmentedPath() },
    });
    const out = String(r.stdout || r.stderr || "").trim().split(/\r?\n/);
    return out[0] || null;
  } catch {
    return null;
  }
}

let cache = { at: 0, list: [] };

function detectAgents({ force = false } = {}) {
  const now = Date.now();
  if (!force && now - cache.at < 30_000 && cache.list.length) return cache.list;
  const list = ADAPTERS.map((adapter) => {
    const bin = findBin(adapter.binNames);
    const version = bin ? probeVersion(bin, adapter.versionArgs) : null;
    return {
      id: adapter.id,
      label: adapter.label,
      bin,
      version,
      available: Boolean(bin && version != null),
      commandTemplate: adapter.commandTemplate,
      flattenPrompt: adapter.flattenPrompt,
    };
  });
  cache = { at: now, list };
  return list;
}

function pickAgent(requestedId = "auto") {
  const list = detectAgents();
  const byId = Object.fromEntries(list.map((a) => [a.id, a]));
  const usable = (id) => Boolean(byId[id]?.available);

  if (requestedId && requestedId !== "auto") {
    if (usable(requestedId)) return byId[requestedId];
    return null;
  }
  for (const id of PREFERRED_ORDER) {
    if (usable(id)) return byId[id];
  }
  return list.find((a) => a.available) || null;
}

function shlexSplit(input) {
  const out = [];
  let cur = "";
  let quote = null;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === "\\" && quote === '"' && i + 1 < input.length) {
        cur += input[++i];
      } else if (c === quote) {
        quote = null;
      } else {
        cur += c;
      }
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (/\s/.test(c)) {
      if (cur.length) {
        out.push(cur);
        cur = "";
      }
    } else {
      cur += c;
    }
  }
  if (cur.length) out.push(cur);
  return out;
}

function buildArgv(commandTemplate, values) {
  const tokens = shlexSplit(commandTemplate);
  return tokens.map((tok) => {
    let out = tok;
    for (const [key, val] of Object.entries(values)) {
      out = out.split(`{${key}}`).join(val == null ? "" : String(val));
    }
    return out;
  });
}

function buildPrompt({ goal, acceptance, workspace, title }) {
  const parts = [
    `# ${title || "Omni Voice Desk job"}`,
    "",
    "## Goal",
    String(goal || "").trim(),
    "",
    "## Workspace",
    workspace,
  ];
  if (acceptance) {
    parts.push("", "## Success looks like", String(acceptance).trim());
  }
  parts.push(
    "",
    "## Constraints",
    "Work inside the workspace. Prefer editing existing files. Be accurate about verified vs assumed.",
    "",
    "## When done",
    "Summarize what changed and how you verified it.",
  );
  return parts.join("\n");
}

/**
 * Spawn an installed agent CLI as a child process.
 * @returns {{ child: import('child_process').ChildProcess, argv: string[], agent: object, promptPath: string }}
 */
function spawnInstalledAgent({
  agentId = "auto",
  workspace,
  goal,
  acceptance,
  title,
  runDir,
  onStdout,
  onStderr,
} = {}) {
  const resolved = pickAgent(agentId);
  if (!resolved) {
    const want = agentId && agentId !== "auto" ? agentId : "any installed agent";
    throw new Error(
      `No available agent for "${want}". Install cursor-agent or claude, or use agent="local-omni".`,
    );
  }
  const adapter = ADAPTERS.find((a) => a.id === resolved.id);
  fs.mkdirSync(runDir, { recursive: true });
  let prompt = buildPrompt({ goal, acceptance, workspace, title });
  if (adapter.flattenPrompt) {
    prompt = prompt.split(/\s+/).filter(Boolean).join(" ");
  }
  const promptPath = path.join(runDir, "prompt.md");
  fs.writeFileSync(promptPath, prompt, "utf8");

  const argv = buildArgv(adapter.commandTemplate, {
    BIN: resolved.bin,
    WORKSPACE: workspace,
    MODEL: "",
    PROMPT: prompt,
  });

  const child = spawn(argv[0], argv.slice(1), {
    cwd: workspace,
    env: { ...process.env, PATH: augmentedPath() },
    stdio: ["ignore", "pipe", "pipe"],
    detached: process.platform !== "win32",
  });

  const push = (fn, chunk) => {
    const text = String(chunk || "");
    if (!text) return;
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed) fn?.(trimmed);
    }
  };
  child.stdout?.on("data", (buf) => push(onStdout, buf));
  child.stderr?.on("data", (buf) => push(onStderr, buf));

  return { child, argv, agent: resolved, promptPath, runDir };
}

function killProcessTree(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/pid", String(child.pid), "/T", "/F"], { timeout: 5000 });
    } else if (child.pid) {
      try { process.kill(-child.pid, "SIGTERM"); } catch { child.kill("SIGTERM"); }
      setTimeout(() => {
        try { process.kill(-child.pid, "SIGKILL"); } catch { /* ignore */ }
      }, 2500);
    } else {
      child.kill("SIGTERM");
    }
  } catch { /* ignore */ }
}

module.exports = {
  ADAPTERS,
  PREFERRED_ORDER,
  detectAgents,
  pickAgent,
  buildPrompt,
  spawnInstalledAgent,
  killProcessTree,
  augmentedPath,
};
