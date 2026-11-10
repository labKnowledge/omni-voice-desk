/**
 * Background job runner — flexible helper, not a rigid checklist.
 * Claude Code pattern: gather → act → verify; stop when text reply has no tools.
 */

import { createWorkspaceTools } from "./workspace-tools.js";

const MAX_ROUNDS = 18;
const STUCK_REPEAT = 4;

const CODING_SYSTEM = `You are a background subagent for Omni Voice Desk.
The front voice agent only converses; YOU do the real workspace work and your status updates are how progress is reported.

Pattern: gather context → take action → verify → finish.

## Doing tasks
Match the assigned goal. Don't add features or refactors beyond the task. Prefer editing existing files. Be accurate about verified vs assumed.

## Using tools
Prefer specialized tools over shell:
- Orient: tree, list_dir, glob, grep, search_files
- Read: read_file (use offset_lines/limit_lines for large files)
- Edit: edit_file / apply_edits / insert_lines / replace_lines (prefer these over rewrite). write_file for new files only.
- Organize: make_dir, organize_files, rename_path, copy_path, remove_path, find_replace
- Shell: run_command for builds/git/package managers (invisible — never opens Terminal.app). NEVER call open_terminal or launch_app("Terminal") unless the goal explicitly asks — and at most once.
Paths are RELATIVE to the workspace. Parallelize independent tools; sequence dependent ones. If a tool fails, change approach.

## Reporting
Your tool activity is streamed to the swarm board automatically. When finished, call mark_done with a short result the conductor can read to the user — or reply in plain text and stop.`;

function fingerprintCall(call) {
  const name = call?.function?.name || "";
  let args = call?.function?.arguments;
  try {
    args = typeof args === "string" ? args : JSON.stringify(args ?? {});
  } catch {
    args = String(args ?? "");
  }
  return `${name}:${args}`;
}

async function buildUserPrompt(api, job) {
  let peek = "";
  try {
    const listed = await api.fs.list({
      workspace: job.workspace,
      path: ".",
      depth: 1,
      max: 40,
    });
    const lines = (listed.entries || []).slice(0, 30).map((e) =>
      e.type === "dir" ? `${e.path}/` : e.path,
    );
    peek = lines.join(", ") || "(empty)";
  } catch {
    peek = "(could not list)";
  }

  const goal = String(job.goal || "").trim();
  const acceptance = String(job.acceptance || "").trim();

  return [
    "You are continuing a helpful coding session as a background job.",
    "",
    "## Request",
    goal,
    acceptance ? `\n## Success looks like\n${acceptance}` : "",
    "",
    "## Workspace",
    `Root: ${job.workspace}`,
    `Top-level: ${peek}`,
    "Use relative paths for file tools.",
    "",
    "Work flexibly. When finished, mark_done or reply in plain text with no more tool calls.",
  ].filter(Boolean).join("\n");
}

/**
 * @param {object} hooks
 * @param {() => boolean} hooks.isReady
 * @param {(job: object) => Promise<{content?: string, finish_reason?: string}>} hooks.runTextAgent
 * @param {(msg: string) => void} [hooks.toast]
 */
