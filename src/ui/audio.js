// Web Audio output. Uses an AudioWorklet when available (secure contexts),
// otherwise falls back to a ScriptProcessorNode.
export class AudioOutput {
  constructor() {
    this.ctx = null;
    this.node = null;
    this.gain = null;
    this.fill = 0;
    this.volume = 0.8;
    this.muted = false;
    this.fallbackQueue = [];
    this.ready = null;
  }

  get sampleRate() { return this.ctx ? this.ctx.sampleRate : 44100; }

  // Must be called from a user gesture the first time (autoplay policy).
  async start() {
    if (this.ctx) {
      // Not awaited: resume() stays pending until a user gesture happens.
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return;
    }
    if (this.ready) return this.ready;
    this.ready = (async () => {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      const ctx = new Ctx({ latencyHint: 'interactive' });
      this.gain = ctx.createGain();
      this.gain.connect(ctx.destination);
      this.applyVolume(ctx);
      try {
        if (!ctx.audioWorklet) throw new Error('no worklet');
        await ctx.audioWorklet.addModule(new URL('./audio-worklet.js', import.meta.url));
        this.node = new AudioWorkletNode(ctx, 'nes-audio', { outputChannelCount: [2] });
        this.node.port.onmessage = (e) => { this.fill = e.data; };
        this.mode = 'AudioWorklet';
      } catch {
        this.node = ctx.createScriptProcessor(1024, 0, 2);
        let last = 0;
        this.node.onaudioprocess = (e) => {
          const l = e.outputBuffer.getChannelData(0);
          const r = e.outputBuffer.getChannelData(1);
          const q = this.fallbackQueue;
          for (let i = 0; i < l.length; i++) {
            if (q.length) last = q.shift(); else last *= 0.995;
            l[i] = r[i] = last;
          }
          this.fill = q.length;
        };
        this.mode = 'ScriptProcessor';
      }
      this.node.connect(this.gain);
      this.ctx = ctx;
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    })().catch(() => {});
    return this.ready;
  }

  push(samples) {
    if (!this.node || !samples.length) return;
    if (this.mode === 'AudioWorklet') {
      this.node.port.postMessage(samples, [samples.buffer]);
      this.fill += samples.length;
    } else {
      for (let i = 0; i < samples.length; i++) this.fallbackQueue.push(samples[i]);
      if (this.fallbackQueue.length > 16384) this.fallbackQueue.splice(0, this.fallbackQueue.length - 8192);
    }
  }

  clear() {
    this.fallbackQueue.length = 0;
    if (this.node && this.mode === 'AudioWorklet') this.node.port.postMessage('clear');
    this.fill = 0;
  }

  // Simple dynamic rate control: nudge the emulator's output sample rate by
  // at most +/-0.5 % to keep ~50 ms of audio queued.
  rateAdjust() {
    const target = this.sampleRate * 0.05;
    const err = Math.max(-1, Math.min(1, (target - this.fill) / target));
    return 1 + err * 0.005;
  }

  setVolume(v) { this.volume = v; this.applyVolume(this.ctx); }
  setMuted(m) { this.muted = m; this.applyVolume(this.ctx); }
  applyVolume(ctx) {
    if (this.gain && ctx) this.gain.gain.setTargetAtTime(this.muted ? 0 : this.volume * this.volume, ctx.currentTime, 0.02);
  }
}
