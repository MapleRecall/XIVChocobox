export class Player {
  constructor(onState, onError) {
    this.onState = onState; this.onError = onError;
    this.context = null; this.node = null; this.gain = null;
    this.trackId = 0; this.volume = 0.7; this.limit = 3; this.soloChannel = -1; this.channelCount = 0;
    this.state = { position: 0, pass: 1, playing: false, finished: false };
    this.soloChannel = -1; this.channelCount = 0;
  }
  async activate() {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'playback' });
      this.gain = this.context.createGain(); this.gain.gain.value = this.volume; this.gain.connect(this.context.destination);
      this.ready = this.context.audioWorklet.addModule(new URL('../audio-worklet.js', import.meta.url));
      this.context.onstatechange = () => {
        if (this.context.state === 'suspended' && this.state.playing) this.onError('浏览器暂停了音频，请点击播放继续。');
      };
    }
    const resumed = this.context.resume();
    await Promise.all([resumed, this.ready]);
  }
  clear() {
    this.trackId++;
    if (this.node) {
      const oldNode = this.node;
      oldNode.port.onmessage = ({ data }) => { if (data.type === 'disposed') oldNode.port.close(); };
      oldNode.port.postMessage({ type: 'dispose' });
      oldNode.disconnect(); this.node = null;
    }
    this.state = { position: 0, pass: 1, playing: false, finished: false };
    this.soloChannel = -1; this.channelCount = 0;
    this.onState(this.state);
  }
  async load(info, stillCurrent = () => true) {
    await this.ready;
    const expectedBytes = info.duration * this.context.sampleRate * info.channels * 4;
    if (expectedBytes > 320 * 1024 * 1024) throw new Error('曲目解码后过大，超出第一版的单曲内存限制。');
    let decoded;
    try { decoded = await this.context.decodeAudioData(info.ogg.buffer); }
    catch { throw new Error('浏览器未能解码这首 OGG。请确认游戏已更新完成，并尝试重新选择目录。'); }
    if (!stillCurrent()) return false;
    const channels = Array.from({ length: decoded.numberOfChannels }, (_, i) => decoded.getChannelData(i).slice());
    this.channelCount = channels.length; this.soloChannel = -1;
    const rate = decoded.sampleRate;
    // decodeAudioData resamples to context rate. Original sample indices must
    // be converted, otherwise a 44.1 kHz track loops incorrectly at 48 kHz.
    const loop = info.loop ? { start: Math.round(info.loop.start / info.sampleRate * rate), end: Math.min(decoded.length, Math.round(info.loop.end / info.sampleRate * rate)) } : null;
    this.node = new AudioWorkletNode(this.context, 'orchestrion-player', { numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [channels.length] });
    this.node.connect(this.gain);
    const loadedId = this.trackId;
    this.node.onprocessorerror = () => { if (this.trackId === loadedId) { this.clear(); this.onError('音频处理失败，请重新选择曲目。'); } };
    this.node.port.onmessage = ({ data }) => {
      if (data.type === 'error') { this.onError(data.message); return; }
      if (data.trackId !== this.trackId) return;
      this.state = { ...data, position: data.position / rate }; this.onState(this.state);
    };
    this.node.port.postMessage({ type: 'load', channels, loop, limit: Number.isFinite(this.limit) ? this.limit : null, trackId: this.trackId }, channels.map(c => c.buffer));
    return { duration: decoded.duration, sampleRate: rate };
  }
  async play() { await this.activate(); this.node?.port.postMessage({ type: 'play' }); }
  pause() { this.node?.port.postMessage({ type: 'pause' }); }
  async restart() { await this.activate(); this.node?.port.postMessage({ type: 'restart' }); }
  seek(seconds) { this.node?.port.postMessage({ type: 'seek', position: Math.round(seconds * this.context.sampleRate) }); }
  setLimit(limit) { this.limit = limit; this.node?.port.postMessage({ type: 'limit', limit: Number.isFinite(limit) ? limit : null }); }
  setChannel(channel) {
    if (!Number.isInteger(channel) || channel < -1 || channel >= this.channelCount) throw new Error('无效的声道选择。');
    this.soloChannel = channel; this.node?.port.postMessage({ type: 'channel', channel });
  }
  setVolume(volume) { this.volume = volume; if (this.gain) this.gain.gain.setTargetAtTime(volume, this.context.currentTime, 0.02); }
}
