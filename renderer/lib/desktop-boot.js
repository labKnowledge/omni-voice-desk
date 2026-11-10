import { ContinuousVad } from "./vad.js";
import {
  createAgentTools,
  CONDUCTOR_SYSTEM_PROMPT,
  updateLiveContext,
  buildConductorPrompt,
} from "./agent-tools.js";
import {
  loadMicSettings,
  getMicSettings,
  saveMicSettings,
  onMicSettingsChange,
  gateStrengthLabel,
  DEFAULT_MIC_SETTINGS,
} from "./mic-settings.js";

window.OmniAgentTools = createAgentTools;
window.OmniConductorPrompt = CONDUCTOR_SYSTEM_PROMPT;
window.OmniBuildConductorPrompt = buildConductorPrompt;

function el(tag, className, children) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (Array.isArray(children)) node.append(...children);
  else if (children != null) node.textContent = children;
  return node;
}

function statusTone(status) {
  if (status === "completed") return "done";
  if (status === "failed") return "failed";
  if (status === "running" || status === "starting") return "running";
  return "idle";
}

function shortPath(p) {
  if (!p) return "";
  const parts = String(p).split(/[/\\]/).filter(Boolean);
  if (parts.length <= 2) return p;
  return `…/${parts.slice(-2).join("/")}`;
}

const MIC_ON_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v2.5"/></svg>`;
const MIC_OFF_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><rect x="9" y="3.5" width="6" height="11" rx="3"/><path d="M5.5 11.5a6.5 6.5 0 0 0 8.2 1.7M18.5 11.5a6.4 6.4 0 0 1-.4 2.2M12 18v2.5M4 4l16 16"/></svg>`;
const GEAR_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9c.3.6.9 1 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>`;
const SWARM_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="7.5" cy="8" r="2.2"/><circle cx="16.5" cy="8" r="2.2"/><circle cx="12" cy="16" r="2.2"/><path d="M9.4 9.4 10.8 14M14.6 9.4 13.2 14M9.7 8h4.6"/></svg>`;
const KEYBOARD_SVG = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2.5" y="6.5" width="19" height="11" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M6 13.5h.01M10 13.5h4M14 13.5h.01M18 13.5h.01"/></svg>`;

const SWARM_VISIBLE_KEY = "omni-swarm-visible";
const COMPOSER_OPEN_KEY = "omni-composer-open";

function loadSwarmVisible() {
  try {
    const v = localStorage.getItem(SWARM_VISIBLE_KEY);
    if (v === null) return true;
    return v !== "0" && v !== "false";
  } catch {
    return true;
  }
}

function saveSwarmVisible(visible) {
  try {
    localStorage.setItem(SWARM_VISIBLE_KEY, visible ? "1" : "0");
  } catch {
    /* ignore */
  }
}

