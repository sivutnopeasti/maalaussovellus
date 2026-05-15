const fs = require('fs');
const path = require('path');

const HEADER_SIZE = 4377;
const NAME_SIZE = 255;
const SIZE_SIZE = 14;
const MTIME_SIZE = 12;

function parseHeader(buf) {
  const name = buf.slice(0, NAME_SIZE).toString('utf8').replace(/\0/g, '').trim();
  const sizeStr = buf.slice(NAME_SIZE, NAME_SIZE + SIZE_SIZE).toString('utf8').replace(/\0/g, '').trim();
  const mtimeStr = buf.slice(NAME_SIZE + SIZE_SIZE, NAME_SIZE + SIZE_SIZE + MTIME_SIZE).toString('utf8').replace(/\0/g, '').trim();
  const prefix = buf.slice(NAME_SIZE + SIZE_SIZE + MTIME_SIZE, HEADER_SIZE).toString('utf8').replace(/\0/g, '').trim();
  return {
    name,
    size: sizeStr ? parseInt(sizeStr, 10) : 0,
    mtime: mtimeStr ? parseInt(mtimeStr, 10) : 0,
    prefix
  };
}

const SKIP_FILES = ['object-cache.php', 'advanced-cache.php'];

function shouldSkip(name, prefix) {
  if (prefix === '.' && SKIP_FILES.includes(name)) return true;
  if (name === 'package.json' && prefix === '.') return true;
  if (prefix.startsWith('cache/') || prefix === 'cache') return true;
  if (prefix.startsWith('wp-rocket-config/') || prefix === 'wp-rocket-config') return true;
  if (prefix.startsWith('litespeed/') || prefix === 'litespeed') return true;
  return false;
}

function getOutputPath(header, wpContentDir, sqlOutputDir) {
  const { name, prefix } = header;

  if (name === 'database.sql' && prefix === '.') {
    return path.join(sqlOutputDir, 'database.sql');
  }

  if (shouldSkip(name, prefix)) return null;

  if (prefix === '.') {
    return path.join(wpContentDir, name);
  }

  return path.join(wpContentDir, prefix, name);
}

function extractWpress(wpressPath, wpContentDir, sqlOutputDir) {
  const fd = fs.openSync(wpressPath, 'r');
  const totalSize = fs.fstatSync(fd).size;
  const headerBuf = Buffer.alloc(HEADER_SIZE);
  const CHUNK_SIZE = 4 * 1024 * 1024;

  let position = 0;
  let fileCount = 0;
  let skipped = 0;
  let lastProgressTime = Date.now();

  console.log(`Puretaan: ${path.basename(wpressPath)}`);
  console.log(`Kohde: ${wpContentDir}`);
  console.log(`SQL: ${sqlOutputDir}`);
  console.log(`Ohitetaan: ${SKIP_FILES.join(', ')}, cache/, wp-rocket-config/, litespeed/`);
  console.log('---');

  while (position + HEADER_SIZE <= totalSize) {
    const bytesRead = fs.readSync(fd, headerBuf, 0, HEADER_SIZE, position);
    if (bytesRead < HEADER_SIZE) break;
    position += HEADER_SIZE;

    const header = parseHeader(headerBuf);
    if (!header.name) break;

    const outputPath = getOutputPath(header, wpContentDir, sqlOutputDir);

    if (header.size > 0) {
      if (outputPath) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        const wfd = fs.openSync(outputPath, 'w');
        let remaining = header.size;
        while (remaining > 0) {
          const toRead = Math.min(CHUNK_SIZE, remaining);
          const chunk = Buffer.alloc(toRead);
          fs.readSync(fd, chunk, 0, toRead, position);
          fs.writeSync(wfd, chunk, 0, toRead);
          position += toRead;
          remaining -= toRead;
        }
        fs.closeSync(wfd);
        fileCount++;
      } else {
        position += header.size;
        skipped++;
      }
    } else if (header.name !== '.') {
      if (outputPath) {
        fs.mkdirSync(path.dirname(outputPath), { recursive: true });
        fs.writeFileSync(outputPath, Buffer.alloc(0));
        fileCount++;
      } else {
        skipped++;
      }
    }

    const now = Date.now();
    if (now - lastProgressTime > 3000) {
      const progress = ((position / totalSize) * 100).toFixed(1);
      const processedGB = (position / 1024 / 1024 / 1024).toFixed(2);
      console.log(`${progress}% (${processedGB} GB) - ${fileCount} tiedostoa purettu, ${skipped} ohitettu`);
      lastProgressTime = now;
    }
  }

  fs.closeSync(fd);
  console.log('---');
  console.log(`Valmis! ${fileCount} tiedostoa purettu, ${skipped} ohitettu.`);
}

const wpressFile = process.argv[2];
const wpContentDir = process.argv[3];
const sqlDir = process.argv[4];

if (!wpressFile || !wpContentDir || !sqlDir) {
  console.log('Kaytto: node extract-direct.js <input.wpress> <wp-content-dir> <sql-output-dir>');
  process.exit(1);
}

extractWpress(wpressFile, wpContentDir, sqlDir);
