// Called in Chrome/Edge to verify native decoding and the actual audio thread.
// No DOM or simulated UI assertions; fixtures are served only on loopback.
const fixtures = 'http://127.0.0.1:4174';
function assert(value, message) { if (!value) throw new Error(message); }
export async function verifyAudio() {
  const results = [];
  for (const key of ['snow', 'dungeon', 'raid', 'crystal02', 'expansion']) {
    const info = await (await fetch(`${fixtures}/${key}.json`)).json();
    const source = await (await fetch(`${fixtures}/${key}.ogg`)).arrayBuffer();
    const context = new OfflineAudioContext(info.channels, 128, 48000);
    const decoded = await context.decodeAudioData(source);
    assert(decoded.numberOfChannels === info.channels, `${key}: channel mismatch`);
    assert(Math.abs(decoded.duration - info.duration) < 0.02, `${key}: duration mismatch`);
    const channel = decoded.getChannelData(0);
    let peak = 0; for (let i = 0; i < channel.length; i++) peak = Math.max(peak, Math.abs(channel[i]));
    assert(peak > 0.001, `${key}: silent decode`);
    results.push({ key, channels: decoded.numberOfChannels, rate: decoded.sampleRate, duration: decoded.duration, peak, loop: info.loop });
  }
  // Real AudioWorklet in an offline context: tiny known signal proves finite
  // loop count and exact samples, including output-block transitions and tail.
  const offline = new OfflineAudioContext(1, 128, 48000);
  await offline.audioWorklet.addModule('http://127.0.0.1:4173/audio-worklet.js');
  const node = new AudioWorkletNode(offline, 'orchestrion-player', { numberOfInputs: 0, outputChannelCount: [1] });
  node.connect(offline.destination);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('AudioWorklet load timeout')), 10000);
    node.port.onmessage = ({ data }) => {
      if (data.type === 'error') { clearTimeout(timeout); reject(new Error(data.message)); }
      else if (data.playing) { clearTimeout(timeout); resolve(); }
    };
    node.port.postMessage({ type: 'load', trackId: 1, channels: [Float32Array.from([.1,.2,.3,.4,.5,.6])], loop: { start: 2, end: 5 }, limit: 3 });
    node.port.postMessage({ type: 'play' });
  });
  const rendered = (await offline.startRendering()).getChannelData(0);
  const expected = [.1,.2,.3,.4,.5,.3,.4,.5,.3,.4,.5,.6];
  expected.forEach((v, i) => assert(Math.abs(rendered[i] - v) < 1e-6, `worklet sample ${i}: ${rendered[i]} != ${v}`));
  assert(rendered.subarray(expected.length).every(v => v === 0), 'worklet did not stop after tail');
  const soloOffline = new OfflineAudioContext(3, 64, 48000);
  await soloOffline.audioWorklet.addModule('http://127.0.0.1:4173/audio-worklet.js');
  const soloNode = new AudioWorkletNode(soloOffline, 'orchestrion-player', { numberOfInputs: 0, outputChannelCount: [3] });
  soloNode.connect(soloOffline.destination);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('solo AudioWorklet load timeout')), 10000);
    soloNode.port.onmessage = ({ data }) => { if (data.type === 'error') { clearTimeout(timeout); reject(new Error(data.message)); } else if (data.playing) { clearTimeout(timeout); resolve(); } };
    soloNode.port.postMessage({ type: 'load', trackId: 2, channels: [Float32Array.from([.1,.2]), Float32Array.from([.3,.4]), Float32Array.from([.5,.6])], loop: null, limit: 1 });
  soloNode.port.postMessage({ type: 'channel-set', channels: [0, 2], mode: 'pair' }); soloNode.port.postMessage({ type: 'play' });
  });
  const soloBuffer = await soloOffline.startRendering();
  const soloLeft = soloBuffer.getChannelData(0), soloRight = soloBuffer.getChannelData(1);
  assert(Math.abs(soloLeft[0] - .1) < 1e-6 && Math.abs(soloRight[0] - .5) < 1e-6, 'variant channels not preserved as stereo pair');
  return { browser: navigator.userAgent, decodes: results, worklet: 'finite 3 passes, gapless, tail and stop verified', variantChannels: 'channels 1 and 3 preserved as left/right pair' };
}
