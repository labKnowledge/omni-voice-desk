import { createWorkspaceTools, pack as packTool } from "./workspace-tools.js";

const emptyParams = { type: "object", properties: {} };

const pack = (content, summary) => packTool(content, summary);

function desktop() {
  return window.omniDesktop;
}

/** Live environment for the conversation conductor (not the coding worker). */
let liveContext = {
  workspace: null,
  workspaceSummary: "No workspace selected yet.",
  platform: typeof navigator !== "undefined" ? navigator.platform : "desktop",
  arch: "",
  agentsBrief: "No background agents running.",
  installedBrief: "Installed coding CLIs: probing…",
};

function formatAgentsBrief(agents = []) {
  if (!agents.length) return "No background agents running.";
  const lines = agents.slice(0, 8).map((a) => {
    const backend = a.agentLabel || a.backend || "local-omni";
    const bit = a.summary ? ` — ${String(a.summary).slice(0, 90)}` : "";
    return `- ${a.id}: ${a.status} · [${backend}] ${a.title || a.goal || "job"}${bit}`;
  });
  return `Background agents (subagents do the work; you only track them):\n${lines.join("\n")}`;
}

function formatInstalledBrief(installed = []) {
  const available = installed.filter((a) => a.available);
  if (!available.length) {
    return "Installed coding CLIs: none on PATH (local-omni still works).";
  }
  return `Installed coding CLIs (attach via spawn_coding_agent agent=…): ${available
    .map((a) => `${a.id}${a.version ? ` (${a.version})` : ""}`)
    .join(", ")}`;
}

export function updateLiveContext(snapshot) {
  if (!snapshot) return;
  if ("workspace" in snapshot) {
    liveContext.workspace = snapshot.workspace || null;
  }
  if (snapshot.workspaceInfo?.summary) {
    liveContext.workspaceSummary = snapshot.workspaceInfo.summary;
  } else if (snapshot.workspace) {
    liveContext.workspaceSummary = `Workspace: ${snapshot.workspace}`;
  }
  if (snapshot.environment?.platform) liveContext.platform = snapshot.environment.platform;
  if (snapshot.environment?.arch) liveContext.arch = snapshot.environment.arch;
  if (Array.isArray(snapshot.agents)) {
    liveContext.agentsBrief = formatAgentsBrief(snapshot.agents);
  }
  const installed = snapshot.installedAgents || snapshot.environment?.installedAgents;
  if (Array.isArray(installed)) {
    liveContext.installedBrief = formatInstalledBrief(installed);
  }
  refreshConductorPrompt();
}

/**
 * Front agent = conversation + light workspace tools.
 * Long / multi-step coding → spawn_coding_agent (subagent).
 */
export function buildConductorPrompt() {
  const wsLine = liveContext.workspace
    ? `Workspace: ${liveContext.workspace}`
    : "Workspace: none yet — call pick_workspace (or set_workspace) before file work.";

  return `You are Omni, the voice conversation agent inside Omni Voice Desk (Electron + WebGPU + LFM3-Omni).
Respond with interleaved text and audio. The user is hands-free. Keep replies short and natural.

## Your role
- Talk with the user, pick the workspace, and get things done.
- For quick work (read a file, small edit, make a folder, organize a few files) use workspace tools yourself: tree, list_dir, read_file, edit_file, write_file, apply_edits, organize_files, grep, glob, etc.
- For longer multi-step coding, spawn_coding_agent (attaches a real local coding CLI when installed), then keep talking and check list_agents / agent_status.
- Paths are RELATIVE to the workspace. Never invent absolute paths for file tools.

## How to handle requests
1. Chitchat / device facts (time, battery, theme) → device tools.
2. Quick file / folder work → do it with workspace tools, then confirm briefly.
3. Big coding jobs → spawn_coding_agent with a clear goal + acceptance.
   - agent="auto" (default): prefer an installed CLI (cursor-agent, claude, …), else local-omni.
   - agent="cursor-agent" / "claude" / …: pin a specific installed CLI.
   - agent="local-omni": in-app Omni text subagent (offline / GPU).
4. Status → list_agents / agent_status. Stop → cancel_agent. Clean board → clear_agent_board.
5. No workspace yet → pick_workspace first.
6. Unsure what CLIs exist → list_installed_agents.

## Live board
${liveContext.agentsBrief}

## Environment
- App: Omni Voice Desk on ${liveContext.platform}${liveContext.arch ? ` / ${liveContext.arch}` : ""}
- ${wsLine}
- Peek: ${liveContext.workspaceSummary}
- ${liveContext.installedBrief}

## Tools
Workspace: tree, list_dir, glob, grep, search_files, stat_path, read_file, write_file, edit_file, str_replace, apply_edits, insert_lines, replace_lines, append_file, find_replace, make_dir, organize_files, remove_path, rename_path, copy_path, run_command, open_path, launch_app, open_terminal (rare)
Harness: pick_workspace, set_workspace, inspect_workspace, get_environment, list_installed_agents, spawn_coding_agent, list_agents, agent_status, cancel_agent, clear_agent_board
Device: get_local_time, set_timer, cancel_timer, get_device_info, get_battery, get_connection, get_location, copy_to_clipboard, set_theme`;
}

