// Zeta Kuis - POST /api/aksi (Vercel serverless).
// Body: { aksi, ...data } dengan aksi salah satu dari:
// setup | jawab | hint | next | akhiri | reset
const { aksi } = require('../lib/kuis');
const { PESAN_REDIS } = require('../lib/kv');

const DAFTAR = ['setup', 'jawab', 'hint', 'next', 'akhiri', 'reset'];

function kepalaAntiCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
}

module.exports = async (req, res) => {
  kepalaAntiCache(res);
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false, pesan: 'Metode tidak didukung.' });
    return;
  }
  const nama = req.body && req.body.aksi;
  if (!nama || DAFTAR.indexOf(nama) === -1) {
    res.status(400).json({ ok: false, pesan: 'Aksi tidak dikenal.' });
    return;
  }
  try {
    const hasil = await aksi[nama](req.body || {});
    if (hasil.pesan) {
      res.status(400).json({ ok: false, pesan: hasil.pesan });
      return;
    }
    res.status(200).json({ ok: true, snap: hasil.snap });
  } catch (e) {
    if (e && e.kode === 'NO_REDIS') {
      res.status(500).json({ ok: false, pesan: PESAN_REDIS });
      return;
    }
    res.status(500).json({ ok: false, pesan: 'Gagal memproses aksi. Periksa env Redis.' });
  }
};
