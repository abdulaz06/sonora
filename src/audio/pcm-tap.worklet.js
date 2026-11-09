// AudioWorklet that mixes its input to mono and posts PCM blocks to the main
// thread, where the WASM analyser runs. Audio passes through unchanged so the
// node can sit inline before the destination.

const BLOCK = 1024; // samples per message (~23 ms at 44.1 kHz)

class PcmTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buf = new Float32Array(BLOCK);
    this.fill = 0;
  }

  process(inputs, outputs) {
    const input = inputs[0];
    const output = outputs[0];
    if (input && input.length > 0) {
      const ch = input.length;
      const n = input[0].length;
      for (let c = 0; c < output.length; c++) {
        output[c].set(input[Math.min(c, ch - 1)]);
      }
      for (let i = 0; i < n; i++) {
        let s = 0;
        for (let c = 0; c < ch; c++) s += input[c][i];
        this.buf[this.fill++] = s / ch;
        if (this.fill === BLOCK) {
          this.port.postMessage(this.buf, [this.buf.buffer]);
          this.buf = new Float32Array(BLOCK);
          this.fill = 0;
        }
      }
    }
    return true;
  }
}

registerProcessor('sonora-pcm-tap', PcmTap);
