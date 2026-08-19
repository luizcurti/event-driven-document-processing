import { describe, expect, it } from "vitest";
import { inflateSync } from "node:zlib";
import { createPlaceholderPng } from "../../src/contexts/document-processing/infrastructure/adapters/png-placeholder";

const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

function readChunks(png: Buffer): Array<{ type: string; data: Buffer }> {
  const chunks: Array<{ type: string; data: Buffer }> = [];
  let offset = PNG_SIGNATURE.length;

  while (offset < png.length) {
    const length = png.readUInt32BE(offset);
    const type = png.subarray(offset + 4, offset + 8).toString("ascii");
    const data = png.subarray(offset + 8, offset + 8 + length);
    chunks.push({ type, data });
    offset += 8 + length + 4; // length + type + data + crc
  }

  return chunks;
}

describe("createPlaceholderPng", () => {
  it("produces a buffer starting with the PNG signature", () => {
    const png = createPlaceholderPng(10, 10);
    expect(png.subarray(0, 8)).toEqual(PNG_SIGNATURE);
  });

  it("encodes width/height/bit-depth/color-type in the IHDR chunk", () => {
    const png = createPlaceholderPng(320, 200);
    const [ihdr] = readChunks(png);

    expect(ihdr?.type).toBe("IHDR");
    expect(ihdr?.data.readUInt32BE(0)).toBe(320);
    expect(ihdr?.data.readUInt32BE(4)).toBe(200);
    expect(ihdr?.data[8]).toBe(8); // bit depth
    expect(ihdr?.data[9]).toBe(2); // truecolor
  });

  it("ends with an empty IEND chunk", () => {
    const png = createPlaceholderPng(4, 4);
    const chunks = readChunks(png);
    const iend = chunks[chunks.length - 1];

    expect(iend?.type).toBe("IEND");
    expect(iend?.data.length).toBe(0);
  });

  it("decompresses IDAT into a raw buffer painted with the requested RGB color", () => {
    const width = 3;
    const height = 2;
    const rgb: [number, number, number] = [10, 20, 30];
    const png = createPlaceholderPng(width, height, rgb);
    const idat = readChunks(png).find((chunk) => chunk.type === "IDAT");

    const raw = inflateSync(idat!.data);
    const rowBytes = width * 3 + 1;
    expect(raw.length).toBe(rowBytes * height);

    for (let y = 0; y < height; y++) {
      const rowStart = y * rowBytes;
      expect(raw[rowStart]).toBe(0); // filter byte
      for (let x = 0; x < width; x++) {
        const pixelStart = rowStart + 1 + x * 3;
        expect([raw[pixelStart], raw[pixelStart + 1], raw[pixelStart + 2]]).toEqual(rgb);
      }
    }
  });

  it("defaults to the documented placeholder color when none is given", () => {
    const png = createPlaceholderPng(1, 1);
    const idat = readChunks(png).find((chunk) => chunk.type === "IDAT");
    const raw = inflateSync(idat!.data);

    expect([raw[1], raw[2], raw[3]]).toEqual([226, 232, 240]);
  });
});
