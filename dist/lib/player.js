async function resampleChannels(context, channels, sourceRate) {
  if (sourceRate === context.sampleRate) return { channels, rate: sourceRate, duration: channels[0]?.length / sourceRate || 0 };
  const sourceLength = channels[0]?.length || 0;
  const targetLength = Math.max(1, Math.ceil(sourceLength * context.sampleRate / sourceRate));
  const offline = new OfflineAudioContext(channels.length, targetLength, context.sampleRate);
  const buffer = offline.createBuffer(channels.length, sourceLength, sourceRate);
  channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
  const source = offline.createBufferSource(); source.buffer = buffer; source.connect(offline.destination); source.start();
  const rendered = await offline.startRendering();
  return { channels: Array.from({ length: rendered.numberOfChannels }, (_, index) => rendered.getChannelData(index).slice()), rate: rendered.sampleRate, duration: rendered.duration };
}

export class Player {
  constructor(onState, onError) {
    this.onState = onState; this.onError = onError;
    this.context = null; this.node = null; this.gain = null;
    this.trackId = 0; this.volume = 0.7; this.limit = 3; this.channelSelection = null; this.channelSelectionMode = 'mono'; this.variantMode = false; this.channelCount = 0; this.playbackIntent = false; this.playbackCommand = 0;
    this.state = { position: 0, pass: 1, playing: false, finished: false };
    this.channelSelection = null; this.channelSelectionMode = 'mono'; this.variantMode = false; this.channelCount = 0;
  }
  async activate() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'playback' });
      this.gain = this.context.createGain(); this.gain.gain.value = this.volume; this.gain.connect(this.context.destination);
      this.ready = this.context.audioWorklet.addModule(new URL('../audio-worklet.js?v=20260913-4', import.meta.url));
      this.context.onstatechange = () => {
        if (this.context.state === 'suspended' && this.state.playing) this.onError('浏览器暂停了音频，请点击播放继续。');
      };
    }
    const resumed = this.context.resume();
    await Promise.all([resumed, this.ready]);
  }
  clear() {
    this.trackId++;
    this.playbackCommand++; this.playbackIntent = false;
    if (this.node) {
      const oldNode = this.node;
      oldNode.port.onmessage = ({ data }) => { if (data.type === 'disposed') oldNode.port.close(); };
      oldNode.port.postMessage({ type: 'dispose' });
      oldNode.disconnect(); this.node = null;
    }
    this.state = { position: 0, pass: 1, playing: false, finished: false };
    this.channelSelection = null; this.channelSelectionMode = 'mono'; this.variantMode = false; this.channelCount = 0;
    this.onState(this.state);
  }
  async load(info, stillCurrent = () => true) {
    await this.ready;
    const expectedBytes = info.duration * this.context.sampleRate * info.channels * 4;
    if (expectedBytes > 320 * 1024 * 1024) throw new Error('曲目解码后过大，超出第一版的单曲内存限制。');
    let channels, rate, loadedDuration;
    try {
      if (info.codec === 'HCA' && info.pcmChannels) {
        const resampled = await resampleChannels(this.context, info.pcmChannels, info.sampleRate);
        channels = resampled.channels; rate = resampled.rate; loadedDuration = resampled.duration;
      } else {
        const decoded = await this.context.decodeAudioData(info.ogg.buffer);
        channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i).slice());
        rate = decoded.sampleRate; loadedDuration = decoded.duration;
      }
    } catch { throw new Error(`浏览器未能解码这首 ${info.codec || '音频'}。请确认游戏资源完整，并尝试重新选择目录。`); }
    if (!stillCurrent()) return false;
    // decodeAudioData resamples to context rate. Original sample indices must
    // be converted, otherwise a 44.1 kHz track loops incorrectly at 48 kHz.
    const loop = info.loop ? { start: Math.round(info.loop.start / info.sampleRate * rate), end: Math.min(channels[0].length, Math.round(info.loop.end / info.sampleRate * rate)) } : null;
    const variant = info.channels === 6 ? { groups: [[0, 2], [1, 4], [3, 5]], marks: (info.marks || []).map(mark => Math.round(mark / info.sampleRate * rate)), loop, initialVariant: 0 } : null;
    this.channelCount = channels.length; this.channelSelection = variant ? [0, 2] : null; this.channelSelectionMode = variant ? 'pair' : 'mono'; this.variantMode = Boolean(variant);
    this.node = new AudioWorkletNode(this.context, 'orchestrion-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [channels.length] });
    this.node.connect(this.gain);
    const loadedId = this.trackId;
    this.node.onprocessorerror = () => { if (this.trackId === loadedId) { this.clear(); this.onError('音频处理失败，请重新选择曲目。'); } };
    this.node.port.onmessage = ({ data }) => {
      if (data.type === 'error') { this.onError(data.message); return; }
      if (data.trackId !== this.trackId) return;
      this.applyWorkletState(data, rate);
    };
    this.node.port.postMessage({ type: 'load', channels, loop, limit: Number.isFinite(this.limit) ? this.limit : null, fadeOutSeconds: 2, trackId: this.trackId, variant }, channels.map(c => c.buffer));
    return { duration: loadedDuration, sampleRate: rate };
  }
  applyWorkletState(data, rate) {
    if (data.finished) this.playbackIntent = false;
    this.state = { ...data, playing: data.finished ? false : this.playbackIntent, position: data.position / rate };
    this.onState(this.state);
  }
  async play() {
    const command = ++this.playbackCommand; this.playbackIntent = true;
    await this.activate();
    if (command !== this.playbackCommand || !this.playbackIntent) return false;
    this.node?.port.postMessage({ type: 'play' }); return true;
  }
  pause() {
    this.playbackCommand++; this.playbackIntent = false;
    this.node?.port.postMessage({ type: 'pause' });
    this.state = { ...this.state, playing: false }; this.onState(this.state);
  }
  async togglePlayback() {
    // The AudioContext may be suspended independently of the Worklet cursor
    // (tab throttling, output-device changes, or browser autoplay policy).
    // Playback intent must therefore follow the cursor state, not context.state.
    if (this.playbackIntent || this.state.playing) { this.pause(); return false; }
    return (await this.play()) !== false;
  }
  async restart() {
    const command = ++this.playbackCommand; this.playbackIntent = true;
    await this.activate();
    if (command !== this.playbackCommand || !this.playbackIntent) return false;
    this.node?.port.postMessage({ type: 'restart' }); return true;
  }
  seek(seconds, pass = 1) { this.node?.port.postMessage({ type: 'seek', position: Math.round(seconds * this.context.sampleRate), pass }); }
  setLimit(limit) { this.limit = limit; this.node?.port.postMessage({ type: 'limit', limit: Number.isFinite(limit) ? limit : null }); }
  setChannel(channel) {
    if (!Number.isInteger(channel) || channel < -1 || channel >= this.channelCount) throw new Error('无效的声道选择。');
    this.setChannelSelection(channel < 0 ? null : [channel]);
  }
  setChannelSelection(channels, mode = 'mono') {
    if (channels !== null && (!Array.isArray(channels) || !channels.length || channels.some(channel => !Number.isInteger(channel) || channel < 0 || channel >= this.channelCount))) throw new Error('无效的声道组合。');
    if (!['mono', 'pair'].includes(mode)) throw new Error('无效的声道试听模式。');
    this.variantMode = false; this.channelSelection = channels ? [...new Set(channels)] : null; this.channelSelectionMode = mode;
    this.node?.port.postMessage({ type: 'channel-set', channels: this.channelSelection, mode });
  }
  requestVariantToggle() { if (!this.variantMode || !this.node) return false; this.node.port.postMessage({ type: 'variant-toggle' }); return true; }
  setVolume(volume) { this.volume = volume; if (this.gain) this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.02); }
}
