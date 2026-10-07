// Zeta Kuis - Uji alur permainan penuh via HTTP (butuh scripts/dev.js jalan).
// Jalankan: npm run dev  (terminal 1)  lalu  npm run uji  (terminal 2)
const DASAR = 'http://localhost:' + (process.env.PORT || 3000);

let gagal = 0;
function cek(nama, syarat, info) {
  if (syarat) {
    console.log('OK   ' + nama);
  } else {
    gagal++;
    console.log('GAGAL ' + nama + (info !== undefined ? ' -> ' + JSON.stringify(info) : ''));
  }
}

async function aksi(payload) {
  const r = await fetch(DASAR + '/api/aksi', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const j = await r.json();
  return { status: r.status, badan: j };
}

async function state() {
  const r = await fetch(DASAR + '/api/state');
  return await r.json();
}

(async () => {
  let s = await state();
  cek('awal IDLE', s.fase === 'IDLE', s.fase);

  let h = await aksi({ aksi: 'setup', timA: 'Sama', timB: 'sama', soal: ['Q'] });
  cek('nama kembar ditolak', h.status === 400 && h.badan.pesan, h.badan);

  h = await aksi({ aksi: 'setup', timA: 'Garuda', timB: 'Elang', soal: ['S1', 'S2', 'S3'], mode: 'KEDUA', urutan: 'POIN_DULU', jumlahBabakPertama: 2 });
  cek('setup KEDUA -> SOAL', h.badan.ok && h.badan.snap.fase === 'SOAL' && h.badan.snap.giliranTim === 'A', h.badan);

  h = await aksi({ aksi: 'mulai' });
  cek('mulai -> MENJAWAB', h.badan.snap.fase === 'MENJAWAB' && typeof h.badan.snap.sisaDetik === 'number', h.badan.snap);

  h = await aksi({ aksi: 'jawab', text: 'Jawaban A' });
  cek('jawab -> MENILAI', h.badan.snap.fase === 'MENILAI' && h.badan.snap.jawabanFinal === 'Jawaban A', h.badan.snap);

  h = await aksi({ aksi: 'nilai', hasil: 'BENAR' });
  cek('benar utama +10', h.badan.snap.fase === 'HASIL' && h.badan.snap.skorA === 10, h.badan.snap);

  h = await aksi({ aksi: 'next' });
  cek('next soal 2 giliran B', h.badan.snap.fase === 'SOAL' && h.badan.snap.nomorSoal === 2 && h.badan.snap.giliranTim === 'B', h.badan.snap);

  await aksi({ aksi: 'mulai' });
  await aksi({ aksi: 'jawab', text: 'Salah' });
  const t0 = Date.now();
  h = await aksi({ aksi: 'nilai', hasil: 'SALAH' });
  const jeda = Date.now() - t0;
  cek('salah utama -> LEMPAR (jeda Server ~1,5 dtk)', h.badan.snap.fase === 'MENJAWAB' && h.badan.snap.tahap === 'LEMPAR' && h.badan.snap.giliranTim === 'A' && jeda >= 1400, { snap: h.badan.snap, jedaMs: jeda });

  await aksi({ aksi: 'jawab', text: 'Benar lemparan' });
  h = await aksi({ aksi: 'nilai', hasil: 'BENAR' });
  cek('benar lemparan +5 untuk A', h.badan.snap.skorA === 15 && h.badan.snap.fase === 'HASIL', h.badan.snap);

  h = await aksi({ aksi: 'next' });
  cek('soal 3 babak REBUTAN, belum dipilih', h.badan.snap.babakAktif === 'REBUTAN' && h.badan.snap.rebutanDipilih === null, h.badan.snap);

  h = await aksi({ aksi: 'mulai' });
  cek('mulai rebutan tanpa pilih ditolak', h.status === 400, h.badan);

  h = await aksi({ aksi: 'rebutan', tim: 'B' });
  cek('rebutan pilih B', h.badan.ok && h.badan.snap.giliranTim === 'B', h.badan);

  await aksi({ aksi: 'mulai' });
  await aksi({ aksi: 'jawab', text: 'Ok' });
  h = await aksi({ aksi: 'nilai', hasil: 'BENAR' });
  cek('rebutan benar +10 untuk B', h.badan.snap.skorB === 10, h.badan.snap);

  h = await aksi({ aksi: 'akhiri', pemenang: 'B' });
  cek('akhiri -> PEMENANG B', h.badan.snap.fase === 'PEMENANG' && h.badan.snap.pemenang === 'B', h.badan.snap);

  h = await aksi({ aksi: 'reset' });
  cek('reset -> IDLE', h.badan.snap.fase === 'IDLE' && h.badan.snap.skorA === 0, h.badan.snap);

  // THROW_NOW: tim tidak menjawab.
  await aksi({ aksi: 'setup', timA: 'Garuda', timB: 'Elang', soal: ['Q1'] });
  h = await aksi({ aksi: 'lempar' });
  cek('lempar langsung -> MENJAWAB LEMPAR tim B', h.badan.snap.fase === 'MENJAWAB' && h.badan.snap.tahap === 'LEMPAR' && h.badan.snap.giliranTim === 'B', h.badan.snap);

  // Pengaman hangus: timer kedaluwarsa tanpa kiriman -> MENILAI.
  // (Uji unit in-process: memori KV dev-server dan penguji terpisah,
  // jadi logika kadaluarsa diuji langsung via lib, bukan via HTTP.)
  const lib = require('../lib/kuis');
  const kvm = require('../lib/kv');
  await kvm.tulis(lib.KUNCI, { fase: 'MENJAWAB', timerBerakhirPada: Date.now() - 60000, jawabanLive: 'abc' });
  const hangus = await lib.muatState();
  cek('hangus otomatis -> MENILAI + jawaban ikut', hangus.fase === 'MENILAI' && hangus.jawabanFinal === 'abc', { fase: hangus.fase, final: hangus.jawabanFinal });

  await aksi({ aksi: 'nilai', hasil: 'SALAH' });
  h = await aksi({ aksi: 'akhiri', pemenang: 'A' });
  cek('akhiri dari HASIL', h.badan.snap.fase === 'PEMENANG', h.badan.snap);
  await aksi({ aksi: 'reset' });
  s = await state();
  cek('bersih akhir IDLE', s.fase === 'IDLE', s.fase);

  // Halaman statis.
  const r1 = await fetch(DASAR + '/');
  const r2 = await fetch(DASAR + '/admin');
  cek('halaman / dan /admin 200', r1.status === 200 && r2.status === 200, [r1.status, r2.status]);

  if (gagal > 0) {
    console.log(gagal + ' UJI GAGAL');
    process.exit(1);
  }
  console.log('SEMUA UJI LULUS');
})().catch((e) => {
  console.log('GAGAL total: ' + (e && e.message));
  process.exit(1);
});
