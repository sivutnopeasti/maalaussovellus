const fs = require('fs');
const path = require('path');
const archiver = require('archiver');
const { PassThrough } = require('stream');

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

function getZipPath(header) {
  const { name, prefix } = header;

  // database.sql goes to the root of the zip
  if (name === 'database.sql') return 'database.sql';

  // Skip All-in-One WP Migration metadata
  if (name === 'package.json' && prefix === '.') return null;

  // Root-level PHP files (index.php, object-cache.php, etc.) go inside wp-content/
  if (prefix === '.') return 'wp-content/' + name;

  // Everything else (plugins/, themes/, uploads/, languages/, etc.) goes inside wp-content/
  const subPath = prefix.replace(/\\/g, '/');
  return 'wp-content/' + subPath + '/' + name;
}

async function convertWpressToZip(wpressPath, zipPath) {
  const fd = fs.openSync(wpressPath, 'r');
  const stats = fs.fstatSync(fd);
  const totalSize = stats.size;

  const output = fs.createWriteStream(zipPath);
  const archive = archiver('zip', { zlib: { level: 1 } });

  const finishPromise = new Promise((resolve, reject) => {
    output.on('close', () => resolve());
    output.on('error', reject);
    archive.on('error', reject);
    archive.on('warning', (err) => {
      if (err.code !== 'ENOENT') reject(err);
    });
  });

  archive.pipe(output);

  const headerBuf = Buffer.alloc(HEADER_SIZE);
  let position = 0;
  let fileCount = 0;
  let skipped = 0;
  let lastProgressTime = Date.now();
  const CHUNK_SIZE = 4 * 1024 * 1024;

  console.log(`Muunnetaan: ${path.basename(wpressPath)}`);
  console.log(`Kohde: ${path.basename(zipPath)}`);
  console.log(`Lahdetiedoston koko: ${(totalSize / 1024 / 1024 / 1024).toFixed(2)} GB`);
  console.log('Rakenne: wp-content/ + database.sql (LocalWP-yhteensopiva)');
  console.log('---');

  while (position + HEADER_SIZE <= totalSize) {
    const bytesRead = fs.readSync(fd, headerBuf, 0, HEADER_SIZE, position);
    if (bytesRead < HEADER_SIZE) break;
    position += HEADER_SIZE;

    const header = parseHeader(headerBuf);
    if (!header.name) break;

    const zipEntryPath = getZipPath(header);

    if (header.size > 0) {
      if (zipEntryPath) {
        const stream = new PassThrough();
        archive.append(stream, {
          name: zipEntryPath,
          date: header.mtime ? new Date(header.mtime * 1000) : new Date()
        });

        let remaining = header.size;
        while (remaining > 0) {
          const toRead = Math.min(CHUNK_SIZE, remaining);
          const chunk = Buffer.alloc(toRead);
          fs.readSync(fd, chunk, 0, toRead, position);
          stream.write(chunk);
          position += toRead;
          remaining -= toRead;
        }
        stream.end();
        fileCount++;
      } else {
        position += header.size;
        skipped++;
      }
    } else if (header.name !== '.') {
      if (zipEntryPath) {
        archive.append(Buffer.alloc(0), {
          name: zipEntryPath,
          date: header.mtime ? new Date(header.mtime * 1000) : new Date()
        });
        fileCount++;
      } else {
        skipped++;
      }
    }

    const now = Date.now();
    if (now - lastProgressTime > 5000) {
      const progress = ((position / totalSize) * 100).toFixed(1);
      const processedGB = (position / 1024 / 1024 / 1024).toFixed(2);
      console.log(`Edistyminen: ${progress}% (${processedGB} GB) - ${fileCount} tiedostoa`);
      lastProgressTime = now;
    }
  }

  fs.closeSync(fd);

  console.log('---');
  console.log(`Viimeistellaan zip-tiedostoa (${fileCount} tiedostoa, ohitettu: ${skipped})...`);

  await archive.finalize();
  await finishPromise;

  const zipStats = fs.statSync(zipPath);
  const zipSizeGB = (zipStats.size / 1024 / 1024 / 1024).toFixed(2);
  console.log(`Valmis! Zip-tiedoston koko: ${zipSizeGB} GB`);
}

const wpressFile = process.argv[2];
const zipFile = process.argv[3];

if (!wpressFile || !zipFile) {
  console.log('Kaytto: node convert.js <input.wpress> <output.zip>');
  process.exit(1);
}

convertWpressToZip(wpressFile, zipFile).catch(err => {
  console.error('Virhe:', err.message);
  process.exit(1);
});