export function mountAgentPanel(root) {
  const api = window.omniDesktop;
  if (!api?.isDesktop || !root) return null;

  let visible = loadSwarmVisible();
  let agentCount = 0;
  let runningCount = 0;

  const panel = el("aside", "agent-panel");
  panel.innerHTML = `
    <div class="agent-panel-head">
      <div>
        <div class="agent-panel-kicker">Local + installed CLIs</div>
        <div class="agent-panel-title">Agent swarm</div>
      </div>
      <div class="agent-panel-actions">
        <button type="button" class="pill-button" id="hide-swarm-btn" title="Hide agent swarm">Hide</button>
        <button type="button" class="pill-button" id="clear-agents-btn" title="Clear finished agents. Hold Option/Alt to clear all.">Clear</button>
        <button type="button" class="pill-button" id="pick-workspace-btn">Workspace</button>
      </div>
    </div>
    <p class="agent-workspace" id="agent-workspace">No workspace yet</p>
    <p class="agent-workspace-meta" id="agent-workspace-meta" hidden></p>
    <ul class="agent-list" id="agent-list"></ul>
    <p class="agent-empty" id="agent-empty">Ask for coding work — the conversation agent delegates here; subagents report progress as they go.</p>
  `;

  const showChip = el("button", "swarm-show-chip");
  showChip.type = "button";
  showChip.id = "show-swarm-btn";
  showChip.title = "Show agent swarm";
  showChip.setAttribute("aria-label", "Show agent swarm");
  showChip.innerHTML = `<span class="swarm-show-label">Swarm</span><span class="swarm-show-count" id="swarm-show-count" hidden></span>`;

  root.append(panel, showChip);

  const workspaceEl = panel.querySelector("#agent-workspace");
  const metaEl = panel.querySelector("#agent-workspace-meta");
  const listEl = panel.querySelector("#agent-list");
  const emptyEl = panel.querySelector("#agent-empty");
  const pickBtn = panel.querySelector("#pick-workspace-btn");
  const clearBtn = panel.querySelector("#clear-agents-btn");
  const hideBtn = panel.querySelector("#hide-swarm-btn");
  const countEl = showChip.querySelector("#swarm-show-count");

  const applyVisible = () => {
    root.classList.toggle("is-hidden", !visible);
    panel.hidden = !visible;
    showChip.hidden = visible;
    document.body.toggleAttribute("data-swarm-hidden", !visible);
    const headerBtn = document.querySelector("#swarm-toggle");
    if (headerBtn) {
      headerBtn.setAttribute("aria-pressed", String(visible));
      headerBtn.title = visible ? "Hide agent swarm" : "Show agent swarm";
      headerBtn.setAttribute("aria-label", headerBtn.title);
    }
  };

  const setVisible = (next) => {
    visible = Boolean(next);
    saveSwarmVisible(visible);
    applyVisible();
  };

  const syncChipCount = () => {
    if (!countEl) return;
    if (agentCount <= 0) {
      countEl.hidden = true;
      countEl.textContent = "";
      showChip.classList.toggle("has-running", false);
      return;
    }
    countEl.hidden = false;
    countEl.textContent = String(agentCount);
    showChip.classList.toggle("has-running", runningCount > 0);
  };

  const render = (snapshot) => {
    updateLiveContext(snapshot);
    workspaceEl.textContent = snapshot.workspace
      ? shortPath(snapshot.workspace)
      : "No workspace yet — ask me to pick one";
    workspaceEl.title = snapshot.workspace || "";
    const summary = snapshot.workspaceInfo?.summary;
    if (summary && snapshot.workspace) {
      metaEl.hidden = false;
      metaEl.textContent = summary;
    } else {
      metaEl.hidden = true;
      metaEl.textContent = "";
    }
    listEl.replaceChildren();
    const agents = snapshot.agents || [];
    agentCount = agents.length;
    runningCount = agents.filter((a) =>
      ["queued", "starting", "running", "scheduled"].includes(a.status),
    ).length;
    emptyEl.hidden = agents.length > 0;
    clearBtn.disabled = agents.length === 0;
    syncChipCount();
    for (const agent of agents.slice(0, 8)) {
      const item = el("li", `agent-item agent-${statusTone(agent.status)}`);
      const engine = agent.agentLabel || agent.backend || "local-omni";
      item.append(
        el("div", "agent-item-top", [
          el("span", "agent-dot"),
          el("strong", "", agent.title || agent.goal || agent.id),
          el("span", "agent-engine", engine),
          el("span", "agent-status", agent.status),
        ]),
        el("p", "agent-summary", agent.summary || "…"),
      );
      if (agent.status === "running" || agent.status === "starting" || agent.status === "scheduled" || agent.status === "queued") {
        const stop = el("button", "agent-stop", "Stop");
        stop.type = "button";
        stop.addEventListener("click", () => api.cancelAgent(agent.id).catch(() => {}));
        item.append(stop);
      }
      listEl.append(item);
    }
  };

  pickBtn.addEventListener("click", () => api.pickWorkspace().catch(() => {}));
  hideBtn.addEventListener("click", () => setVisible(false));
  showChip.addEventListener("click", () => setVisible(true));
  clearBtn.addEventListener("click", async (ev) => {
    const scope = ev.altKey ? "all" : "finished";
    if (scope === "all") {
      const ok = window.confirm("Clear the whole agent board and stop any running jobs?");
      if (!ok) return;
    }
    try {
      await api.clearAgents({ scope });
    } catch {
      /* ignore */
    }
  });

  // Header toggle (mounted later) — bind when present / via event
  const bindHeaderToggle = () => {
    const headerBtn = document.querySelector("#swarm-toggle");
    if (!headerBtn || headerBtn.dataset.bound === "1") return;
    headerBtn.dataset.bound = "1";
    headerBtn.addEventListener("click", () => setVisible(!visible));
    applyVisible();
  };
  bindHeaderToggle();
  // In case header mounts after us
  queueMicrotask(bindHeaderToggle);
  setTimeout(bindHeaderToggle, 0);

  applyVisible();
  api.getSnapshot().then(render).catch(() => {});
  api.onChange(render);
  return { panel, render, setVisible, isVisible: () => visible };
}

