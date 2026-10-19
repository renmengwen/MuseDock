const fs = require('node:fs/promises');

async function audioResponseType(file, artifact) {
  const mime = artifact.mime || 'application/octet-stream';
  if (artifact.kind !== 'provider_audio' || mime !== 'application/octet-stream') return { mime, extension: '' };
  const handle = await fs.open(file, 'r');
  try {
    const header = Buffer.alloc(16);
    const { bytesRead } = await handle.read(header, 0, header.length, 0);
    if (bytesRead >= 12 && header.toString('ascii', 0, 4) === 'RIFF' && header.toString('ascii', 8, 12) === 'WAVE') return { mime: 'audio/wav', extension: '.wav' };
    if (bytesRead >= 4 && header.toString('ascii', 0, 4) === 'fLaC') return { mime: 'audio/flac', extension: '.flac' };
    if (bytesRead >= 3 && header.toString('ascii', 0, 3) === 'ID3') return { mime: 'audio/mpeg', extension: '.mp3' };
    return { mime, extension: '' };
  } finally { await handle.close(); }
}
module.exports = { audioResponseType };
