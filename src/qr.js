const QR_LEVEL_L = 1;

const VERSION_TABLE = [
  null,
  { version: 1, dataCodewords: 19, eccCodewords: 7, byteCapacity: 17 },
  { version: 2, dataCodewords: 34, eccCodewords: 10, byteCapacity: 32 },
  { version: 3, dataCodewords: 55, eccCodewords: 15, byteCapacity: 53 },
  { version: 4, dataCodewords: 80, eccCodewords: 20, byteCapacity: 78 },
  { version: 5, dataCodewords: 108, eccCodewords: 26, byteCapacity: 106 },
];

const ALIGNMENT_CENTERS = {
  2: [6, 18],
  3: [6, 22],
  4: [6, 26],
  5: [6, 30],
};

const encoder = new TextEncoder();

function appendBits(buffer, value, length) {
  for (let i = length - 1; i >= 0; i -= 1) {
    buffer.push((value >>> i) & 1);
  }
}

function bitsToBytes(bits) {
  const bytes = [];
  for (let i = 0; i < bits.length; i += 8) {
    let value = 0;
    for (let j = 0; j < 8; j += 1) {
      value = (value << 1) | (bits[i + j] || 0);
    }
    bytes.push(value);
  }
  return bytes;
}

const gfExp = new Uint8Array(512);
const gfLog = new Uint8Array(256);

function initGaloisField() {
  let value = 1;
  for (let i = 0; i < 255; i += 1) {
    gfExp[i] = value;
    gfLog[value] = i;
    value <<= 1;
    if (value & 0x100) {
      value ^= 0x11d;
    }
  }
  for (let i = 255; i < 512; i += 1) {
    gfExp[i] = gfExp[i - 255];
  }
}

function gfMultiply(x, y) {
  if (x === 0 || y === 0) {
    return 0;
  }
  return gfExp[gfLog[x] + gfLog[y]];
}

function reedSolomonDivisor(degree) {
  const result = new Uint8Array(degree);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i += 1) {
    for (let j = 0; j < degree; j += 1) {
      result[j] = gfMultiply(result[j], root);
      if (j + 1 < degree) {
        result[j] ^= result[j + 1];
      }
    }
    root = gfMultiply(root, 2);
  }
  return result;
}

function reedSolomonRemainder(data, divisor) {
  const result = new Uint8Array(divisor.length);
  data.forEach((byte) => {
    const factor = byte ^ result[0];
    result.copyWithin(0, 1);
    result[result.length - 1] = 0;
    divisor.forEach((coefficient, index) => {
      result[index] ^= gfMultiply(coefficient, factor);
    });
  });
  return Array.from(result);
}

function pickVersion(bytes) {
  const config = VERSION_TABLE.find((entry) => entry && bytes.length <= entry.byteCapacity);
  if (!config) {
    throw new Error("La URL es demasiado larga para el generador QR local.");
  }
  return config;
}

function encodeData(text, config) {
  const bytes = Array.from(encoder.encode(text));
  const bits = [];

  appendBits(bits, 0b0100, 4);
  appendBits(bits, bytes.length, 8);
  bytes.forEach((byte) => appendBits(bits, byte, 8));

  const dataBitLength = config.dataCodewords * 8;
  appendBits(bits, 0, Math.min(4, dataBitLength - bits.length));
  while (bits.length % 8 !== 0) {
    bits.push(0);
  }

  const dataCodewords = bitsToBytes(bits);
  for (let pad = 0; dataCodewords.length < config.dataCodewords; pad += 1) {
    dataCodewords.push(pad % 2 === 0 ? 0xec : 0x11);
  }

  return dataCodewords;
}

function createMatrix(size) {
  return {
    modules: Array.from({ length: size }, () => Array(size).fill(false)),
    reserved: Array.from({ length: size }, () => Array(size).fill(false)),
  };
}

function setModule(matrix, row, col, value, reserved = true) {
  if (row < 0 || col < 0 || row >= matrix.modules.length || col >= matrix.modules.length) {
    return;
  }
  matrix.modules[row][col] = value;
  matrix.reserved[row][col] = reserved;
}

function drawFinder(matrix, row, col) {
  for (let y = -4; y <= 4; y += 1) {
    for (let x = -4; x <= 4; x += 1) {
      const distance = Math.max(Math.abs(x), Math.abs(y));
      setModule(matrix, row + y, col + x, distance !== 2 && distance !== 4);
    }
  }
}

