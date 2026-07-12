// Minimal static file server for the mGBA-WASM spike.
// The core uses SharedArrayBuffer/pthreads, which requires the page to be
// served cross-origin-isolated (COOP/COEP). That's the only reason this
// exists instead of `npx serve` or `python -m http.server`.
//
// Usage: node server.mjs [port]   (default port 8177)
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('.', import.meta.url));
const PORT = Number(process.argv[2]) || 8177;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.wasm': 'application/wasm',
  '.gba': 'application/octet-stream',
  '.ts': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8'
};

const server = createServer(async (req, res) => {
  try {
    const urlPath = decodeURIComponent(req.url.split('?')[0]);
    const safePath = normalize(urlPath).replace(/^(\.\.[/\\])+/, '');
    const filePath = join(ROOT, safePath === '/' ? 'index.html' : safePath);

    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('forbidden');
      return;
    }

    const s = await stat(filePath);
    const finalPath = s.isDirectory() ? join(filePath, 'index.html') : filePath;
    const body = await readFile(finalPath);

    res.writeHead(200, {
      'Content-Type': MIME[extname(finalPath)] || 'application/octet-stream',
      'Content-Length': body.length,
      // Required for SharedArrayBuffer / threaded WASM:
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': 'no-cache'
    });
    res.end(body);
  } catch (err) {
    res.writeHead(404).end('not found: ' + err.message);
  }
});

server.listen(PORT, () => {
  console.log(`gba-studio emulator spike: http://localhost:${PORT}/`);
});
