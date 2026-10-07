// Zeta Kuis - Server lokal untuk uji coba (BUKAN untuk produksi).
// Produksi memakai Vercel (api/*.js + Upstash Redis).
// Jalankan: npm run dev  -> buka http://localhost:3000/ dan /admin
// Tanpa dependensi tambahan (http bawaan Node).
const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = Number(process.env.PORT) || 3000;
const DIR_PUBLIC = path.join(__dirname, '..', 'public');

const stateHandler = require('../api/state');
const aksiHandler = require('../api/aksi');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.ico': 'image/x-icon',
  '.mp3': 'audio/mpeg',
  '.woff2': 'font/woff2',
  '.json': 'application/json; charset=utf-8',
};

function buatRes(native) {
  return {
    statusCode: 200,
    _kepala: {},
    status(kode) { this.statusCode = kode; return this; },
    json(objek) {
      const badan = JSON.stringify(objek);
      native.writeHead(this.statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
      native.end(badan);
    },
  };
}

function layaniStatis(urlPath, res) {
  let rel = urlPath === '/' ? '/laptop.html' : urlPath === '/admin' ? '/admin.html' : urlPath;
  rel = decodeURIComponent(rel.split('?')[0]);
  const aman = path.normalize(rel).replace(/^(\.\.[/\\])+/, '');
  const lokasi = path.join(DIR_PUBLIC, aman);
  if (!lokasi.startsWith(DIR_PUBLIC)) {
    res.writeHead(403); res.end('Dilarang');
    return;
  }
  fs.readFile(lokasi, (err, data) => {
    if (err) {
      res.writeHead(404); res.end('Tidak ditemukan');
      return;
    }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(lokasi)] || 'application/octet-stream' });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  if (req.url === '/api/state' && req.method === 'GET') {
    stateHandler(req, buatRes(res)).catch(() => {
      res.writeHead(500); res.end('{"pesan":"Galat"}');
    });
    return;
  }
  if (req.url === '/api/aksi' && req.method === 'POST') {
    let badan = '';
    req.on('data', (potong) => { badan += potong; });
    req.on('end', () => {
      try {
        req.body = badan ? JSON.parse(badan) : {};
      } catch (e) {
        res.writeHead(400); res.end('{"ok":false,"pesan":"Body bukan JSON."}');
        return;
      }
      aksiHandler(req, buatRes(res)).catch(() => {
        res.writeHead(500); res.end('{"ok":false,"pesan":"Galat"}');
      });
    });
    return;
  }
  if (req.url.startsWith('/api/')) {
    res.writeHead(404); res.end('{"pesan":"Tidak ditemukan"}');
    return;
  }
  layaniStatis(req.url, res);
});

server.listen(PORT, () => {
  console.log('Zeta Kuis (mode uji lokal) jalan di http://localhost:' + PORT + '/');
  console.log('Laptop: http://localhost:' + PORT + '/   Admin: http://localhost:' + PORT + '/admin');
});
