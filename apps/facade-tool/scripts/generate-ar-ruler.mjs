/**
 * Generates public/ruler-1m.usdz
 *
 * A 1-metre-long × 4 cm × 4 cm blue reference bar for iOS AR Quick Look.
 * Run once with:   node scripts/generate-ar-ruler.mjs
 *
 * USDZ format requirements (https://openusd.org/release/spec_usdz.html):
 *   - ZIP archive, STORE (no compression)
 *   - Each file's data must start at a 64-byte boundary within the archive
 */

import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(__dirname, "../public/ruler-1m.usdz");

// ── 1. USD ASCII content ─────────────────────────────────────────────────────

const USDA = `#usda 1.0
(
    defaultPrim = "Ruler"
    metersPerUnit = 1.0
    upAxis = "Y"
)

def Xform "Ruler"
{
    def Mesh "Bar" (
        prepend apiSchemas = ["MaterialBindingAPI"]
    )
    {
        float3[] extent = [(-0.5, 0, -0.02), (0.5, 0.04, 0.02)]
        int[] faceVertexCounts = [4, 4, 4, 4, 4, 4]
        int[] faceVertexIndices = [
            0, 1, 2, 3,
            7, 6, 5, 4,
            0, 4, 5, 1,
            1, 5, 6, 2,
            2, 6, 7, 3,
            3, 7, 4, 0
        ]
        normal3f[] normals = [
            (0, 0, 1), (0, 0, 1), (0, 0, 1), (0, 0, 1),
            (0, 0, -1), (0, 0, -1), (0, 0, -1), (0, 0, -1),
            (-1, 0, 0), (-1, 0, 0), (-1, 0, 0), (-1, 0, 0),
            (1, 0, 0), (1, 0, 0), (1, 0, 0), (1, 0, 0),
            (0, -1, 0), (0, -1, 0), (0, -1, 0), (0, -1, 0),
            (0, 1, 0), (0, 1, 0), (0, 1, 0), (0, 1, 0)
        ] (interpolation = "faceVarying")
        point3f[] points = [
            (-0.5, 0,    0.02), (0.5, 0,    0.02),
            (0.5,  0.04, 0.02), (-0.5, 0.04, 0.02),
            (-0.5, 0,   -0.02), (0.5, 0,   -0.02),
            (0.5,  0.04,-0.02), (-0.5, 0.04,-0.02)
        ]
        uniform token subdivisionScheme = "none"
        rel material:binding = </Ruler/BlueMaterial>
    }

    def Material "BlueMaterial"
    {
        token outputs:surface.connect = </Ruler/BlueMaterial/Shader.outputs:surface>

        def Shader "Shader"
        {
            uniform token info:id = "UsdPreviewSurface"
            color3f inputs:diffuseColor = (0.2, 0.55, 1.0)
            float  inputs:roughness    = 0.45
            float  inputs:metallic     = 0.0
            float  inputs:opacity      = 1.0
            token  outputs:surface
        }
    }
}
`;

// ── 2. CRC-32 ────────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[i] = c;
  }
  return t;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = (c >>> 8) ^ CRC_TABLE[(c ^ b) & 0xff];
  return (c ^ 0xffffffff) >>> 0;
}

// ── 3. ZIP helpers ───────────────────────────────────────────────────────────

function u16(n) {
  const b = Buffer.alloc(2);
  b.writeUInt16LE(n, 0);
  return b;
}
function u32(n) {
  const b = Buffer.alloc(4);
  b.writeUInt32LE(n >>> 0, 0);
  return b;
}

/**
 * Build a USDZ-compliant ZIP archive containing a single USDA file.
 *
 * The local file header + filename + extra-field padding = exactly a
 * multiple of 64 bytes, so the file data begins on a 64-byte boundary.
 */
function buildUSDZ(filename, content) {
  const nameBytes = Buffer.from(filename, "utf-8");
  const contentBytes = Buffer.from(content, "utf-8");
  const crc = crc32(contentBytes);

  // Fixed-size portion of local header (30 bytes) + filename
  const fixedHeaderLen = 30 + nameBytes.length;
  // Extra field needed so that (fixedHeaderLen + extraLen) is divisible by 64
  const extraLen = (64 - (fixedHeaderLen % 64)) % 64;
  const extra = Buffer.alloc(extraLen); // zero-filled

  // Local file header (30 bytes) + name + extra
  const localHeader = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x03, 0x04]), // PK\x03\x04
    u16(20), // version needed: 2.0
    u16(0), // general purpose flags
    u16(0), // compression: STORE
    u16(0), // last mod time
    u16(0), // last mod date
    u32(crc),
    u32(contentBytes.length), // compressed size
    u32(contentBytes.length), // uncompressed size
    u16(nameBytes.length),
    u16(extraLen),
    nameBytes,
    extra,
  ]);

  // Sanity check
  if (localHeader.length % 64 !== 0) {
    throw new Error(
      `Header not 64-byte aligned: ${localHeader.length} bytes — ` +
        `filename "${filename}" (${nameBytes.length} bytes)`,
    );
  }

  const localEntry = Buffer.concat([localHeader, contentBytes]);
  const cdOffset = 0; // single entry at start of file

  // Central directory header
  const centralDir = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x01, 0x02]), // PK\x01\x02
    u16(20), // version made by
    u16(20), // version needed
    u16(0), // general purpose flags
    u16(0), // compression: STORE
    u16(0), // last mod time
    u16(0), // last mod date
    u32(crc),
    u32(contentBytes.length),
    u32(contentBytes.length),
    u16(nameBytes.length),
    u16(0), // extra field length
    u16(0), // comment length
    u16(0), // disk number start
    u16(0), // internal attributes
    u32(0), // external attributes
    u32(cdOffset), // local header offset
    nameBytes,
  ]);

  // End of central directory
  const eocd = Buffer.concat([
    Buffer.from([0x50, 0x4b, 0x05, 0x06]), // PK\x05\x06
    u16(0), // disk number
    u16(0), // disk with central dir
    u16(1), // entries on this disk
    u16(1), // total entries
    u32(centralDir.length),
    u32(localEntry.length), // offset of central dir
    u16(0), // comment length
  ]);

  return Buffer.concat([localEntry, centralDir, eocd]);
}

// ── 4. Generate and write ─────────────────────────────────────────────────────

mkdirSync(resolve(__dirname, "../public"), { recursive: true });

const usdzBuf = buildUSDZ("ruler.usda", USDA);
writeFileSync(OUT, usdzBuf);

const contentStart = 30 + "ruler.usda".length + ((64 - ((30 + "ruler.usda".length) % 64)) % 64);
console.log(`✓ public/ruler-1m.usdz written (${usdzBuf.length} bytes)`);
console.log(`  Content starts at byte ${contentStart} (64-byte aligned: ${contentStart % 64 === 0})`);
