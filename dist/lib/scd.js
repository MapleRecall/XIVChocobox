import { ascii, requireRange, utf8, view } from './binary.js';

// Format constant used by the SCD v3 Ogg obfuscation scheme.
const XOR = Uint8Array.from([
  0x3a,0x32,0x32,0x32,0x03,0x7e,0x12,0xf7,0xb2,0xe2,0xa2,0x67,0x32,0x32,0x22,0x32,
  0x32,0x52,0x16,0x1b,0x3c,0xa1,0x54,0x7b,0x1b,0x97,0xa6,0x93,0x1a,0x4b,0xaa,0xa6,
  0x7a,0x7b,0x1b,0x97,0xa6,0xf7,0x02,0xbb,0xaa,0xa6,0xbb,0xf7,0x2a,0x51,0xbe,0x03,
  0xf4,0x2a,0x51,0xbe,0x03,0xf4,0x2a,0x51,0xbe,0x12,0x06,0x56,0x27,0x32,0x32,0x36,
  0x32,0xb2,0x1a,0x3b,0xbc,0x91,0xd4,0x7b,0x58,0xfc,0x0b,0x55,0x2a,0x15,0xbc,0x40,
  0x92,0x0b,0x5b,0x7c,0x0a,0x95,0x12,0x35,0xb8,0x63,0xd2,0x0b,0x3b,0xf0,0xc7,0x14,
  0x51,0x5c,0x94,0x86,0x94,0x59,0x5c,0xfc,0x1b,0x17,0x3a,0x3f,0x6b,0x37,0x32,0x32,
  0x30,0x32,0x72,0x7a,0x13,0xb7,0x26,0x60,0x7a,0x13,0xb7,0x26,0x50,0xba,0x13,0xb4,
  0x2a,0x50,0xba,0x13,0xb5,0x2e,0x40,0xfa,0x13,0x95,0xae,0x40,0x38,0x18,0x9a,0x92,
  0xb0,0x38,0x00,0xfa,0x12,0xb1,0x7e,0x00,0xdb,0x96,0xa1,0x7c,0x08,0xdb,0x9a,0x91,
  0xbc,0x08,0xd8,0x1a,0x86,0xe2,0x70,0x39,0x1f,0x86,0xe0,0x78,0x7e,0x03,0xe7,0x64,
  0x51,0x9c,0x8f,0x34,0x6f,0x4e,0x41,0xfc,0x0b,0xd5,0xae,0x41,0xfc,0x0b,0xd5,0xae,
  0x41,0xfc,0x3b,0x70,0x71,0x64,0x33,0x32,0x12,0x32,0x32,0x36,0x70,0x34,0x2b,0x56,
  0x22,0x70,0x3a,0x13,0xb7,0x26,0x60,0xba,0x1b,0x94,0xaa,0x40,0x38,0x00,0xfa,0xb2,
  0xe2,0xa2,0x67,0x32,0x32,0x12,0x32,0xb2,0x32,0x32,0x32,0x32,0x75,0xa3,0x26,0x7b,
  0x83,0x26,0xf9,0x83,0x2e,0xff,0xe3,0x16,0x7d,0xc0,0x1e,0x63,0x21,0x07,0xe3,0x01,
]);

