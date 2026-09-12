import { openGame } from './game-files.mjs';
import { ascii, cstring, view } from '../dist/lib/binary.js';
import { buildCatalog } from '../dist/lib/excel.js';

const root = process.argv[2] || 'C:/Games/FFXIV/game/sqpack';
const requested = process.argv.slice(3);
const pack = await openGame(root);
const catalog = await buildCatalog(pack);
const paths = requested.length ? requested : catalog.tracks.map(t => t.path).filter(p => /CrystalTower/i.test(p));

function inspect(bytes) {
  const d = view(bytes), headerSize = d.getUint16(14, true), offsetsAt = headerSize;
  const entryCount = d.getUint16(offsetsAt + 4, true), entryTable = d.getUint32(offsetsAt + 12, true);
  const result = { signature: ascii(bytes, 0, 8), version: d.getUint32(8, true), headerSize, entryCount, entries: [] };
  for (let i = 0; i < entryCount; i++) {
    const at = d.getUint32(entryTable + i * 4, true), size = d.getUint32(at, true), channels = d.getUint32(at + 4, true), sampleRate = d.getUint32(at + 8, true), codec = d.getUint32(at + 12, true), loopStart = d.getUint32(at + 16, true), loopEnd = d.getUint32(at + 20, true), streamOffset = d.getUint32(at + 24, true), auxCount = d.getUint16(at + 28, true);
    let auxAt = at + 32, aux = [];
    for (let j = 0; j < auxCount; j++) {
      const name = ascii(bytes, auxAt, 4), chunkSize = d.getUint32(auxAt + 4, true);
      const item = { name, chunkSize };
      if (name === 'MARK' && chunkSize >= 20) {
        const count = d.getUint32(auxAt + 16, true);
        item.loopStartBlock = d.getUint32(auxAt + 8, true); item.loopEndBlock = d.getUint32(auxAt + 12, true); item.count = count;
        item.marks = Array.from({ length: Math.min(count, 128) }, (_, k) => d.getUint32(auxAt + 20 + k * 4, true));
      }
      aux.push(item); auxAt += chunkSize;
    }
    const extraAt = at + 32 + streamOffset - (auxAt - (at + 32));
    const extra = bytes.subarray(auxAt, at + 32 + streamOffset), dataAt = at + 32 + streamOffset;
    let wrapper = null, comments = null;
    if (codec === 6 && extra.length >= 32) {
      const version = extra[0], wrapperSize = extra[1], seekSize = new DataView(extra.buffer, extra.byteOffset, extra.byteLength).getUint32(16, true), vorbisSize = new DataView(extra.buffer, extra.byteOffset, extra.byteLength).getUint32(20, true);
      wrapper = { version, wrapperSize, seekSize, vorbisSize, dataSize: size };
      const ogg = new Uint8Array(vorbisSize + size); ogg.set(extra.subarray(wrapperSize + seekSize, wrapperSize + seekSize + vorbisSize)); ogg.set(bytes.subarray(dataAt, dataAt + size), vorbisSize);
      const od = new DataView(ogg.buffer), tags = [];
      for (let p = 0; p + 7 < ogg.length; p++) if (ascii(ogg, p, 7) === '\x03vorbis') {
        const vendorLength = od.getUint32(p + 7, true); let q = p + 11 + vendorLength; if (q + 4 > ogg.length) break;
        const count = od.getUint32(q, true); q += 4;
        for (let k = 0; k < count && q + 4 <= ogg.length; k++) { const length = od.getUint32(q, true); q += 4; if (q + length > ogg.length) break; tags.push(cstring(ogg, q, q + length)); q += length; }
        comments = tags.filter(t => /^(LOOP|TITLE|ARTIST|ALBUM|ENCODER)/i.test(t)); break;
      }
    }
    result.entries.push({ index: i, offset: at, size, channels, sampleRate, codec: `0x${codec.toString(16)}`, loopStart, loopEnd, streamOffset, auxCount, aux, wrapper, comments, dataHead: Array.from(bytes.subarray(dataAt, Math.min(dataAt + 16, dataAt + size))).map(x => x.toString(16).padStart(2, '0')).join(' ') });
  }
  return result;
}

for (const path of paths) {
  try {
    const track = catalog.tracks.find(t => t.path.toLowerCase() === path.toLowerCase());
    const bytes = await pack.read(path);
    console.log(JSON.stringify({ path, title: track?.title, kind: track?.kind, ...inspect(bytes) }, null, 2));
  } catch (error) { console.error(JSON.stringify({ path, error: error.message }, null, 2)); }
}
