import { SqPack } from './lib/sqpack.js';
import { buildCatalog } from './lib/excel.js?v=20260913-24';
import { parseScd } from './lib/scd.js?v=20260913-22';
import { decodeHca } from './lib/hca/decode.js';
import { decodeTexture } from './lib/tex.js';

let pack;
function metadata(parsed) {
  const { ogg, hca, ...result } = parsed;
  return result;
}

function decodeHcaChannels(parsed) {
  if (parsed.codec !== 'HCA' || !parsed.hca) return parsed;
  if (!parsed.supported) return parsed;
  const decoded = decodeHca(parsed.hca);
  const trimStart = parsed.hcaHeader?.muteHeader || 0;
  const trimEnd = parsed.hcaHeader?.muteFooter || 0;
  const length = Math.max(0, decoded.samplesPerChannel - trimStart - trimEnd);
  const channels = Array.from({ length: decoded.channelCount }, (_, channel) => {
    const pcm = new Float32Array(length);
    for (let sample = 0; sample < length; sample++) pcm[sample] = decoded.pcm[(sample + trimStart) * decoded.channelCount + channel];
    return pcm;
  });
  const result = { ...parsed, pcmChannels: channels };
  delete result.hca;
  return result;
}

self.onmessage = async ({ data }) => {
  try {
    if (data.type === 'open') {
      const next = await SqPack.fromDirectory(data.directory);
      const catalog = await buildCatalog(next, message => self.postMessage({ id: data.id, type: 'progress', message }));
      pack = next; self.postMessage({ id: data.id, type: 'result', result: catalog });
    } else if (data.type === 'track') {
      if (!pack) throw new Error('请先选择资源目录。');
      const result = decodeHcaChannels(parseScd(await pack.read(data.path)));
      const transfer = result.ogg ? [result.ogg.buffer] : result.pcmChannels ? result.pcmChannels.map(channel => channel.buffer) : [];
      self.postMessage({ id: data.id, type: 'result', result }, transfer);
    } else if (data.type === 'metadata') {
      if (!pack) throw new Error('请先选择资源目录。');
      const result = metadata(parseScd(await pack.read(data.path)));
      self.postMessage({ id: data.id, type: 'result', result });
    } else if (data.type === 'texture') {
      if (!pack) throw new Error('请先选择资源目录。');
      const result = decodeTexture(await pack.read(data.path));
      self.postMessage({ id: data.id, type: 'result', result }, [result.rgba.buffer]);
    }
  } catch (error) { self.postMessage({ id: data.id, type: 'error', message: error.message }); }
};
