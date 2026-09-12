import { requireRange, view } from './binary.js';

const FORMAT = { L8: 0x1130, A8: 0x1131, BGRA8: 0x1450, BGRX8: 0x1451, BC1: 0x3420, BC2: 0x3430, BC3: 0x3431 };

function read16(bytes, offset) { return bytes[offset] | (bytes[offset + 1] << 8); }
function rgb565(value) {
  return [Math.round(((value >> 11) & 31) * 255 / 31), Math.round(((value >> 5) & 63) * 255 / 63), Math.round((value & 31) * 255 / 31)];
}
function writePixel(output, width, height, x, y, color) {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const at = (y * width + x) * 4; output[at] = color[0]; output[at + 1] = color[1]; output[at + 2] = color[2]; output[at + 3] = color[3];
}
function decodeColorBlock(bytes, offset, output, width, height, blockX, blockY, forceFour) {
  const c0 = read16(bytes, offset), c1 = read16(bytes, offset + 2), first = rgb565(c0), second = rgb565(c1);
  const colors = [[...first, 255], [...second, 255]];
  if (forceFour || c0 > c1) {
    colors.push([Math.round((2 * first[0] + second[0]) / 3), Math.round((2 * first[1] + second[1]) / 3), Math.round((2 * first[2] + second[2]) / 3), 255]);
    colors.push([Math.round((first[0] + 2 * second[0]) / 3), Math.round((first[1] + 2 * second[1]) / 3), Math.round((first[2] + 2 * second[2]) / 3), 255]);
  } else {
    colors.push([Math.round((first[0] + second[0]) / 2), Math.round((first[1] + second[1]) / 2), Math.round((first[2] + second[2]) / 2), 255]);
    colors.push([0, 0, 0, 0]);
  }
  for (let pixel = 0; pixel < 16; pixel++) {
    const index = (bytes[offset + 4 + (pixel >> 2)] >> ((pixel & 3) * 2)) & 3;
    writePixel(output, width, height, blockX * 4 + (pixel & 3), blockY * 4 + (pixel >> 2), colors[index]);
  }
}
function decodeBc(bytes, offset, format, output, width, height, blockX, blockY) {
  if (format === FORMAT.BC3) {
    const a0 = bytes[offset], a1 = bytes[offset + 1], alpha = [a0, a1];
    if (a0 > a1) for (let i = 1; i <= 6; i++) alpha.push(Math.round(((7 - i) * a0 + i * a1) / 7));
    else { for (let i = 1; i <= 4; i++) alpha.push(Math.round(((5 - i) * a0 + i * a1) / 5)); alpha.push(0, 255); }
    let alphaBits = 0; for (let i = 0; i < 6; i++) alphaBits += bytes[offset + 2 + i] * 2 ** (8 * i);
    decodeColorBlock(bytes, offset + 8, output, width, height, blockX, blockY, true);
    for (let pixel = 0; pixel < 16; pixel++) {
      const x = blockX * 4 + (pixel & 3), y = blockY * 4 + (pixel >> 2);
      if (x >= width || y >= height) continue;
      const at = (y * width + x) * 4; output[at + 3] = alpha[Math.floor(alphaBits / 2 ** (pixel * 3)) % 8];
    }
    return;
  }
  if (format === FORMAT.BC2) {
    decodeColorBlock(bytes, offset + 8, output, width, height, blockX, blockY, true);
    for (let pixel = 0; pixel < 16; pixel++) {
      const x = blockX * 4 + (pixel & 3), y = blockY * 4 + (pixel >> 2);
      if (x >= width || y >= height) continue;
      const at = (y * width + x) * 4, nibble = (bytes[offset + (pixel >> 1)] >> ((pixel & 1) * 4)) & 15; output[at + 3] = nibble * 17;
    }
    return;
  }
  decodeColorBlock(bytes, offset, output, width, height, blockX, blockY, false);
}

export function iconTexturePath(id) {
  const value = Number(id);
  if (!Number.isInteger(value) || value <= 0) return null;
  const bucket = Math.floor(value / 1000) * 1000;
  return `ui/icon/${String(bucket).padStart(6, '0')}/${String(value).padStart(6, '0')}.tex`;
}

export function iconTexturePaths(id) {
  const base = iconTexturePath(id);
  return base ? [`${base.slice(0, -4)}_hr1.tex`, base] : [];
}

export function decodeTexture(bytes) {
  if (!(bytes instanceof Uint8Array)) bytes = new Uint8Array(bytes);
  requireRange(bytes, 0, 80, '纹理');
  const d = view(bytes), format = d.getUint16(4, true), width = d.getUint16(8, true), height = d.getUint16(10, true), offset = d.getUint32(28, true) || 80;
  if (!width || !height || width * height > 16 * 1024 * 1024) throw new Error('纹理尺寸异常。');
  const output = new Uint8ClampedArray(width * height * 4);
  if (format === FORMAT.BC1 || format === FORMAT.BC2 || format === FORMAT.BC3) {
    const blockBytes = format === FORMAT.BC1 ? 8 : 16, blocksWide = Math.ceil(width / 4), blocksHigh = Math.ceil(height / 4), needed = blocksWide * blocksHigh * blockBytes;
    requireRange(bytes, offset, needed, '纹理像素');
    let cursor = offset;
    for (let y = 0; y < blocksHigh; y++) for (let x = 0; x < blocksWide; x++, cursor += blockBytes) decodeBc(bytes, cursor, format, output, width, height, x, y);
  } else if (format === FORMAT.BGRA8 || format === FORMAT.BGRX8) {
    requireRange(bytes, offset, width * height * 4, '纹理像素');
    for (let i = 0; i < width * height; i++) { output[i * 4] = bytes[offset + i * 4 + 2]; output[i * 4 + 1] = bytes[offset + i * 4 + 1]; output[i * 4 + 2] = bytes[offset + i * 4]; output[i * 4 + 3] = format === FORMAT.BGRA8 ? bytes[offset + i * 4 + 3] : 255; }
  } else if (format === FORMAT.L8 || format === FORMAT.A8) {
    requireRange(bytes, offset, width * height, '纹理像素');
    for (let i = 0; i < width * height; i++) { const value = bytes[offset + i]; output[i * 4] = format === FORMAT.L8 ? value : 255; output[i * 4 + 1] = format === FORMAT.L8 ? value : 255; output[i * 4 + 2] = format === FORMAT.L8 ? value : 255; output[i * 4 + 3] = format === FORMAT.A8 ? value : 255; }
  } else throw new Error(`暂不支持纹理格式 0x${format.toString(16)}。`);
  return { width, height, format, rgba: output };
}