function refreshConductorPrompt() {
  const prompt = buildConductorPrompt();
  window.OmniConductorPrompt = prompt;
  return prompt;
}

export function createAgentTools() {
  const api = desktop();
  if (!api?.isDesktop) return [];

  refreshConductorPrompt();
  api.getSnapshot?.().then((snap) => updateLiveContext(snap)).catch(() => {});
  api.onChange?.((snap) => updateLiveContext(snap));
  api.onAgentEvent?.((payload) => {
    // Keep conductor prompt fresh when jobs queue / finish; snapshot arrives via onChange too.
    if (payload?.type === "queued" || payload?.type === "spawned" || payload?.type === "cancelled" || payload?.type === "cleared") {
      api.getSnapshot?.().then((snap) => updateLiveContext(snap)).catch(() => {});
    }
  });

  const workspaceTools = createWorkspaceTools(api, {
    getWorkspace: () => liveContext.workspace,
  });

  return [
    ...workspaceTools,
    {
      name: "set_workspace",
      activity: "Setting workspace",
      description: "Set the project folder by absolute path. Prefer pick_workspace for interactive choice.",
      parameters: {
        type: "object",
        properties: {
          path: { type: "string", description: "Absolute path to a local project folder" },
        },
      },
      async execute(args) {
        if (args?.path) {
          const result = await api.setWorkspace(String(args.path));
          updateLiveContext({
            workspace: result.workspace,
            workspaceInfo: result.workspaceInfo,
            agents: (await api.getSnapshot().catch(() => ({})))?.agents,
          });
          return pack(
            `Workspace is now ${result.workspace}. ${result.workspaceInfo?.summary || ""}`,
            result.workspace,
          );
        }
        const picked = await api.pickWorkspace();
        if (!picked) throw new Error("The user cancelled the workspace picker.");
        updateLiveContext({
          workspace: picked.workspace,
          workspaceInfo: picked.workspaceInfo,
        });
        return pack(`Workspace is now ${picked.workspace}. ${picked.workspaceInfo?.summary || ""}`, picked.workspace);
      },
    },
    {
      name: "pick_workspace",
      activity: "Choosing workspace",
      description: "Open a folder picker so the user can choose the coding workspace.",
      parameters: emptyParams,
      async execute() {
        const picked = await api.pickWorkspace();
        if (!picked) throw new Error("The user cancelled the workspace picker.");
        updateLiveContext({
          workspace: picked.workspace,
          workspaceInfo: picked.workspaceInfo,
        });
        return pack(`Workspace is now ${picked.workspace}. ${picked.workspaceInfo?.summary || ""}`, picked.workspace);
      },
    },
    {
      name: "inspect_workspace",
      activity: "Peeking at project",
      description:
        "Quick top-level peek of the workspace so you can brief the user or write a better subagent goal. Do not use this to do the coding work yourself.",
      parameters: {
        type: "object",
        properties: {
          depth: { type: "integer", description: "1–2 preferred" },
        },
      },
      async execute(args) {
        const depth = Math.min(2, Math.max(1, Number(args?.depth) || 1));
        const info = await api.inspectWorkspace({ depth });
        const lines = (info.entries || []).map((e) =>
          e.type === "dir" ? `- ${e.path}/` : `- ${e.path}`,
        );
        return pack(
          `Workspace ${info.path}\n${info.summary}\n\nContents:\n${lines.join("\n") || "(empty)"}\n\nDelegate real work with spawn_coding_agent.`,
          info.name || "Workspace",
        );
      },
    },
    {
      name: "get_environment",
      activity: "Checking environment",
      description: "Confirm workspace, platform, and which coding agents are attachable.",
      parameters: emptyParams,
      async execute() {
        const env = await api.getEnvironment();
        const snap = await api.getSnapshot().catch(() => null);
        updateLiveContext(snap || { workspace: env.workspace, environment: env });
        return pack(
          [
            `App: ${env.app} on ${env.platform}/${env.arch}`,
            `Workspace: ${env.workspace || "(none set)"}`,
            snap?.workspaceInfo?.summary ? `Peek: ${snap.workspaceInfo.summary}` : null,
            "You are the conversation conductor. Subagents / installed CLIs do coding.",
            liveContext.installedBrief,
            liveContext.agentsBrief,
          ].filter(Boolean).join("\n"),
          env.workspace ? pathTail(env.workspace) : "No workspace",
        );
      },
    },
    {
      name: "list_installed_agents",
      activity: "Listing coding CLIs",
      description:
        "List already-installed local coding agents on PATH (cursor-agent, claude, …) that can be attached via spawn_coding_agent.",
      parameters: emptyParams,
      async execute() {
        const list = await api.listInstalledAgents({ force: true });
        const lines = list.map((a) =>
          a.available
            ? `- ${a.id}: available · ${a.version || "ok"} · ${a.bin}`
            : `- ${a.id}: not found`,
        );
        const available = list.filter((a) => a.available);
        const snap = await api.getSnapshot().catch(() => ({}));
        updateLiveContext({
          installedAgents: list,
          agents: snap?.agents,
        });
        return pack(
          available.length
            ? `Attach with spawn_coding_agent agent=<id> (or agent=auto).\n${lines.join("\n")}`
            : `No installed coding CLIs found. Use agent="local-omni" or install cursor-agent / claude.\n${lines.join("\n")}`,
          available.length ? `${available.length} ready` : "None installed",
        );
      },
    },
    {
      name: "spawn_coding_agent",
      activity: "Delegating to subagent",
      description:
        "Delegate project work to a background agent. Prefer installed CLIs (cursor-agent, claude) via agent=auto or a specific id; use local-omni for the in-app Omni text worker. Returns immediately — you keep conversing.",
      parameters: {
        type: "object",
        properties: {
          goal: {
            type: "string",
            description: "Clear task for the subagent (what to do in the workspace)",
          },
          title: {
            type: "string",
            description: "Short label for the swarm panel",
          },
          workspace: {
            type: "string",
            description: "Optional override workspace path",
          },
          acceptance: {
            type: "string",
            description: "Done-when criteria for the subagent",
          },
          agent: {
            type: "string",
            description:
              'Which engine: "auto" (default, prefer installed CLI), "local-omni", or an installed id like "cursor-agent" / "claude".',
          },
        },
        required: ["goal"],
      },
      async execute(args) {
        const goal = String(args?.goal || "").trim();
        if (!goal) throw new Error("goal is required");
        const agent = await api.spawnAgent({
          goal: goal.slice(0, 2000),
          title: args?.title ? String(args.title).slice(0, 72) : goal.slice(0, 72),
          workspace: args?.workspace ? String(args.workspace) : undefined,
          acceptance: args?.acceptance ? String(args.acceptance).slice(0, 600) : undefined,
          agent: args?.agent ? String(args.agent) : "auto",
        });
        const engine = agent.agentLabel || agent.backend || "local-omni";
        return pack(
          `Subagent "${agent.title}" queued (${agent.id}) via ${engine} in ${agent.workspace}. Progress shows on the swarm board. Keep talking; use list_agents / agent_status for updates.`,
          `Delegated · ${engine} · ${agent.title}`,
        );
      },
    },
    {
      name: "list_agents",
      activity: "Checking subagents",
      description: "List background subagents and their latest status/progress.",
      parameters: emptyParams,
      async execute() {
        const agents = await api.listAgents();
        if (!agents.length) return pack("No subagents yet.", "No agents");
        const lines = agents.map((a) => {
          const engine = a.agentLabel || a.backend || "local-omni";
          return `- ${a.id}: ${a.status} · [${engine}] ${a.title} · ${a.summary || ""}`;
        });
        return pack(`Subagents:\n${lines.join("\n")}`, `${agents.length} job${agents.length === 1 ? "" : "s"}`);
      },
    },
    {
      name: "agent_status",
      activity: "Subagent status",
      description: "Detailed status and recent log for one subagent (their progress reports).",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      async execute(args) {
        const agent = await api.agentStatus(String(args?.id || ""));
        const tail = (agent.logTail || []).slice(-8).join("\n");
        const engine = agent.agentLabel || agent.backend || "local-omni";
        return pack(
          [
            `Subagent ${agent.id} (${agent.title}) via ${engine} is ${agent.status}.`,
            agent.summary || "",
            agent.result ? `Result: ${String(agent.result).slice(0, 800)}` : null,
            tail ? `Progress log:\n${tail}` : null,
          ].filter(Boolean).join("\n"),
          `${agent.status} · ${engine} · ${agent.title}`,
        );
      },
    },
    {
      name: "cancel_agent",
      activity: "Stopping subagent",
      description: "Cancel a background subagent.",
      parameters: {
        type: "object",
        properties: { id: { type: "string" } },
        required: ["id"],
      },
      async execute(args) {
        const agent = await api.cancelAgent(String(args?.id || ""));
        return pack(`Cancelled subagent ${agent.id} (${agent.title}).`, "Cancelled");
      },
    },
    {
      name: "clear_agent_board",
      activity: "Clearing board",
      description: "Clean the swarm board. scope=finished (default) or all.",
      parameters: {
        type: "object",
        properties: {
          scope: { type: "string", enum: ["finished", "all"] },
        },
      },
      async execute(args) {
        const scope = args?.scope === "all" ? "all" : "finished";
        const result = await api.clearAgents({ scope });
        return pack(
          scope === "all"
            ? `Cleared board (${result.removed} removed, ${result.aborted} stopped).`
            : `Cleared ${result.removed} finished; ${result.remaining} still active.`,
          scope === "all" ? "Board cleared" : "Finished cleared",
        );
      },
    },
  ];
}

function pathTail(p) {
  const parts = String(p).split(/[/\\]/);
  return parts.filter(Boolean).at(-1) || p;
}

export const CONDUCTOR_SYSTEM_PROMPT = buildConductorPrompt();
