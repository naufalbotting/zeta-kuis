// Zeta Kuis MCQ - Uji alur permainan penuh via HTTP (butuh scripts/dev.js jalan).
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

function buatSoal(n, kunciKe) {
  const daftar = [];
  const hurufs = ['A', 'B', 'C', 'D'];
  for (let i = 0; i < n; i++) {
    daftar.push({
      tanya: 'Pertanyaan ' + (i + 1),
      opsi: { A: 'Opsi A-' + i, B: 'Opsi B-' + i, C: 'Opsi C-' + i, D: 'Opsi D-' + i },
      kunci: hurufs[(i + kunciKe) % 4],
    });
  }
  return daftar;
}

(async () => {
  let s = await state();
  cek('awal IDLE', s.fase === 'IDLE', s.fase);

  let h = await aksi({ aksi: 'setup', timA: 'Sama', timB: 'sama', soal: buatSoal(1, 0) });
  cek('nama kembar ditolak', h.status === 400 && h.badan.pesan, h.badan);

  h = await aksi({ aksi: 'setup', timA: 'Garuda', timB: 'Elang', soal: [{ tanya: 'Q', opsi: { A: 'a', B: '', C: 'c', D: 'd' }, kunci: 'A' }] });
  cek('opsi kosong ditolak', h.status === 400, h.badan);

  h = await aksi({ aksi: 'setup', timA: 'Garuda', timB: 'Elang', soal: [{ tanya: 'Q', opsi: { A: 'a', B: 'b', C: 'c', D: 'd' }, kunci: 'E' }] });
  cek('kunci invalid ditolak', h.status === 400, h.badan);

  // 12 soal: tanpa batas jumlah (dulu maks 10).
  h = await aksi({ aksi: 'setup', timA: 'Garuda', timB: 'Elang', soal: buatSoal(12, 0) });
  cek('setup 12 soal -> SOAL giliran A', h.badan.ok && h.badan.snap.fase === 'SOAL' && h.badan.snap.totalSoal === 12 && h.badan.snap.giliranTim === 'A', h.badan);
  cek('snapshot bawa opsi+tanya+kunci', h.badan.snap.opsi && h.badan.snap.opsi.A === 'Opsi A-0' && h.badan.snap.tanya === 'Pertanyaan 1' && h.badan.snap.kunci === 'A', h.badan.snap);
  cek('setup catat SOAL_BARU', h.badan.snap.antrean.some((e) => e.jenis === 'SOAL_BARU'), h.badan.snap.antrean);

  // Soal 1 kunci A. Jawab B (salah).
  h = await aksi({ aksi: 'jawab', pilihan: 'B' });
  cek('salah -> HASIL 0 poin', h.badan.snap.fase === 'HASIL' && h.badan.snap.hasilTerakhir === 'SALAH' && h.badan.snap.skorA === 0, h.badan.snap);
  cek('catat KUNCI + SALAH_MCQ', h.badan.snap.antrean.some((e) => e.jenis === 'KUNCI_JAWABAN') && h.badan.snap.antrean.some((e) => e.jenis === 'SALAH_MCQ'), h.badan.snap.antrean);

  h = await aksi({ aksi: 'next' });
  cek('next soal 2 giliran B', h.badan.snap.fase === 'SOAL' && h.badan.snap.nomorSoal === 2 && h.badan.snap.giliranTim === 'B', h.badan.snap);

  // Soal 2 kunci B. Hint kunci ditolak dulu, lalu hint C valid, lalu hint kedua ditolak.
  h = await aksi({ aksi: 'hint', buang: 'B' });
  cek('hint kunci ditolak', h.status === 400, h.badan);
  h = await aksi({ aksi: 'hint', buang: 'C' });
  cek('hint C ok', h.badan.ok && h.badan.snap.opsiDibuang.join() === 'C' && h.badan.snap.hintDipakai, h.badan.snap);
  h = await aksi({ aksi: 'hint', buang: 'D' });
  cek('hint kedua ditolak', h.status === 400, h.badan);
  h = await aksi({ aksi: 'jawab', pilihan: 'C' });
  cek('jawab opsi dibuang ditolak', h.status === 400, h.badan);
  h = await aksi({ aksi: 'jawab', pilihan: 'B' });
  cek('benar setelah hint +5 untuk B', h.badan.snap.fase === 'HASIL' && h.badan.snap.skorB === 5 && h.badan.snap.poinTerakhir === 5, h.badan.snap);

  h = await aksi({ aksi: 'next' });
  cek('next soal 3 giliran A', h.badan.snap.nomorSoal === 3 && h.badan.snap.giliranTim === 'A', h.badan.snap);

  // Soal 3 kunci C. Jawab benar tanpa hint -> +10.
  h = await aksi({ aksi: 'jawab', pilihan: 'C' });
  cek('benar tanpa hint +10', h.badan.snap.skorA === 10 && h.badan.snap.poinTerakhir === 10, h.badan.snap);

  h = await aksi({ aksi: 'akhiri', pemenang: 'A' });
  cek('akhiri -> PEMENANG A', h.badan.snap.fase === 'PEMENANG' && h.badan.snap.pemenang === 'A', h.badan.snap);
  cek('catat SELESAI', h.badan.snap.antrean.some((e) => e.jenis === 'SELESAI'), h.badan.snap.antrean);

  h = await aksi({ aksi: 'reset' });
  cek('reset -> IDLE', h.badan.snap.fase === 'IDLE' && h.badan.snap.skorA === 0, h.badan.snap);

  // Timeout: jawab null = waktu habis.
  await aksi({ aksi: 'setup', timA: 'Garuda', timB: 'Elang', soal: buatSoal(1, 2) });
  h = await aksi({ aksi: 'jawab', pilihan: null });
  cek('timeout -> HASIL SALAH', h.badan.snap.fase === 'HASIL' && h.badan.snap.hasilTerakhir === 'SALAH' && h.badan.snap.pilihan === null, h.badan.snap);
  await aksi({ aksi: 'akhiri', pemenang: 'B' });
  await aksi({ aksi: 'reset' });

  // Pengaman hangus via lib (memori KV dev-server dan penguji terpisah).
  const lib = require('../lib/kuis');
  const kvm = require('../lib/kv');
  await kvm.tulis(lib.KUNCI, {
    fase: 'SOAL',
    soalAktif: 0,
    daftarSoal: [{ tanya: 'Q', opsi: { A: 'a', B: 'b', C: 'c', D: 'd' }, kunci: 'A' }],
    giliranTim: 'A',
    timerBerakhirPada: Date.now() - 60000,
  });
  const hangus = await lib.muatState();
  cek('hangus otomatis -> HASIL SALAH', hangus.fase === 'HASIL' && hangus.hasilTerakhir === 'SALAH', { fase: hangus.fase });

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
