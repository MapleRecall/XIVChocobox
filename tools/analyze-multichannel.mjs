import { spawnSync } from 'node:child_process';
import { openGame } from './game-files.mjs';
import { parseScd } from '../dist/lib/scd.js';

const root = process.argv[2] || 'C:/Games/FFXIV';
const paths = process.argv.slice(3).length ? process.argv.slice(3) : [
  'music/ffxiv/BGM_Con_CrystalTower_01.scd',
  'music/ffxiv/BGM_Con_CrystalTower_02.scd',
  'music/ffxiv/BGM_Con_CrystalTower_03.scd',
];
const pack = await openGame(root);

function run(command, args, input) {
  const result = spawnSync(command, args, { input, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  if (result.status !== 0) throw new Error(`${command} failed: ${result.stderr.toString()}`);
  return result.stdout;
}
function corr(a, b, n) {
  let aa = 0, bb = 0;
  for (let i = 0; i < n; i++) { aa += a[i]; bb += b[i]; }
  aa /= n; bb /= n;
  let ab = 0, av = 0, bv = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - aa, y = b[i] - bb; ab += x * y; av += x * x; bv += y * y; }
  return ab / Math.sqrt(av * bv || 1);
}
for (const path of paths) {
  const info = parseScd(await pack.read(path));
  const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', 'pipe:0'], info.ogg).toString());
  const stream = probe.streams?.[0] || {};
  const rate = 1000, raw = run('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-i', 'pipe:0', '-map', '0:a:0', '-ac', String(info.channels), '-ar', String(rate), '-f', 'f32le', 'pipe:1'], info.ogg);
  const samples = new Float32Array(raw.buffer, raw.byteOffset, Math.floor(raw.byteLength / 4));
  const frames = Math.floor(samples.length / info.channels), channels = Array.from({ length: info.channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) for (let ch = 0; ch < info.channels; ch++) channels[ch][i] = samples[i * info.channels + ch];
  const rms = channels.map(channel => Math.sqrt(channel.reduce((sum, x) => sum + x * x, 0) / frames));
  const correlation = channels.map((channel, i) => channels.map((other, j) => j <= i ? Number(corr(channel, other, frames).toFixed(3)) : null));
  console.log(JSON.stringify({ path, codec: info.codec, duration: info.duration, sampleRate: info.sampleRate, channels: info.channels, vorbis: { channels: stream.channels, channelLayout: stream.channel_layout || null, sampleRate: stream.sample_rate, duration: stream.duration }, rms: rms.map(x => Number(x.toFixed(4))), correlation }, null, 2));
}