function syncMuteUi(muted) {
  document.body.toggleAttribute("data-mic-muted", muted);
  const btn = document.querySelector("#mic-mute-toggle");
  if (!btn) return;
  btn.setAttribute("aria-pressed", String(muted));
  btn.title = muted ? "Unmute microphone" : "Mute microphone";
  btn.setAttribute("aria-label", muted ? "Unmute microphone" : "Mute microphone");
  btn.innerHTML = muted ? MIC_OFF_SVG : MIC_ON_SVG;
  btn.classList.toggle("is-muted", muted);
}

function syncSettingsOpen(open) {
  document.body.toggleAttribute("data-settings-open", open);
  const panel = document.querySelector("#mic-settings");
  const btn = document.querySelector("#mic-settings-toggle");
  if (panel) {
    panel.hidden = !open;
    panel.setAttribute("aria-hidden", String(!open));
  }
  if (btn) btn.setAttribute("aria-expanded", String(open));
}

function fillSettingsForm(settings) {
  const root = document.querySelector("#mic-settings");
  if (!root) return;
  const set = (id, value, isCheck = false) => {
    const node = root.querySelector(`#${id}`);
    if (!node) return;
    if (isCheck) node.checked = Boolean(value);
    else node.value = String(value);
  };
  set("mic-setting-ignore-own", settings.ignoreOwnVoice, true);
  set("mic-setting-proximity", settings.proximityGate, true);
  set("mic-setting-barge", settings.bargeIn, true);
  set("mic-setting-gate", Math.round(settings.gateStrength * 100));
  set("mic-setting-start", Math.round(settings.startThreshold * 1000));
  set("mic-setting-hold", Math.round(settings.continueThreshold * 1000));
  set("mic-setting-silence", settings.silenceMs);
  set("mic-setting-echo", settings.echoCooldownMs);
  const gateLabel = root.querySelector("#mic-setting-gate-label");
  if (gateLabel) gateLabel.textContent = gateStrengthLabel(settings.gateStrength);
  const startVal = root.querySelector("#mic-setting-start-val");
  if (startVal) startVal.textContent = settings.startThreshold.toFixed(3);
  const holdVal = root.querySelector("#mic-setting-hold-val");
  if (holdVal) holdVal.textContent = settings.continueThreshold.toFixed(3);
  const silenceVal = root.querySelector("#mic-setting-silence-val");
  if (silenceVal) silenceVal.textContent = `${settings.silenceMs} ms`;
  const echoVal = root.querySelector("#mic-setting-echo-val");
  if (echoVal) echoVal.textContent = `${settings.echoCooldownMs} ms`;
  root.classList.toggle("gate-off", !settings.proximityGate);
}

