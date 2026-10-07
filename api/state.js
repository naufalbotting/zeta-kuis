// Zeta Kuis - GET /api/state (Vercel serverless).
// Dipoll laptop + admin tiap 1 detik. Menerapkan juga pengaman hangus:
// bila timer habis dan laptop tidak mengirim, jawaban otomatis dianggap masuk.
const { muatState, simpanState, snapshot } = require('../lib/kuis');
const { PESAN_REDIS } = require('../lib/kv');

function kepalaAntiCache(res) {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('CDN-Cache-Control', 'no-store');
  res.setHeader('Vercel-CDN-Cache-Control', 'no-store');
}

module.exports = async (req, res) => {
  kepalaAntiCache(res);
  if (req.method !== 'GET') {
    res.status(405).json({ pesan: 'Metode tidak didukung.' });
    return;
  }
  try {
    const state = await muatState();
    await simpanState(state);
    res.status(200).json(snapshot(state));
  } catch (e) {
    if (e && e.kode === 'NO_REDIS') {
      res.status(500).json({ pesan: PESAN_REDIS });
      return;
    }
    res.status(500).json({ pesan: 'Gagal membaca state. Periksa env Redis.' });
  }
};