export function parseScd(bytes) {
  requireRange(bytes, 0, 48);
  const d = view(bytes);
  if (ascii(bytes, 0, 8) !== 'SEDBSSCF' || d.getUint32(8, true) !== 3 || bytes[12] !== 0) throw new Error('暂不支持这个 SCD 版本。');
  const header = d.getUint16(14, true);
  requireRange(bytes, header, 32);
  const count = d.getUint16(header + 4, true), table = d.getUint32(header + 12, true);
  if (count === 0) return { codec: '空资源', supported: false, loop: null, marks: [], reason: '这是一条没有音频的游戏占位资源。' };
  if (count !== 1) throw new Error(`第一版支持单音轨音乐，此资源包含 ${count} 个音轨。`);
  requireRange(bytes, table, count * 4);
  const at = d.getUint32(table, true);
  requireRange(bytes, at, 32);
  const size = d.getUint32(at, true), channels = d.getUint32(at + 4, true), sampleRate = d.getUint32(at + 8, true), codec = d.getUint32(at + 12, true);
  const streamAt = at + 32 + d.getUint32(at + 24, true), auxCount = d.getUint16(at + 28, true);
  requireRange(bytes, streamAt, size);
  if (sampleRate < 8000 || sampleRate > 192000 || channels < 1 || channels > 8) throw new Error('音频采样率或声道数异常。');
  let extra = at + 32, markLoop = null;
  const marks = [];
  for (let i = 0; i < auxCount; i++) {
    requireRange(bytes, extra, 8);
    const chunkSize = d.getUint32(extra + 4, true);
    if (chunkSize < 8 || extra + chunkSize > streamAt) throw new Error('SCD 辅助块长度无效。');
    if (ascii(bytes, extra, 4) === 'MARK') {
      requireRange(bytes, extra, 20);
      const markCount = d.getUint32(extra + 16, true);
      if (20 + markCount * 4 > chunkSize) throw new Error('MARK 长度无效。');
      markLoop = { start: d.getUint32(extra + 8, true), end: d.getUint32(extra + 12, true) + 1 };
      for (let k = 0; k < markCount; k++) marks.push(d.getUint32(extra + 20 + k * 4, true));
    }
    extra += chunkSize;
  }
  const base = { codec: codec === 6 ? 'OGG' : codec === 26 ? 'HCA' : `0x${codec.toString(16)}`, channels, sampleRate, marks, supported: codec === 6 };
  if (codec !== 6) return { ...base, loop: null, reason: codec === 26 ? '此曲目使用 HCA 编码，第一版暂不支持播放。' : `暂不支持 ${base.codec} 编码。` };
  requireRange(bytes, extra, 32);
  const version = bytes[extra], wrapperSize = bytes[extra + 1], key = bytes[extra + 2];
  const seekSize = d.getUint32(extra + 16, true), vorbisSize = d.getUint32(extra + 20, true), vorbisAt = extra + wrapperSize + seekSize;
  if (wrapperSize < 32 || vorbisAt + vorbisSize > streamAt) throw new Error('SCD OGG 包装头无效。');
  requireRange(bytes, vorbisAt, vorbisSize);
  const ogg = new Uint8Array(vorbisSize + size);
  ogg.set(bytes.subarray(vorbisAt, vorbisAt + vorbisSize));
  ogg.set(bytes.subarray(streamAt, streamAt + size), vorbisSize);
  if (version === 2) { for (let i = 0; i < vorbisSize; i++) ogg[i] ^= key; }
  else if (version === 3) { for (let i = 0; i < ogg.length; i++) ogg[i] ^= XOR[((size & 63) + i) & 255] ^ (size & 127); }
  else throw new Error(`暂不支持 SCD OGG 包装版本 ${version}。`);
  const info = parseOgg(ogg);
  let loop = info.loop;
  let loopSource = 'Vorbis 注释';
  // MARK end is inclusive; all player intervals use [start, end).
  if (!loop && markLoop) { loop = markLoop; loopSource = 'MARK'; }
  if (loop && !(loop.start >= 0 && loop.end > loop.start && loop.end <= info.totalSamples)) loop = null;
  return { ...base, sampleRate: info.sampleRate, channels: info.channels, ogg, totalSamples: info.totalSamples, duration: info.totalSamples / info.sampleRate, loop, loopSource: loop ? loopSource : null, marks: marks.filter(m => m <= info.totalSamples) };
}

export function parseOgg(bytes) {
  const d = view(bytes), packets = [], parts = [];
  let packetSize = 0, totalSamples = 0, sampleRate = 0, channels = 0;
  for (let at = 0; at < bytes.length;) {
    requireRange(bytes, at, 27);
    if (ascii(bytes, at, 4) !== 'OggS') throw new Error('解包后的 OGG 页面签名无效。');
    const segments = bytes[at + 26];
    requireRange(bytes, at + 27, segments);
    const granule = d.getBigUint64(at + 6, true);
    if (granule !== 0xffffffffffffffffn) totalSamples = Math.max(totalSamples, Number(granule));
    let body = at + 27 + segments;
    for (let i = 0; i < segments; i++) {
      const length = bytes[at + 27 + i];
      requireRange(bytes, body, length);
      if (packets.length < 2) {
        parts.push(bytes.subarray(body, body + length)); packetSize += length;
        if (length < 255) {
          const packet = new Uint8Array(packetSize); let p = 0;
          for (const part of parts) { packet.set(part, p); p += part.length; }
          packets.push(packet); parts.length = 0; packetSize = 0;
        }
      }
      body += length;
    }
    at = body;
  }
  if (packets.length < 2 || ascii(packets[0], 1, 6) !== 'vorbis' || packets[0][0] !== 1) throw new Error('没有找到 Vorbis 音频头。');
  requireRange(packets[0], 0, 30);
  channels = packets[0][11]; sampleRate = view(packets[0]).getUint32(12, true);
  const comments = packets[1], cv = view(comments), tags = new Map();
  requireRange(comments, 0, 11);
  if (comments[0] !== 3 || ascii(comments, 1, 6) !== 'vorbis') throw new Error('Vorbis 注释头无效。');
  let at = 11 + cv.getUint32(7, true);
  requireRange(comments, at, 4);
  const count = cv.getUint32(at, true); at += 4;
  for (let i = 0; i < count; i++) {
    requireRange(comments, at, 4); const length = cv.getUint32(at, true); at += 4;
    requireRange(comments, at, length);
    const text = utf8.decode(comments.subarray(at, at + length)), split = text.indexOf('=');
    if (split >= 0) tags.set(text.slice(0, split).toUpperCase(), text.slice(split + 1));
    at += length;
  }
  let loop = null;
  if (tags.has('LOOPSTART') && (tags.has('LOOPEND') || tags.has('LOOPLENGTH'))) {
    const start = Number(tags.get('LOOPSTART')), end = tags.has('LOOPEND') ? Number(tags.get('LOOPEND')) : start + Number(tags.get('LOOPLENGTH'));
    if (Number.isSafeInteger(start) && Number.isSafeInteger(end) && start >= 0 && end > start && end <= totalSamples) loop = { start, end };
  }
  if (!sampleRate || !channels || totalSamples <= 0) throw new Error('OGG 音频长度无效。');
  return { sampleRate, channels, totalSamples, loop };
}