function readSettingsForm() {
  const root = document.querySelector("#mic-settings");
  if (!root) return getMicSettings();
  const num = (id, fallback) => {
    const node = root.querySelector(`#${id}`);
    const v = Number(node?.value);
    return Number.isFinite(v) ? v : fallback;
  };
  return {
    ignoreOwnVoice: Boolean(root.querySelector("#mic-setting-ignore-own")?.checked),
    proximityGate: Boolean(root.querySelector("#mic-setting-proximity")?.checked),
    bargeIn: Boolean(root.querySelector("#mic-setting-barge")?.checked),
    gateStrength: num("mic-setting-gate", 55) / 100,
    startThreshold: num("mic-setting-start", 85) / 1000,
    continueThreshold: num("mic-setting-hold", 42) / 1000,
    silenceMs: num("mic-setting-silence", 480),
    echoCooldownMs: num("mic-setting-echo", 600),
  };
}

export function mountMicSettings() {
  if (document.querySelector("#mic-settings")) return;

  const panel = el("aside", "mic-settings");
  panel.id = "mic-settings";
  panel.hidden = true;
  panel.setAttribute("aria-hidden", "true");
  panel.setAttribute("aria-label", "Microphone settings");
  panel.innerHTML = `
    <div class="mic-settings-head">
      <div>
        <div class="mic-settings-kicker">Capture</div>
        <div class="mic-settings-title">Microphone</div>
      </div>
      <button type="button" class="icon-button" id="mic-settings-close" aria-label="Close settings">${MIC_OFF_SVG.replace("16 16", "18 18")}</button>
    </div>
    <p class="mic-settings-lead">Mute when you don’t want Omni listening. Raise the proximity gate so only the closest voice opens the mic.</p>

    <div class="mic-meter" aria-hidden="true">
      <div class="mic-meter-track"><div class="mic-meter-fill" id="mic-meter-fill"></div><div class="mic-meter-gate" id="mic-meter-gate"></div></div>
      <div class="mic-meter-labels"><span>Level</span><span id="mic-meter-state">Idle</span></div>
    </div>

    <label class="mic-toggle-row">
      <span>
        <strong>Ignore Omni’s voice</strong>
        <small>Don’t capture speaker playback as your speech</small>
      </span>
      <input type="checkbox" id="mic-setting-ignore-own" checked />
    </label>

    <label class="mic-toggle-row">
      <span>
        <strong>Proximity gate</strong>
        <small>Ignore distant talk and room noise</small>
      </span>
      <input type="checkbox" id="mic-setting-proximity" checked />
    </label>

    <label class="mic-slider-row" id="mic-gate-row">
      <span class="mic-slider-top"><strong>Closeness</strong><em id="mic-setting-gate-label">Close</em></span>
      <input type="range" id="mic-setting-gate" min="0" max="100" step="1" value="55" />
      <span class="mic-slider-hint">Room ← → Very close</span>
    </label>

    <label class="mic-toggle-row">
      <span>
        <strong>Allow loud interrupt</strong>
        <small>Only a very loud voice can cut Omni off</small>
      </span>
      <input type="checkbox" id="mic-setting-barge" />
    </label>

    <details class="mic-advanced">
      <summary>Advanced</summary>
      <label class="mic-slider-row">
        <span class="mic-slider-top"><strong>Base sensitivity</strong><em id="mic-setting-start-val">0.085</em></span>
        <input type="range" id="mic-setting-start" min="20" max="300" step="5" value="85" />
      </label>
      <label class="mic-slider-row">
        <span class="mic-slider-top"><strong>Hold level</strong><em id="mic-setting-hold-val">0.042</em></span>
        <input type="range" id="mic-setting-hold" min="10" max="200" step="5" value="42" />
      </label>
      <label class="mic-slider-row">
        <span class="mic-slider-top"><strong>End silence</strong><em id="mic-setting-silence-val">480 ms</em></span>
        <input type="range" id="mic-setting-silence" min="220" max="1200" step="20" value="480" />
      </label>
      <label class="mic-slider-row">
        <span class="mic-slider-top"><strong>Echo cooldown</strong><em id="mic-setting-echo-val">600 ms</em></span>
        <input type="range" id="mic-setting-echo" min="0" max="1500" step="50" value="600" />
      </label>
      <button type="button" class="pill-button" id="mic-settings-reset">Reset defaults</button>
    </details>
  `;

  // Fix close button icon — use a simple X
  panel.querySelector("#mic-settings-close").innerHTML =
    `<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M6 6l12 12M18 6 6 18"/></svg>`;

  document.querySelector(".app")?.append(panel);

  const persistFromForm = () => {
    const next = saveMicSettings(readSettingsForm());
    fillSettingsForm(next);
  };

  panel.querySelector("#mic-settings-close")?.addEventListener("click", () => syncSettingsOpen(false));
  for (const id of ["mic-setting-ignore-own", "mic-setting-proximity", "mic-setting-barge"]) {
    panel.querySelector(`#${id}`)?.addEventListener("change", persistFromForm);
  }
  for (const id of ["mic-setting-gate", "mic-setting-start", "mic-setting-hold", "mic-setting-silence", "mic-setting-echo"]) {
    panel.querySelector(`#${id}`)?.addEventListener("input", () => {
      fillSettingsForm({ ...getMicSettings(), ...readSettingsForm() });
    });
    panel.querySelector(`#${id}`)?.addEventListener("change", persistFromForm);
  }
  panel.querySelector("#mic-settings-reset")?.addEventListener("click", () => {
    const next = saveMicSettings({ ...DEFAULT_MIC_SETTINGS, muted: getMicSettings().muted });
    fillSettingsForm(next);
  });

  fillSettingsForm(getMicSettings());
}

