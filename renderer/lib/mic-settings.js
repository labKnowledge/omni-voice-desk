const STORAGE_KEY = "omni-voice-desk.mic";

/** @typedef {{
 *   muted: boolean,
 *   proximityGate: boolean,
 *   gateStrength: number,
 *   startThreshold: number,
 *   continueThreshold: number,
 *   silenceMs: number,
 *   minSpeechMs: number,
 *   ignoreOwnVoice: boolean,
 *   bargeIn: boolean,
 *   echoCooldownMs: number,
 * }} MicSettings */

/** @type {MicSettings} */
export const DEFAULT_MIC_SETTINGS = Object.freeze({
  muted: false,
  proximityGate: true,
  // 0 = open room, 1 = very close / loud only
  gateStrength: 0.55,
  startThreshold: 0.085,
  continueThreshold: 0.042,
  silenceMs: 480,
  minSpeechMs: 280,
  // Never treat Omni's speaker output as user speech (default on).
  ignoreOwnVoice: true,
  // Loud interrupt while Omni is talking — off by default to stop self-capture.
  bargeIn: false,
  echoCooldownMs: 600,
});

const listeners = new Set();

/** @type {MicSettings} */
let current = { ...DEFAULT_MIC_SETTINGS };

function clamp(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

export function normalizeMicSettings(raw = {}) {
  return {
    muted: Boolean(raw.muted),
    proximityGate: raw.proximityGate !== false,
    gateStrength: clamp(Number(raw.gateStrength ?? DEFAULT_MIC_SETTINGS.gateStrength), 0, 1),
    startThreshold: clamp(Number(raw.startThreshold ?? DEFAULT_MIC_SETTINGS.startThreshold), 0.02, 0.45),
    continueThreshold: clamp(Number(raw.continueThreshold ?? DEFAULT_MIC_SETTINGS.continueThreshold), 0.01, 0.35),
    silenceMs: Math.round(clamp(Number(raw.silenceMs ?? DEFAULT_MIC_SETTINGS.silenceMs), 220, 1400)),
    minSpeechMs: Math.round(clamp(Number(raw.minSpeechMs ?? DEFAULT_MIC_SETTINGS.minSpeechMs), 120, 900)),
    ignoreOwnVoice: raw.ignoreOwnVoice !== false,
    bargeIn: Boolean(raw.bargeIn),
    echoCooldownMs: Math.round(clamp(Number(raw.echoCooldownMs ?? DEFAULT_MIC_SETTINGS.echoCooldownMs), 0, 2000)),
  };
}

export function loadMicSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}");
    current = normalizeMicSettings(raw);
  } catch {
    current = { ...DEFAULT_MIC_SETTINGS };
  }
  return getMicSettings();
}

export function getMicSettings() {
  return { ...current };
}

export function saveMicSettings(partial = {}) {
  current = normalizeMicSettings({ ...current, ...partial });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(current));
  } catch {
    /* ignore quota */
  }
  for (const fn of listeners) {
    try { fn(getMicSettings()); } catch { /* ignore */ }
  }
  return getMicSettings();
}

export function onMicSettingsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Human labels for the proximity slider. */
export function gateStrengthLabel(value) {
  if (value < 0.25) return "Room";
  if (value < 0.5) return "Near";
  if (value < 0.75) return "Close";
  return "Very close";
}
