/**
 * Continuous energy-based voice activity detector.
 * Captures PCM directly (no MediaRecorder encode/decode round-trip).
 * Supports mute + proximity gate (closest / loudest voice over ambient).
 */
export class ContinuousVad {
  /**
   * @param {object} opts
   * @param {(buffer: AudioBuffer, meta: {duration: number, levels: number[]}) => void} opts.onUtterance
   * @param {(level: number, meta?: {gated: number, noiseFloor: number, open: boolean}) => void} [opts.onLevel]
   * @param {(state: 'idle'|'listening'|'speech'|'muted') => void} [opts.onState]
   * @param {() => void} [opts.onEndpoint]
   * @param {number} [opts.startThreshold]
   * @param {number} [opts.continueThreshold]
   * @param {number} [opts.silenceMs]
   * @param {number} [opts.minSpeechMs]
   * @param {number} [opts.maxSpeechMs]
   * @param {boolean} [opts.proximityGate]
   * @param {number} [opts.gateStrength] — 0 room … 1 very close
   * @param {() => boolean} [opts.shouldIgnore] — true while Omni is speaking / echo cooldown
   * @param {boolean} [opts.bargeIn] — allow a loud interrupt while shouldIgnore is true
   * @param {number} [opts.bargeInThreshold] — absolute level required to barge in
   */
  constructor(opts) {
    this.opts = {
      startThreshold: 0.08,
      continueThreshold: 0.04,
      silenceMs: 480,
      minSpeechMs: 280,
      maxSpeechMs: 28_000,
      proximityGate: true,
      gateStrength: 0.55,
      bargeIn: false,
      bargeInThreshold: 0.38,
      ...opts,
    };
    this.active = false;
    this.muted = false;
    this.state = "idle";
    this.stream = null;
    this.audioContext = null;
    this.source = null;
    this.highpass = null;
    this.analyser = null;
    this.processor = null;
    this.silentGain = null;
    this.samples = null;
    this.raf = 0;
    this.pcmChunks = [];
    this.pcmLength = 0;
    this.levels = [];
    this.speaking = false;
    this.silenceStarted = 0;
    this.speechStarted = 0;
    this.segmentLevels = [];
    this.capturing = false;
    this.noiseFloor = 0.018;
  }

  applySettings(settings = {}) {
    if (settings.startThreshold != null) this.opts.startThreshold = settings.startThreshold;
    if (settings.continueThreshold != null) this.opts.continueThreshold = settings.continueThreshold;
    if (settings.silenceMs != null) this.opts.silenceMs = settings.silenceMs;
    if (settings.minSpeechMs != null) this.opts.minSpeechMs = settings.minSpeechMs;
    if (settings.proximityGate != null) this.opts.proximityGate = Boolean(settings.proximityGate);
    if (settings.gateStrength != null) this.opts.gateStrength = settings.gateStrength;
    if (settings.bargeIn != null) this.opts.bargeIn = Boolean(settings.bargeIn);
    if (settings.bargeInThreshold != null) this.opts.bargeInThreshold = settings.bargeInThreshold;
    if (settings.muted != null) this.setMuted(Boolean(settings.muted));
  }

  setMuted(muted) {
    const next = Boolean(muted);
    if (this.muted === next) return;
    this.muted = next;
    if (next) {
      if (this.speaking) this.finishSegment(false);
      this.setState(this.active ? "muted" : "idle");
      this.opts.onLevel?.(0, { gated: this.gateThreshold(), noiseFloor: this.noiseFloor, open: false });
    } else if (this.active) {
      this.setState("listening");
    }
  }

  /** Effective open threshold — ambient + proximity margin, never below base start. */
  gateThreshold() {
    const base = this.opts.startThreshold;
    if (!this.opts.proximityGate) return base;
    const strength = Math.min(1, Math.max(0, this.opts.gateStrength ?? 0.55));
    // Close talkers sit clearly above the rolling noise floor.
    const margin = 0.035 + strength * 0.22;
    return Math.max(base, this.noiseFloor + margin);
  }

  holdThreshold() {
    const open = this.gateThreshold();
    const cont = this.opts.continueThreshold;
    // Stay open a bit below the open gate so natural dips don't chop words.
    return Math.max(cont, open * 0.55);
  }

  async start() {
    if (this.active) return;
    this.audioContext = new AudioContext({ latencyHint: "interactive" });
    if (this.audioContext.state === "suspended") await this.audioContext.resume();
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    this.source = this.audioContext.createMediaStreamSource(this.stream);

    // Drop rumble / distant HVAC so the gate focuses on near-field speech.
    this.highpass = this.audioContext.createBiquadFilter();
    this.highpass.type = "highpass";
    this.highpass.frequency.value = 85;
    this.highpass.Q.value = 0.7;

    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 1024;
    this.analyser.smoothingTimeConstant = 0.15;
    this.samples = new Float32Array(this.analyser.fftSize);

    this.source.connect(this.highpass);
    this.highpass.connect(this.analyser);

    const bufferSize = 2048;
    this.processor = this.audioContext.createScriptProcessor(bufferSize, 1, 1);
    this.processor.onaudioprocess = (event) => {
      if (!this.capturing || this.muted) return;
      const input = event.inputBuffer.getChannelData(0);
      this.pcmChunks.push(Float32Array.from(input));
      this.pcmLength += input.length;
    };
    this.silentGain = this.audioContext.createGain();
    this.silentGain.gain.value = 0;
    this.highpass.connect(this.processor);
    this.processor.connect(this.silentGain);
    this.silentGain.connect(this.audioContext.destination);

    this.active = true;
    this.setState(this.muted ? "muted" : "listening");
    this.loop();
  }

