const assert = (value, message) => { if (!value) throw new Error(message); };

export async function verifyVariant() {
  const offline = new OfflineAudioContext(6, 8, 48000);
  await offline.audioWorklet.addModule('http://127.0.0.1:4174/audio-worklet.js');
  const node = new AudioWorkletNode(offline, 'orchestrion-player', { numberOfInputs: 0, outputChannelCount: [6] });
  node.connect(offline.destination);
  const channels = Array.from({ length: 6 }, (_, index) => Float32Array.from({ length: 8 }, () => [10, 20, 30, 100, 40, 200][index]));
  node.port.postMessage({ type: 'load', channels, loop: null, limit: 1, trackId: 1, variant: { groups: [[0, 2], [1, 4], [3, 5]], marks: [2, 5, 7], loop: null, initialVariant: 0 } });
  node.port.postMessage({ type: 'variant-toggle' });
  node.port.postMessage({ type: 'play' });
  const rendered = await offline.startRendering();
  const left = rendered.getChannelData(0), right = rendered.getChannelData(1);
  assert(left[0] === 10 && right[0] === 30, 'default variant 1 is not stereo');
  assert(left[1] === 10 && right[1] === 30, 'default variant 1 is not stable before the node');
  assert(left[2] === 120 && right[2] === 240, 'transition track did not overlap the switched variant');
  assert(left[4] === 120 && right[4] === 240, 'transition track ended before the next node');
  assert(left[5] === 20 && right[5] === 40, 'transition track did not stop at the next node');
  return { browser: navigator.userAgent, defaultVariant: 'FL/FC', switchedVariant: 'FR/SL', transition: 'LFE/SR from node 5 up to node 7' };
}
