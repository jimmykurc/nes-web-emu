// AudioWorklet processor: plays mono samples pushed from the main thread
// through a ring buffer and reports its fill level for rate control.
class NesAudioProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(16384);
    this.read = 0;
    this.write = 0;
    this.count = 0;
    this.last = 0;
    this.reportIn = 0;
    this.port.onmessage = (e) => {
      const data = e.data;
      if (data === 'clear') { this.read = this.write = this.count = 0; return; }
      const n = this.buf.length;
      for (let i = 0; i < data.length; i++) {
        if (this.count === n) { this.read = (this.read + 1) % n; this.count--; } // overflow: drop oldest
        this.buf[this.write] = data[i];
        this.write = (this.write + 1) % n;
        this.count++;
      }
    };
  }

  process(inputs, outputs) {
    const out = outputs[0];
    const ch0 = out[0];
    const n = this.buf.length;
    for (let i = 0; i < ch0.length; i++) {
      if (this.count > 0) {
        this.last = this.buf[this.read];
        this.read = (this.read + 1) % n;
        this.count--;
      } else {
        this.last *= 0.995; // underrun: fade instead of clicking
      }
      ch0[i] = this.last;
    }
    for (let c = 1; c < out.length; c++) out[c].set(ch0);
    if (++this.reportIn >= 8) {
      this.reportIn = 0;
      this.port.postMessage(this.count);
    }
    return true;
  }
}

registerProcessor('nes-audio', NesAudioProcessor);
