import { LoopCursor } from './lib/loop-cursor.js';

class OrchestrionProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.channels = []; this.cursor = new LoopCursor(); this.framesSinceUpdate = 0; this.trackId = 0;
    this.channelSelection = null; this.selectionMode = 'mono'; this.disposed = false;
    this.variantMode = false; this.variantGroups = []; this.variantMarks = []; this.variantLoop = null; this.variantLength = 0;
    this.activeVariant = 0; this.pendingVariant = null; this.pendingNode = null; this.transition = null; this.variantGeneration = 0; this.lastPosition = 0;
    this.port.onmessage = ({ data }) => {
      try {
        if (data.type === 'load') {
          this.channels = data.channels; this.trackId = data.trackId; this.channelSelection = null; this.selectionMode = 'mono';
          this.cursor = new LoopCursor(this.channels[0].length, data.loop, data.limit ?? Infinity);
          this.configureVariant(data.variant);
        } else if (data.type === 'dispose') {
          this.channels = []; this.cursor = new LoopCursor(); this.channelSelection = null; this.selectionMode = 'mono'; this.configureVariant(null); this.disposed = true;
          this.port.postMessage({ type: 'disposed' }); return;
        } else if (data.type === 'clear') {
          this.channels = []; this.cursor = new LoopCursor(); this.trackId = data.trackId; this.channelSelection = null; this.selectionMode = 'mono'; this.configureVariant(null);
        } else if (data.type === 'play') this.cursor.play();
        else if (data.type === 'pause') this.cursor.pause();
        else if (data.type === 'seek') { this.cursor.seek(data.position); this.resetVariantTiming(true); }
        else if (data.type === 'restart') { this.cursor.reset(); this.resetVariantTiming(true); this.cursor.play(); }
        else if (data.type === 'limit') this.cursor.setLimit(data.limit ?? Infinity);
        else if (data.type === 'channel') { this.disableVariant(); this.channelSelection = Number.isInteger(data.channel) && data.channel >= 0 ? [data.channel] : null; this.selectionMode = 'mono'; }
        else if (data.type === 'channel-set') { this.disableVariant(); this.channelSelection = Array.isArray(data.channels) ? data.channels.filter(Number.isInteger) : null; this.selectionMode = data.mode === 'pair' ? 'pair' : 'mono'; }
        else if (data.type === 'variant-toggle') this.toggleVariant();
        this.report();
      } catch (error) { this.port.postMessage({ type: 'error', message: error.message }); }
    };
  }
  configureVariant(data) {
    this.variantMode = Boolean(data && Array.isArray(data.groups) && data.groups.length >= 2);
    this.variantGroups = this.variantMode ? data.groups.map(group => group.slice(0, 2)) : [];
    this.variantMarks = this.variantMode ? [...new Set((data.marks || []).filter(Number.isFinite).map(Math.round))].sort((a, b) => a - b) : [];
    this.variantLoop = this.variantMode && data.loop ? { ...data.loop } : null;
    this.variantLength = this.channels[0]?.length || 0;
    this.activeVariant = this.variantMode ? Math.max(0, Math.min(this.variantGroups.length - 1, data.initialVariant ?? 0)) : 0;
    this.resetVariantTiming(true);
  }
  disableVariant() {
    this.variantMode = false; this.variantGroups = []; this.variantMarks = []; this.variantLoop = null; this.pendingVariant = null; this.pendingNode = null; this.transition = null;
  }
  resetVariantTiming(clearRequests) {
    this.variantGeneration = 0; this.lastPosition = this.cursor.position;
    if (clearRequests) { this.pendingVariant = null; this.pendingNode = null; this.transition = null; }
  }
  nextVariantNode(position, generation) {
    const next = this.variantMarks.find(mark => mark > position);
    if (next !== undefined) return { position: next, generation };
    if (this.variantLoop) {
      const wrapped = this.variantMarks.find(mark => mark >= this.variantLoop.start);
      return { position: wrapped ?? this.variantLoop.start, generation: generation + 1 };
    }
    return { position: this.variantLength, generation };
  }
  nodeReached(node, position) {
    return Boolean(node && (this.variantGeneration > node.generation || (this.variantGeneration === node.generation && position >= node.position)));
  }
  toggleVariant() {
    if (!this.variantMode) return;
    const base = this.pendingVariant === null ? this.activeVariant : this.pendingVariant;
    const target = base === 0 ? 1 : 0;
    if (target === this.activeVariant) { this.pendingVariant = null; this.pendingNode = null; return; }
    this.pendingVariant = target; this.pendingNode = this.nextVariantNode(this.cursor.position, this.variantGeneration);
  }
  updateVariantFrame(position) {
    if (!this.variantMode) return false;
    if (position < this.lastPosition) this.variantGeneration++;
    this.lastPosition = position;
    let changed = false;
    if (this.transition && this.nodeReached(this.transition.end, position)) { this.transition = null; changed = true; }
    if (this.pendingVariant !== null && this.nodeReached(this.pendingNode, position)) {
      this.activeVariant = this.pendingVariant; this.pendingVariant = null; this.pendingNode = null;
      this.transition = { end: this.nextVariantNode(position, this.variantGeneration) }; changed = true;
    }
    return changed;
  }
  report() {
    this.port.postMessage({ type: 'state', trackId: this.trackId, ...this.cursor.state(), variant: this.variantMode ? this.activeVariant : null, variantPending: this.variantMode ? this.pendingVariant : null, variantTransition: this.variantMode && Boolean(this.transition) });
  }
  process(_inputs, outputs) {
    if (this.disposed) return false;
    const output = outputs[0];
    const wasPlaying = this.cursor.playing, previousPass = this.cursor.pass;
    let variantChanged = false;
    for (let i = 0; i < output[0].length; i++) {
      if (!this.cursor.playing || !this.channels.length) break;
      const position = this.cursor.position;
      variantChanged = this.updateVariantFrame(position) || variantChanged;
      if (this.variantMode) {
        const group = this.variantGroups[this.activeVariant] || this.variantGroups[0];
        let left = this.channels[group[0]]?.[position] ?? 0, right = this.channels[group[1]]?.[position] ?? 0;
        if (this.transition) { const transitionGroup = this.variantGroups[2]; left += this.channels[transitionGroup?.[0]]?.[position] ?? 0; right += this.channels[transitionGroup?.[1]]?.[position] ?? 0; }
        for (let channel = 0; channel < output.length; channel++) output[channel][i] = channel === 0 ? left : channel === 1 ? right : 0;
      } else if (this.channelSelection?.length) {
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
    if (wasPlaying !== this.cursor.playing || previousPass !== this.cursor.pass || variantChanged || this.framesSinceUpdate >= sampleRate / 15) {
      if (this.channels.length) this.report();
      this.framesSinceUpdate = 0;
    }
    return true;
  }
}
registerProcessor('orchestrion-player', OrchestrionProcessor);