export function startLocalAgentRunner(hooks) {
  const api = window.omniDesktop;
  if (!api?.isDesktop) return { stop() {} };

  let busy = false;
  let stopped = false;
  const controllers = new Map();

  const tick = async () => {
    if (stopped || busy || !hooks.isReady()) return;
    // Only claim in-app Omni jobs; installed CLIs are run by Electron main.
    const job = await api.nextQueued({ backend: "local-omni" }).catch(() => null);
    if (!job) return;
    busy = true;
    const ac = new AbortController();
    controllers.set(job.id, ac);

    let doneSummary = null;
    let stuckReason = null;
    const recentFingerprints = [];

    try {
      const brief = String(job.goal || "").trim().slice(0, 100);
      await api.updateAgent(job.id, {
        status: "running",
        summary: brief ? `Working: ${brief}` : "Working…",
        logLine: `Subagent started · ${brief || job.id}`,
      });
      hooks.toast?.(`Subagent started: ${job.title}`);

      const tools = createWorkspaceTools(api, {
        getWorkspace: () => job.workspace,
        includeMarkDone: true,
        onDone: (summary) => {
          doneSummary = summary;
          try { ac.abort(); } catch { /* ignore */ }
        },
      });
      const userPrompt = await buildUserPrompt(api, job);

      const pollAbort = setInterval(async () => {
        if (ac.signal.aborted) return;
        const aborted = await api.isAborted(job.id).catch(() => false);
        if (aborted) ac.abort();
      }, 800);

      let lastTool = "";
      let round = 0;
      let lastToastAt = 0;
      try {
        const result = await hooks.runTextAgent({
          system: CODING_SYSTEM,
          user: userPrompt,
          tools,
          maxRounds: MAX_ROUNDS,
          signal: ac.signal,
          onEvent: (ev) => {
            if (ev?.type === "turn_start") {
              round = (ev.round ?? round) + 1;
            }
            if (ev?.type === "tool_start") {
              lastTool = ev.call?.function?.name || "tool";
              const fp = fingerprintCall(ev.call);
              recentFingerprints.push(fp);
              if (recentFingerprints.length > STUCK_REPEAT) recentFingerprints.shift();
              if (
                recentFingerprints.length >= STUCK_REPEAT
                && recentFingerprints.every((x) => x === fp)
              ) {
                stuckReason = `Stuck repeating ${lastTool}`;
                try { ac.abort(); } catch { /* ignore */ }
                return;
              }
              if (lastTool === "mark_done") {
                api.updateAgent(job.id, {
                  logLine: `r${round} · finishing`,
                  summary: "Wrapping up…",
                }).catch(() => {});
                return;
              }
              const summary = `${lastTool}…`;
              api.updateAgent(job.id, {
                logLine: `r${round} · ${lastTool}`,
                summary,
              }).catch(() => {});
              // Throttled progress toast so the conductor/user sees movement
              const now = Date.now();
              if (now - lastToastAt > 12_000) {
                lastToastAt = now;
                hooks.toast?.(`${job.title}: ${lastTool}`);
              }
            } else if (ev?.type === "tool_end") {
              const name = ev.call?.function?.name || lastTool || "tool";
              if (name === "mark_done") return;
              const detail = ev.details?.summary || (ev.is_error ? "fail" : "ok");
              api.updateAgent(job.id, {
                logLine: `r${round} · ${name}: ${String(detail).slice(0, 80)}`,
                summary: `${name}: ${String(detail).slice(0, 70)}`,
              }).catch(() => {});
            }
          },
        });

        clearInterval(pollAbort);

        const userCancelled = await api.isAborted(job.id).catch(() => false);
        if (userCancelled && !doneSummary) {
          await api.updateAgent(job.id, { status: "failed", summary: "Cancelled", logLine: "Cancelled" });
        } else if (stuckReason && !doneSummary) {
          await api.updateAgent(job.id, {
            status: "failed",
            summary: stuckReason,
            logLine: stuckReason,
          });
        } else {
          const content = doneSummary
            || (typeof result?.content === "string" ? result.content : null)
            || (result?.messages?.findLast?.((m) => m.role === "assistant")?.content)
            || "Done.";
          const summary = String(content).split(/\n/).map((l) => l.trim()).find(Boolean)?.slice(0, 160) || "Completed";
          const finish = result?.finish_reason;
          const note = finish === "max_rounds" && !doneSummary
            ? " (hit round limit)"
            : "";
          await api.updateAgent(job.id, {
            status: "completed",
            summary: `${summary}${note}`.slice(0, 200),
            logLine: doneSummary ? "Done" : (finish === "max_rounds" ? "Round limit" : "Completed"),
            result: String(content).slice(0, 4000),
          });
          hooks.toast?.(`Subagent done: ${job.title}`);
        }
      } catch (err) {
        clearInterval(pollAbort);
        if (doneSummary) {
          await api.updateAgent(job.id, {
            status: "completed",
            summary: doneSummary.slice(0, 200),
            logLine: "Done",
            result: doneSummary.slice(0, 4000),
          });
          hooks.toast?.(`Subagent done: ${job.title}`);
        } else if (stuckReason) {
          await api.updateAgent(job.id, {
            status: "failed",
            summary: stuckReason,
            logLine: stuckReason,
          });
          hooks.toast?.(`Subagent stuck: ${job.title}`);
        } else if (await api.isAborted(job.id).catch(() => false)) {
          await api.updateAgent(job.id, { status: "failed", summary: "Cancelled", logLine: "Cancelled" });
        } else {
          await api.updateAgent(job.id, {
            status: "failed",
            summary: err?.message || String(err),
            logLine: `Error: ${err?.message || err}`,
          });
          hooks.toast?.(`Subagent failed: ${job.title}`);
        }
      }
    } finally {
      controllers.delete(job.id);
      busy = false;
      setTimeout(() => { tick(); }, 200);
    }
  };

  const unsubEvent = api.onAgentEvent?.((payload) => {
    if (payload?.type === "queued" || payload?.type === "spawned") tick();
  });
  const unsubChange = api.onChange?.(() => tick());

  const boot = () => {
    if (!hooks.isReady()) {
      setTimeout(boot, 400);
      return;
    }
    tick();
  };
  boot();

  return {
    stop() {
      stopped = true;
      unsubEvent?.();
      unsubChange?.();
      for (const ac of controllers.values()) ac.abort();
    },
    kick: () => tick(),
  };
}