  stop() {
    this.active = false;
    cancelAnimationFrame(this.raf);
    this.finishSegment(false);
    try { this.processor?.disconnect(); } catch { /* ignore */ }
    try { this.silentGain?.disconnect(); } catch { /* ignore */ }
    try { this.highpass?.disconnect(); } catch { /* ignore */ }
    this.source?.disconnect();
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.source = null;
    this.highpass = null;
    this.analyser = null;
    this.processor = null;
    this.silentGain = null;
    this.setState("idle");
  }

  setState(state) {
    if (this.state === state) return;
    this.state = state;
    this.opts.onState?.(state);
  }

  level() {
    if (!this.analyser) return 0;
    this.analyser.getFloatTimeDomainData(this.samples);
    let sum = 0;
    for (let i = 0; i < this.samples.length; i++) sum += this.samples[i] ** 2;
    const rms = Math.sqrt(sum / this.samples.length);
    return Math.min(1, Math.pow(rms * 6, 0.75));
  }

  adaptNoiseFloor(level, { suppress = false } = {}) {
    // Never learn Omni's speaker bleed as "ambient" — that poisons the gate.
    if (this.speaking || this.muted || suppress) return;
    const open = this.gateThreshold();
    if (level < open * 0.85) {
      const alpha = level < this.noiseFloor ? 0.12 : 0.04;
      this.noiseFloor = this.noiseFloor * (1 - alpha) + level * alpha;
      this.noiseFloor = Math.min(0.12, Math.max(0.008, this.noiseFloor));
    }
  }

  loop = () => {
    if (!this.active) return;
    this.raf = requestAnimationFrame(this.loop);
    const level = this.level();
    const gated = this.gateThreshold();
    const suppressing = Boolean(this.opts.shouldIgnore?.());
    const bargeInOk = this.opts.bargeIn
      && suppressing
      && level >= (this.opts.bargeInThreshold ?? 0.38);
    const captureBlocked = suppressing && !bargeInOk;
    const open = !this.muted && !captureBlocked
      && (this.speaking ? level >= this.holdThreshold() : level >= gated);
    this.opts.onLevel?.(this.muted ? 0 : level, {
      gated: captureBlocked ? 1 : gated,
      noiseFloor: this.noiseFloor,
      open,
      suppressed: captureBlocked,
    });
    this.levels.push(level);
    if (this.levels.length > 200) this.levels.shift();

    if (this.muted) {
      if (this.speaking) this.finishSegment(false);
      return;
    }

    // Drop anything captured from Omni's own speakers (unless loud barge-in).
    if (captureBlocked) {
      if (this.speaking) this.finishSegment(false);
      return;
    }

    this.adaptNoiseFloor(level, { suppress: suppressing });

    const now = performance.now();
    if (!this.speaking) {
      if (level >= (suppressing ? (this.opts.bargeInThreshold ?? 0.38) : gated)) {
        this.beginSegment(now);
      }
      return;
    }

    this.segmentLevels.push(level);
    if (level >= this.holdThreshold()) {
      this.silenceStarted = 0;
    } else if (!this.silenceStarted) {
      this.silenceStarted = now;
    }

    const spokenMs = now - this.speechStarted;
    const silentMs = this.silenceStarted ? now - this.silenceStarted : 0;
    if (spokenMs >= this.opts.maxSpeechMs || (silentMs >= this.opts.silenceMs && spokenMs >= this.opts.minSpeechMs)) {
      this.finishSegment(true);
    }
  };

  beginSegment(now) {
    this.speaking = true;
    this.speechStarted = now;
    this.silenceStarted = 0;
    this.pcmChunks = [];
    this.pcmLength = 0;
    this.segmentLevels = [];
    this.capturing = true;
    this.setState("speech");
  }

  finishSegment(emit) {
    const chunks = this.pcmChunks;
    const length = this.pcmLength;
    const levels = this.segmentLevels.slice();
    const started = this.speechStarted;
    const ctx = this.audioContext;
    this.capturing = false;
    this.pcmChunks = [];
    this.pcmLength = 0;
    this.segmentLevels = [];
    this.speaking = false;
    this.silenceStarted = 0;
    if (this.active) this.setState(this.muted ? "muted" : "listening");

    const duration = (performance.now() - started) / 1000;
    if (!emit || !ctx || duration < this.opts.minSpeechMs / 1000 || length < 256) return;

    this.opts.onEndpoint?.();

    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const channel = buffer.getChannelData(0);
    let offset = 0;
    for (const chunk of chunks) {
      channel.set(chunk, offset);
      offset += chunk.length;
    }

    requestAnimationFrame(() => {
      this.opts.onUtterance(buffer, { duration: length / ctx.sampleRate, levels });
    });
  }
}