function updateMicMeter(level = 0, meta = {}) {
  const fill = document.querySelector("#mic-meter-fill");
  const gate = document.querySelector("#mic-meter-gate");
  const state = document.querySelector("#mic-meter-state");
  if (!fill) return;
  const pct = Math.round(Math.min(1, level) * 100);
  fill.style.width = `${pct}%`;
  fill.classList.toggle("is-open", Boolean(meta.open));
  if (gate && meta.gated != null) {
    gate.style.left = `${Math.round(Math.min(1, meta.gated) * 100)}%`;
  }
  if (state) {
    if (document.body.hasAttribute("data-mic-muted")) state.textContent = "Muted";
    else if (meta.suppressed) state.textContent = "Holding (Omni speaking)";
    else if (meta.open) state.textContent = "Open";
    else state.textContent = "Gated";
  }
}

/**
 * @param {object} hooks
 */
export async function startHandsFree(hooks) {
  let enabled = Boolean(navigator.mediaDevices?.getUserMedia);
  let vad = null;
  let echoHoldUntil = 0;
  let wasPlaying = false;
  loadMicSettings();

  const applyToVad = (next = getMicSettings()) => {
    vad?.applySettings(next);
    syncMuteUi(next.muted);
    fillSettingsForm(next);
  };

  const setMuted = (muted) => {
    const next = saveMicSettings({ muted: Boolean(muted) });
    vad?.setMuted(next.muted);
    syncMuteUi(next.muted);
    updateVoiceActivityLabel();
    hooks.toast?.(next.muted ? "Microphone muted" : "Microphone live");
  };

  const shouldSuppressCapture = () => {
    const s = getMicSettings();
    if (!s.ignoreOwnVoice) return false;
    const playing = Boolean(hooks.isPlaying?.());
    if (playing) {
      wasPlaying = true;
      echoHoldUntil = performance.now() + (s.echoCooldownMs || 0);
      return true;
    }
    // After Omni finishes speaking, keep ignoring briefly so speaker echo isn't captured.
    if (wasPlaying) {
      wasPlaying = false;
      echoHoldUntil = performance.now() + (s.echoCooldownMs || 0);
    }
    return performance.now() < echoHoldUntil;
  };

  onMicSettingsChange((next) => {
    applyToVad(next);
  });

  const setEnabled = async (next) => {
    enabled = next;
    document.body.toggleAttribute("data-handsfree", enabled);
    hooks.onHandsFree?.(enabled);
    if (enabled) {
      if (!vad) {
        const s = getMicSettings();
        vad = new ContinuousVad({
          bargeIn: s.bargeIn,
          bargeInThreshold: 0.38,
          shouldIgnore: shouldSuppressCapture,
          startThreshold: s.startThreshold,
          continueThreshold: s.continueThreshold,
          silenceMs: s.silenceMs,
          minSpeechMs: s.minSpeechMs,
          proximityGate: s.proximityGate,
          gateStrength: s.gateStrength,
          onLevel: (level, meta) => {
            // Don't animate the orb from Omni's own speaker bleed.
            if (!meta?.suppressed) hooks.setInputLevel?.(level);
            else hooks.setInputLevel?.(0);
            updateMicMeter(level, meta || {});
          },
          onState: (state) => {
            document.body.dataset.vad = state;
            const speaking = state === "speech";
            document.body.toggleAttribute("data-user-speaking", speaking);
            hooks.onUserSpeaking?.(speaking);
            updateVoiceActivityLabel();
          },
          onEndpoint: () => hooks.onSpeechEnded?.(),
          onUtterance: (decoded, meta) => {
            if (!hooks.isReady() || getMicSettings().muted) return;
            // Hard reject anything that slipped through while Omni was talking.
            if (shouldSuppressCapture() && !getMicSettings().bargeIn) return;
            try {
              hooks.sendAudio({
                audio: {
                  duration: meta.duration,
                  decoded,
                  levels: downsample(meta.levels, 26),
                },
              });
            } catch (err) {
              hooks.toast?.(err?.message || "Could not hear that. Try again?");
            }
          },
        });
        vad.setMuted(s.muted);
      } else {
        applyToVad();
      }
      try {
        await vad.start();
        applyToVad();
        document.body.dataset.vad = getMicSettings().muted ? "muted" : "listening";
        updateVoiceActivityLabel();
        if (!getMicSettings().muted) hooks.toast?.("Listening freely — just talk");
      } catch {
        enabled = false;
        document.body.toggleAttribute("data-handsfree", false);
        document.body.removeAttribute("data-user-speaking");
        hooks.toast?.("Microphone permission is needed for hands-free talk");
      }
    } else {
      vad?.stop();
      document.body.removeAttribute("data-vad");
      document.body.removeAttribute("data-user-speaking");
      hooks.onUserSpeaking?.(false);
      updateVoiceActivityLabel();
      hooks.toast?.("Hands-free listening paused");
    }
  };

  if (enabled) {
    const boot = async () => {
      if (!hooks.isReady()) {
        setTimeout(boot, 500);
        return;
      }
      await setEnabled(true);
    };
    boot();
  }

  // Wire header controls once the chrome exists.
  queueMicrotask(() => {
    document.querySelector("#mic-mute-toggle")?.addEventListener("click", () => {
      setMuted(!getMicSettings().muted);
    });
    document.querySelector("#mic-settings-toggle")?.addEventListener("click", () => {
      const open = !document.body.hasAttribute("data-settings-open");
      syncSettingsOpen(open);
      if (open) fillSettingsForm(getMicSettings());
    });
    syncMuteUi(getMicSettings().muted);
  });

  return {
    get enabled() { return enabled; },
    toggle: () => setEnabled(!enabled),
    setEnabled,
    setMuted,
    getMuted: () => getMicSettings().muted,
    applySettings: applyToVad,
  };
}

