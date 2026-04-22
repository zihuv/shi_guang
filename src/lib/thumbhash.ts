/*
 * Adapted from the official ThumbHash JavaScript implementation by Evan Wallace.
 * Source: https://github.com/evanw/thumbhash
 * License: MIT
 */

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") {
    return Buffer.from(bytes).toString("base64");
  }

  let binary = "";
  for (let index = 0; index < bytes.length; index += 1) {
    binary += String.fromCharCode(bytes[index] ?? 0);
  }
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  if (!base64) {
    return new Uint8Array();
  }

  if (typeof Buffer !== "undefined") {
    return new Uint8Array(Buffer.from(base64, "base64"));
  }

  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function thumbHashBytesToBase64(bytes: Uint8Array): string {
  return bytesToBase64(bytes);
}

export function thumbHashBase64ToBytes(base64: string): Uint8Array {
  return base64ToBytes(base64);
}

export function rgbaToThumbHash(width: number, height: number, rgba: Uint8Array): Uint8Array {
  if (width > 100 || height > 100) {
    throw new Error(`${width}x${height} doesn't fit in 100x100`);
  }

  const { PI, round, max, cos, abs } = Math;
  let avgR = 0;
  let avgG = 0;
  let avgB = 0;
  let avgA = 0;

  for (let pixelIndex = 0, byteIndex = 0; pixelIndex < width * height; pixelIndex += 1, byteIndex += 4) {
    const alpha = (rgba[byteIndex + 3] ?? 0) / 255;
    avgR += (alpha * (rgba[byteIndex] ?? 0)) / 255;
    avgG += (alpha * (rgba[byteIndex + 1] ?? 0)) / 255;
    avgB += (alpha * (rgba[byteIndex + 2] ?? 0)) / 255;
    avgA += alpha;
  }

  if (avgA) {
    avgR /= avgA;
    avgG /= avgA;
    avgB /= avgA;
  }

  const hasAlpha = avgA < width * height;
  const lLimit = hasAlpha ? 5 : 7;
  const lx = max(1, round((lLimit * width) / max(width, height)));
  const ly = max(1, round((lLimit * height) / max(width, height)));
  const l: number[] = [];
  const p: number[] = [];
  const q: number[] = [];
  const a: number[] = [];

  for (let pixelIndex = 0, byteIndex = 0; pixelIndex < width * height; pixelIndex += 1, byteIndex += 4) {
    const alpha = (rgba[byteIndex + 3] ?? 0) / 255;
    const r = avgR * (1 - alpha) + (alpha * (rgba[byteIndex] ?? 0)) / 255;
    const g = avgG * (1 - alpha) + (alpha * (rgba[byteIndex + 1] ?? 0)) / 255;
    const b = avgB * (1 - alpha) + (alpha * (rgba[byteIndex + 2] ?? 0)) / 255;
    l[pixelIndex] = (r + g + b) / 3;
    p[pixelIndex] = (r + g) / 2 - b;
    q[pixelIndex] = r - g;
    a[pixelIndex] = alpha;
  }

  const encodeChannel = (channel: number[], nx: number, ny: number) => {
    let dc = 0;
    const ac: number[] = [];
    let scale = 0;
    const fx: number[] = [];

    for (let cy = 0; cy < ny; cy += 1) {
      for (let cx = 0; cx * ny < nx * (ny - cy); cx += 1) {
        let value = 0;

        for (let x = 0; x < width; x += 1) {
          fx[x] = cos((PI / width) * cx * (x + 0.5));
        }

        for (let y = 0; y < height; y += 1) {
          const fy = cos((PI / height) * cy * (y + 0.5));
          for (let x = 0; x < width; x += 1) {
            value += (channel[x + y * width] ?? 0) * (fx[x] ?? 0) * fy;
          }
        }

        value /= width * height;
        if (cx || cy) {
          ac.push(value);
          scale = max(scale, abs(value));
        } else {
          dc = value;
        }
      }
    }

    if (scale) {
      for (let index = 0; index < ac.length; index += 1) {
        ac[index] = 0.5 + (0.5 / scale) * (ac[index] ?? 0);
      }
    }

    return [dc, ac, scale] as const;
  };

  const [lDc, lAc, lScale] = encodeChannel(l, max(3, lx), max(3, ly));
  const [pDc, pAc, pScale] = encodeChannel(p, 3, 3);
  const [qDc, qAc, qScale] = encodeChannel(q, 3, 3);
  const [aDc, aAc, aScale] = hasAlpha ? encodeChannel(a, 5, 5) : [1, [], 0];

  const isLandscape = width > height;
  const header24 =
    round(63 * lDc) |
    (round(31.5 + 31.5 * pDc) << 6) |
    (round(31.5 + 31.5 * qDc) << 12) |
    (round(31 * lScale) << 18) |
    (Number(hasAlpha) << 23);
  const header16 =
    (isLandscape ? ly : lx) |
    (round(63 * pScale) << 3) |
    (round(63 * qScale) << 9) |
    (Number(isLandscape) << 15);

  const hash = [
    header24 & 255,
    (header24 >> 8) & 255,
    header24 >> 16,
    header16 & 255,
    header16 >> 8,
  ];

  let acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  if (hasAlpha) {
    hash.push(round(15 * aDc) | (round(15 * aScale) << 4));
  }

  for (const acChannel of hasAlpha ? [lAc, pAc, qAc, aAc] : [lAc, pAc, qAc]) {
    for (const factor of acChannel) {
      const targetIndex = acStart + (acIndex >> 1);
      hash[targetIndex] = (hash[targetIndex] ?? 0) | (round(15 * factor) << ((acIndex++ & 1) << 2));
    }
  }

  return new Uint8Array(hash);
}

