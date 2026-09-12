import { SqPack } from './lib/sqpack.js';
import { buildCatalog } from './lib/excel.js';
import { parseScd } from './lib/scd.js';

let pack;
function metadata(parsed) {
  const { ogg, ...result } = parsed;
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
      const result = parseScd(await pack.read(data.path));
      self.postMessage({ id: data.id, type: 'result', result }, result.ogg ? [result.ogg.buffer] : []);
    } else if (data.type === 'metadata') {
      if (!pack) throw new Error('请先选择资源目录。');
      const result = metadata(parseScd(await pack.read(data.path)));
      self.postMessage({ id: data.id, type: 'result', result });
    }
  } catch (error) { self.postMessage({ id: data.id, type: 'error', message: error.message }); }
};