function downsample(levels, count) {
  if (!levels?.length) return Array(count).fill(0);
  return Array.from({ length: count }, (_v, i) => {
    const start = Math.floor((i * levels.length) / count);
    const end = Math.max(Math.floor(((i + 1) * levels.length) / count), start + 1);
    return levels.slice(start, end).reduce((a, b) => Math.max(a, b), 0);
  });
}

export function updateVoiceActivityLabel() {
  const chip = document.querySelector("#voice-activity");
  if (!chip) return;
  const state = document.body.dataset.state;
  const vad = document.body.dataset.vad;
  const hands = document.body.hasAttribute("data-handsfree");
  const muted = document.body.hasAttribute("data-mic-muted");
  let text = "";
  let tone = "idle";
  if (muted) {
    text = "Mic muted";
    tone = "muted";
  } else if (state === "speaking") {
    text = "Omni speaking";
    tone = "reply";
  } else if (state === "thinking") {
    text = "Thinking";
    tone = "think";
  } else if (vad === "speech" || document.body.hasAttribute("data-user-speaking")) {
    text = "Hearing you";
    tone = "hear";
  } else if (hands && (state === "idle" || state === "listening")) {
    text = "Listening";
    tone = "listen";
  }
  chip.hidden = !text;
  chip.dataset.tone = tone;
  chip.textContent = text;
}