export function thumbHashToApproximateAspectRatio(hash: Uint8Array): number {
  const header = hash[3] ?? 0;
  const hasAlpha = (hash[2] ?? 0) & 0x80;
  const isLandscape = (hash[4] ?? 0) & 0x80;
  const lx = isLandscape ? (hasAlpha ? 5 : 7) : header & 7;
  const ly = isLandscape ? header & 7 : hasAlpha ? 5 : 7;
  return lx / ly;
}

export function thumbHashToRGBA(hash: Uint8Array) {
  const { PI, min, max, cos, round } = Math;
  const header24 = (hash[0] ?? 0) | ((hash[1] ?? 0) << 8) | ((hash[2] ?? 0) << 16);
  const header16 = (hash[3] ?? 0) | ((hash[4] ?? 0) << 8);
  const lDc = (header24 & 63) / 63;
  const pDc = ((header24 >> 6) & 63) / 31.5 - 1;
  const qDc = ((header24 >> 12) & 63) / 31.5 - 1;
  const lScale = ((header24 >> 18) & 31) / 31;
  const hasAlpha = header24 >> 23;
  const pScale = ((header16 >> 3) & 63) / 63;
  const qScale = ((header16 >> 9) & 63) / 63;
  const isLandscape = header16 >> 15;
  const lx = max(3, isLandscape ? (hasAlpha ? 5 : 7) : header16 & 7);
  const ly = max(3, isLandscape ? header16 & 7 : hasAlpha ? 5 : 7);
  const aDc = hasAlpha ? ((hash[5] ?? 0) & 15) / 15 : 1;
  const aScale = ((hash[5] ?? 0) >> 4) / 15;

  let acStart = hasAlpha ? 6 : 5;
  let acIndex = 0;
  const decodeChannel = (nx: number, ny: number, scale: number) => {
    const ac: number[] = [];
    for (let cy = 0; cy < ny; cy += 1) {
      for (let cx = cy ? 0 : 1; cx * ny < nx * (ny - cy); cx += 1) {
        ac.push((((((hash[acStart + (acIndex >> 1)] ?? 0) >> ((acIndex++ & 1) << 2)) & 15) / 7.5 - 1) * scale));
      }
    }
    return ac;
  };

  const lAc = decodeChannel(lx, ly, lScale);
  const pAc = decodeChannel(3, 3, pScale * 1.25);
  const qAc = decodeChannel(3, 3, qScale * 1.25);
  const aAc = hasAlpha ? decodeChannel(5, 5, aScale) : [];

  const ratio = thumbHashToApproximateAspectRatio(hash);
  const width = round(ratio > 1 ? 32 : 32 * ratio);
  const height = round(ratio > 1 ? 32 / ratio : 32);
  const rgba = new Uint8Array(width * height * 4);
  const fx: number[] = [];
  const fy: number[] = [];

  for (let y = 0, byteIndex = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1, byteIndex += 4) {
      let l = lDc;
      let p = pDc;
      let q = qDc;
      let a = aDc;

      for (let cx = 0, limit = max(lx, hasAlpha ? 5 : 3); cx < limit; cx += 1) {
        fx[cx] = cos((PI / width) * (x + 0.5) * cx);
      }

      for (let cy = 0, limit = max(ly, hasAlpha ? 5 : 3); cy < limit; cy += 1) {
        fy[cy] = cos((PI / height) * (y + 0.5) * cy);
      }

      for (let cy = 0, index = 0; cy < ly; cy += 1) {
        for (let cx = cy ? 0 : 1, fy2 = (fy[cy] ?? 0) * 2; cx * ly < lx * (ly - cy); cx += 1, index += 1) {
          l += (lAc[index] ?? 0) * (fx[cx] ?? 0) * fy2;
        }
      }

      for (let cy = 0, index = 0; cy < 3; cy += 1) {
        for (let cx = cy ? 0 : 1, fy2 = (fy[cy] ?? 0) * 2; cx < 3 - cy; cx += 1, index += 1) {
          const factor = (fx[cx] ?? 0) * fy2;
          p += (pAc[index] ?? 0) * factor;
          q += (qAc[index] ?? 0) * factor;
        }
      }

      if (hasAlpha) {
        for (let cy = 0, index = 0; cy < 5; cy += 1) {
          for (let cx = cy ? 0 : 1, fy2 = (fy[cy] ?? 0) * 2; cx < 5 - cy; cx += 1, index += 1) {
            a += (aAc[index] ?? 0) * (fx[cx] ?? 0) * fy2;
          }
        }
      }

      const b = l - (2 / 3) * p;
      const r = (3 * l - b + q) / 2;
      const g = r - q;
      rgba[byteIndex] = max(0, 255 * min(1, r));
      rgba[byteIndex + 1] = max(0, 255 * min(1, g));
      rgba[byteIndex + 2] = max(0, 255 * min(1, b));
      rgba[byteIndex + 3] = max(0, 255 * min(1, a));
    }
  }

  return { width, height, rgba };
}

