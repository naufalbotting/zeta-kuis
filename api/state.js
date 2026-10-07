// Zeta Kuis - GET /api/state (Vercel serverless).
// Dipoll laptop + admin tiap 1 detik. Menerapkan juga pengaman hangus:
// bila timer habis dan laptop tidak mengirim, jawaban otomatis dianggap masuk.
const { muatState, simpanState, snapshot } = require('../lib/kuis');

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ pesan: 'Metode tidak didukung.' });
    return;
  }
  try {
    const state = await muatState();
    await simpanState(state);
    res.status(200).json(snapshot(state));
  } catch (e) {
    res.status(500).json({ pesan: 'Gagal membaca state. Periksa env Redis.' });
  }
};