export function applyDesktopChrome() {
  loadMicSettings();

  const api = window.omniDesktop;
  const product = api?.productName || "Omni Voice Desk";
  const platform = api?.platform || (navigator.platform?.startsWith("Mac") ? "darwin" : "web");
  document.documentElement.dataset.platform = platform;
  document.documentElement.dataset.desktop = api?.isDesktop ? "1" : "0";

  const wordmark = document.querySelector("#wordmark");
  if (wordmark) wordmark.textContent = product;
  document.title = product;

  const mark = document.querySelector("#brand-mark");
  if (mark) {
    mark.alt = product;
    // Prefer packaged relative asset; fall back to preload file URL if needed.
    if (!mark.getAttribute("src")) mark.src = "../assets/icons/64x64.png";
  }

  const introTitle = document.querySelector(".intro-title");
  if (introTitle) introTitle.textContent = "Just talk. Agents build.";

  const introHint = document.querySelector("#intro-hint");
  if (introHint) {
    introHint.textContent =
      "Hands-free listening is on. I stay in conversation and delegate coding to subagents — watch their progress on the swarm board.";
  }

  const hint = document.querySelector("#hint");
  if (hint) {
    hint.hidden = true;
    hint.setAttribute("aria-hidden", "true");
    hint.textContent = "";
    hint.innerHTML = "";
  }

  wireKeyboardToggle();

  const suggestions = document.querySelector("#suggestions");
  if (suggestions) {
    suggestions.replaceChildren(
      button("Pick a workspace for coding."),
      button("Create a notes folder and a todo file."),
      button("What are my background agents doing?"),
      button("Clear finished agents."),
    );
  }

  const status = document.querySelector("#status-label");
  if (status && !document.querySelector("#voice-activity")) {
    const chip = document.createElement("span");
    chip.id = "voice-activity";
    chip.className = "voice-activity";
    chip.hidden = true;
    chip.setAttribute("aria-live", "polite");
    status.insertAdjacentElement("afterend", chip);
  }

  const headerActions = document.querySelector(".header-actions");
  if (headerActions) {
    if (!document.querySelector("#mic-mute-toggle")) {
      const mute = document.createElement("button");
      mute.id = "mic-mute-toggle";
      mute.className = "icon-button mic-mute-toggle";
      mute.type = "button";
      mute.setAttribute("aria-pressed", "false");
      mute.title = "Mute microphone";
      mute.setAttribute("aria-label", "Mute microphone");
      mute.innerHTML = MIC_ON_SVG;
      headerActions.prepend(mute);
    }
    if (!document.querySelector("#keyboard-toggle")) {
      const keyboard = document.createElement("button");
      keyboard.id = "keyboard-toggle";
      keyboard.className = "icon-button keyboard-toggle";
      keyboard.type = "button";
      keyboard.setAttribute("aria-pressed", "false");
      keyboard.title = "Show text input";
      keyboard.setAttribute("aria-label", "Show text input");
      keyboard.innerHTML = KEYBOARD_SVG;
      document.querySelector("#mic-mute-toggle")?.after(keyboard);
    }
    if (!document.querySelector("#mic-settings-toggle")) {
      const gear = document.createElement("button");
      gear.id = "mic-settings-toggle";
      gear.className = "icon-button";
      gear.type = "button";
      gear.setAttribute("aria-expanded", "false");
      gear.title = "Microphone settings";
      gear.setAttribute("aria-label", "Microphone settings");
      gear.innerHTML = GEAR_SVG;
      document.querySelector("#keyboard-toggle")?.after(gear);
    }
    if (!document.querySelector("#handsfree-toggle")) {
      const toggle = document.createElement("button");
      toggle.id = "handsfree-toggle";
      toggle.className = "icon-button handsfree-toggle";
      toggle.type = "button";
      toggle.setAttribute("aria-pressed", "true");
      toggle.title = "Hands-free listening";
      toggle.setAttribute("aria-label", "Hands-free listening");
      toggle.innerHTML = `<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4 7 17M17 7l1.4-1.4"/></svg>`;
      document.querySelector("#mic-settings-toggle")?.after(toggle);
    }
    if (!document.querySelector("#swarm-toggle")) {
      const swarm = document.createElement("button");
      swarm.id = "swarm-toggle";
      swarm.className = "icon-button swarm-toggle";
      swarm.type = "button";
      swarm.setAttribute("aria-pressed", String(loadSwarmVisible()));
      swarm.title = loadSwarmVisible() ? "Hide agent swarm" : "Show agent swarm";
      swarm.setAttribute("aria-label", swarm.title);
      swarm.innerHTML = SWARM_SVG;
      document.querySelector("#handsfree-toggle")?.after(swarm);
    }
  }

  mountMicSettings();
  syncMuteUi(getMicSettings().muted);

  if (!document.querySelector("#agent-panel-host")) {
    const host = el("div", "agent-panel-host");
    host.id = "agent-panel-host";
    document.querySelector(".app")?.append(host);
    mountAgentPanel(host);
  }

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && document.body.hasAttribute("data-settings-open")) {
      syncSettingsOpen(false);
    }
  });

  updateVoiceActivityLabel();
}

