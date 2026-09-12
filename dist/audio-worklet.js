import { LoopCursor } from './lib/loop-cursor.js';

class OrchestrionProcessor extends AudioWorkletProcessor {
  constructor() {
    super(); this.channels = []; this.cursor = new LoopCursor(); this.framesSinceUpdate = 0; this.trackId = 0; this.channelSelection = null; this.selectionMode = 'mono'; this.disposed = false;
    this.port.onmessage = ({ data }) => {
      try {
        if (data.type === 'load') {
          this.channels = data.channels; this.trackId = data.trackId; this.channelSelection = null; this.selectionMode = 'mono';
          this.cursor = new LoopCursor(this.channels[0].length, data.loop, data.limit ?? Infinity);
        } else if (data.type === 'dispose') {
          this.channels = []; this.cursor = new LoopCursor(); this.channelSelection = null; this.selectionMode = 'mono'; this.disposed = true;
          this.port.postMessage({ type: 'disposed' }); return;
        } else if (data.type === 'clear') {
          this.channels = []; this.cursor = new LoopCursor(); this.trackId = data.trackId; this.channelSelection = null; this.selectionMode = 'mono';
        } else if (data.type === 'play') this.cursor.play();
        else if (data.type === 'pause') this.cursor.pause();
        else if (data.type === 'seek') this.cursor.seek(data.position);
        else if (data.type === 'restart') { this.cursor.reset(); this.cursor.play(); }
        else if (data.type === 'limit') this.cursor.setLimit(data.limit ?? Infinity);
        else if (data.type === 'channel') { this.channelSelection = Number.isInteger(data.channel) && data.channel >= 0 ? [data.channel] : null; this.selectionMode = 'mono'; }
        else if (data.type === 'channel-set') { this.channelSelection = Array.isArray(data.channels) ? data.channels.filter(Number.isInteger) : null; this.selectionMode = data.mode === 'pair' ? 'pair' : 'mono'; }
        this.report();
      } catch (error) { this.port.postMessage({ type: 'error', message: error.message }); }
    };
  }
  report() { this.port.postMessage({ type: 'state', trackId: this.trackId, ...this.cursor.state() }); }
  process(_inputs, outputs) {
    if (this.disposed) return false;
    const output = outputs[0];
    const wasPlaying = this.cursor.playing, previousPass = this.cursor.pass;
    for (let i = 0; i < output[0].length; i++) {
      if (!this.cursor.playing || !this.channels.length) break;
      if (this.channelSelection?.length) {
        let left = 0, right = 0, selected = 0;
        for (const channel of this.channelSelection) {
          if (channel < 0 || channel >= this.channels.length) continue;
          const sample = this.channels[channel][this.cursor.position] ?? 0; selected++;
          if (this.selectionMode === 'pair') {
            if (selected === 1) left = sample; else if (selected === 2) right = sample;
          } else { left += sample; right += sample; }
        }
        if (this.selectionMode !== 'pair') { left /= selected || 1; right = left; }
        for (let channel = 0; channel < output.length; channel++) output[channel][i] = channel === 0 ? left : channel === 1 ? right : 0;
      } else {
        for (let channel = 0; channel < output.length; channel++) output[channel][i] = this.channels[channel]?.[this.cursor.position] ?? 0;
      }
      this.cursor.advance();
    }
    this.framesSinceUpdate += output[0].length;
    if (wasPlaying !== this.cursor.playing || previousPass !== this.cursor.pass || this.framesSinceUpdate >= sampleRate / 15) {
      if (this.channels.length) this.report();
      this.framesSinceUpdate = 0;
    }
    return true;
  }
}
registerProcessor('orchestrion-player', OrchestrionProcessor);
