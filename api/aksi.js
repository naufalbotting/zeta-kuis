// Zeta Kuis - POST /api/aksi (Vercel serverless).
// Body: { aksi, ...data } dengan aksi salah satu dari:
// setup | mulai | jawab | nilai | lempar | next | rebutan | akhiri | reset
const { aksi } = require('../lib/kuis');

const DAFTAR = ['setup', 'mulai', 'jawab', 'nilai', 'lempar', 'next', 'rebutan', 'akhiri', 'reset'];

module.exports = async (req, res) => {
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
    res.status(500).json({ ok: false, pesan: 'Gagal memproses aksi. Periksa env Redis.' });
  }
};