function button(label) {
  const node = document.createElement("button");
  node.className = "pill-button";
  node.type = "button";
  node.textContent = label;
  return node;
}

function loadComposerOpen() {
  try {
    return localStorage.getItem(COMPOSER_OPEN_KEY) === "1";
  } catch {
    return false;
  }
}

function saveComposerOpen(open) {
  try {
    localStorage.setItem(COMPOSER_OPEN_KEY, open ? "1" : "0");
  } catch {
    /* ignore */
  }
}

function wireKeyboardToggle() {
  const dock = document.querySelector(".dock");
  const composer = document.querySelector("#composer");
  const toggle = document.querySelector("#keyboard-toggle");
  const input = document.querySelector("#input");
  if (!dock || !toggle || toggle.dataset.bound === "1") return;
  toggle.dataset.bound = "1";

  const setOpen = (open) => {
    document.body.toggleAttribute("data-composer-open", open);
    toggle.setAttribute("aria-pressed", String(open));
    toggle.title = open ? "Hide text input" : "Show text input";
    toggle.setAttribute("aria-label", toggle.title);
    saveComposerOpen(open);
    if (open) {
      queueMicrotask(() => input?.focus());
    } else {
      input?.blur();
    }
  };

  setOpen(loadComposerOpen());

  toggle.addEventListener("click", () => {
    setOpen(!document.body.hasAttribute("data-composer-open"));
  });

  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!document.body.hasAttribute("data-composer-open")) return;
    if (composer?.getAttribute("data-mode") === "record") return;
    setOpen(false);
  });
}