function drawAlignment(matrix, row, col) {
  for (let y = -2; y <= 2; y += 1) {
    for (let x = -2; x <= 2; x += 1) {
      const distance = Math.max(Math.abs(x), Math.abs(y));
      setModule(matrix, row + y, col + x, distance !== 1);
    }
  }
}

function drawPatterns(matrix, version) {
  const size = matrix.modules.length;
  drawFinder(matrix, 3, 3);
  drawFinder(matrix, 3, size - 4);
  drawFinder(matrix, size - 4, 3);

  for (let i = 8; i < size - 8; i += 1) {
    const value = i % 2 === 0;
    setModule(matrix, 6, i, value);
    setModule(matrix, i, 6, value);
  }

  const centers = ALIGNMENT_CENTERS[version] || [];
  centers.forEach((row) => {
    centers.forEach((col) => {
      const nearTop = row < 9;
      const nearLeft = col < 9;
      const nearRight = col > size - 10;
      if (!((nearTop && nearLeft) || (nearTop && nearRight) || (row > size - 10 && nearLeft))) {
        drawAlignment(matrix, row, col);
      }
    });
  });

  for (let i = 0; i < 8; i += 1) {
    setModule(matrix, 8, i, false);
    setModule(matrix, i, 8, false);
    setModule(matrix, 8, size - 1 - i, false);
    setModule(matrix, size - 1 - i, 8, false);
  }

  setModule(matrix, 8, size - 8, true);
}

function maskBit(mask, row, col) {
  if (mask === 0) {
    return (row + col) % 2 === 0;
  }
  return false;
}

function drawCodewords(matrix, codewords) {
  const size = matrix.modules.length;
  const bits = [];
  codewords.forEach((byte) => appendBits(bits, byte, 8));

  let bitIndex = 0;
  let upward = true;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) {
      right -= 1;
    }
    for (let vertical = 0; vertical < size; vertical += 1) {
      const row = upward ? size - 1 - vertical : vertical;
      for (let col = right; col >= right - 1; col -= 1) {
        if (matrix.reserved[row][col]) {
          continue;
        }
        const bit = bits[bitIndex] === 1;
        setModule(matrix, row, col, bit !== maskBit(0, row, col), false);
        bitIndex += 1;
      }
    }
    upward = !upward;
  }
}

function formatBits() {
  let data = (QR_LEVEL_L << 3) | 0;
  let rem = data;
  for (let i = 0; i < 10; i += 1) {
    rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  }
  return ((data << 10) | rem) ^ 0x5412;
}

function getBit(value, index) {
  return ((value >>> index) & 1) === 1;
}

function drawFormatBits(matrix) {
  const size = matrix.modules.length;
  const bits = formatBits();

  for (let i = 0; i <= 5; i += 1) setModule(matrix, 8, i, getBit(bits, i));
  setModule(matrix, 8, 7, getBit(bits, 6));
  setModule(matrix, 8, 8, getBit(bits, 7));
  setModule(matrix, 7, 8, getBit(bits, 8));
  for (let i = 9; i < 15; i += 1) setModule(matrix, 14 - i, 8, getBit(bits, i));

  for (let i = 0; i < 8; i += 1) setModule(matrix, size - 1 - i, 8, getBit(bits, i));
  for (let i = 8; i < 15; i += 1) setModule(matrix, 8, size - 15 + i, getBit(bits, i));
  setModule(matrix, 8, size - 8, true);
}

function makeQr(text) {
  initGaloisField();
  const bytes = Array.from(encoder.encode(text));
  const config = pickVersion(bytes);
  const data = encodeData(text, config);
  const divisor = reedSolomonDivisor(config.eccCodewords);
  const ecc = reedSolomonRemainder(data, divisor);
  const matrix = createMatrix(17 + config.version * 4);

  drawPatterns(matrix, config.version);
  drawCodewords(matrix, data.concat(ecc));
  drawFormatBits(matrix);
  return matrix.modules;
}

export function renderQrCode(canvas, text) {
  const modules = makeQr(text);
  const quietZone = 4;
  const moduleCount = modules.length + quietZone * 2;
  const size = canvas.width;
  const scale = Math.floor(size / moduleCount);
  const offset = Math.floor((size - modules.length * scale) / 2);
  const context = canvas.getContext("2d");

  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, size, size);
  context.fillStyle = "#172026";
  modules.forEach((row, y) => {
    row.forEach((enabled, x) => {
      if (enabled) {
        context.fillRect(offset + x * scale, offset + y * scale, scale, scale);
      }
    });
  });
}