function rgbaToDataUrl(width: number, height: number, rgba: Uint8Array): string {
  const row = width * 4 + 1;
  const idat = 6 + height * (5 + row);
  const bytes = [
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0,
    width >> 8, width & 255, 0, 0, height >> 8, height & 255, 8, 6, 0, 0, 0,
    0, 0, 0, 0, idat >>> 24, (idat >> 16) & 255, (idat >> 8) & 255, idat & 255,
    73, 68, 65, 84, 120, 1,
  ];

  const table = [
    0, 498536548, 997073096, 651767980, 1994146192, 1802195444, 1303535960,
    1342533948, -306674912, -267414716, -690576408, -882789492, -1687895376,
    -2032938284, -1609899400, -1111625188,
  ];

  let a = 1;
  let b = 0;
  for (let y = 0, byteIndex = 0, rowEnd = row - 1; y < height; y += 1, rowEnd += row - 1) {
    bytes.push(y + 1 < height ? 0 : 1, row & 255, row >> 8, ~row & 255, (row >> 8) ^ 255, 0);
    for (b = (b + a) % 65521; byteIndex < rowEnd; byteIndex += 1) {
      const value = rgba[byteIndex] ?? 0;
      bytes.push(value);
      a = (a + value) % 65521;
      b = (b + a) % 65521;
    }
  }

  bytes.push(
    b >> 8,
    b & 255,
    a >> 8,
    a & 255,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    0,
    73,
    69,
    78,
    68,
    174,
    66,
    96,
    130,
  );

  for (const [start, end] of [
    [12, 29],
    [37, 41 + idat],
  ]) {
    let crc = ~0;
    let crcEnd = end;
    for (let index = start; index < end; index += 1) {
      crc ^= bytes[index] ?? 0;
      crc = (crc >>> 4) ^ (table[crc & 15] ?? 0);
      crc = (crc >>> 4) ^ (table[crc & 15] ?? 0);
    }
    crc = ~crc;
    bytes[crcEnd++] = crc >>> 24;
    bytes[crcEnd++] = (crc >> 16) & 255;
    bytes[crcEnd++] = (crc >> 8) & 255;
    bytes[crcEnd++] = crc & 255;
  }

  return `data:image/png;base64,${bytesToBase64(new Uint8Array(bytes))}`;
}

export function thumbHashToDataUrl(hash: Uint8Array): string {
  const image = thumbHashToRGBA(hash);
  return rgbaToDataUrl(image.width, image.height, image.rgba);
}
