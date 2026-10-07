// Zeta Kuis - Logika layar laptop MCQ (Vercel: REST + polling).
// Admin membacakan soal (tidak tampil di sini). Tim memilih A/B/C/D via klik
// mouse atau keyboard, lalu animasi tegang 3 detik otomatis, lalu hasil.
// Client hanya merender dan memanggil /api/aksi; koreksi otomatis di server.
// Poll adaptif: cepat saat permainan aktif, lambat saat idle.
const POLL_CEPAT_MS = 400;
const POLL_LAMBAT_MS = 1500;

let fase = 'IDLE';
let config = {
  DETIK_MENJAWAB: 10,
  POIN_BENAR: 10,
  POIN_BENAR_HINT: 5,
  TEGANG_MS: 3000,
  MIN_SOAL: 1,
  MAKS_KARAKTER_SOAL: 300,
  MAKS_KARAKTER_OPSI: 120,
  MAKS_KARAKTER_NAMA_TIM: 20,
  DURASI_FLASH_MS: 800
};

let timA = '';
let timB = '';
let skorA = 0;
let skorB = 0;
let nomorSoal = 0;
let totalSoal = 0;
let opsi = null;             // {A,B,C,D} teks opsi soal aktif
let opsiDibuang = [];
let giliranTim = 'A';
let namaGiliran = '';
let pilihan = null;          // pilihan yang dikunci server
let hasilTerakhir = null;
let poinTerakhir = 0;
let hintDipakai = false;
let terkunciLokal = false;   // saya sudah mengunci (optimistis)
let menegangkan = false;     // animasi tegang 3 detik sedang jalan
let faseSebelum = 'IDLE';

// Timer lokal berbasis requestAnimationFrame.
let rafId = null;
let timerTotal = 0;
let timerBerakhir = 0;

const $ = (id) => document.getElementById(id);
const titikKoneksi = $('titik-koneksi');
const overlaySuara = $('overlay-suara');
const flashEl = $('flash');
const cahayaEl = $('cahaya');
const tombolOpsi = Array.from(document.querySelectorAll('#daftar-opsi .opsi'));

AudioManager.init();

function terapkanConfig(c) {
  if (!c) return;
  config = Object.assign(config, c);
}

function tampilkan(idAktif) {
  const daftar = ['tampilan-idle', 'tampilan-soal', 'tampilan-tegang', 'tampilan-hasil', 'tampilan-pemenang'];
  for (const id of daftar) {
    $(id).classList.toggle('aktif', id === idAktif);
  }
  document.body.classList.toggle('game-jalan', fase !== 'IDLE');
}

function perbaruiBrand() {
  $('brand-babak').textContent = (fase === 'IDLE' || fase === 'PEMENANG' || !totalSoal) ? '' : ('SOAL ' + nomorSoal + '/' + totalSoal);
}

// Cahaya putih mengikuti kursor (UX memilih opsi).
document.addEventListener('mousemove', (e) => {
  cahayaEl.style.transform = 'translate(' + e.clientX + 'px,' + e.clientY + 'px)';
});

// Aturan main: 3 kartu pendek.
function renderPeraturan() {
  const wadah = $('kartu-aturan');
  wadah.textContent = '';
  const kartu = [
    {
      judul: 'CARA MAIN',
      isi: [
        'Juri membacakan soal. Layar hanya menampilkan opsi A–D.',
        'Giliran bergantian: Soal 1 Tim A, Soal 2 Tim B, dst.',
        'Klik opsi / tekan tombol A B C D dalam ' + config.DETIK_MENJAWAB + ' detik.'
      ]
    },
    {
      judul: 'NILAI',
      isi: [
        'Benar +' + config.POIN_BENAR + ' poin. Salah / waktu habis = 0.',
        'Benar setelah hint hanya +' + config.POIN_BENAR_HINT + ' poin.',
        'Tidak ada lemparan. Skor tertinggi menang.'
      ]
    },
    {
      judul: 'HINT & ETIKA',
      isi: [
        'Juri boleh membuang 1 opsi salah (1x per soal).',
        'Bukan giliran dilarang bersuara. Tanpa HP/buku.',
        'Keputusan juri mutlak.'
      ]
    }
  ];
  for (const k of kartu) {
    const div = document.createElement('div');
    div.className = 'kartu-aturan';
    const h = document.createElement('h3');
    h.textContent = k.judul;
    div.appendChild(h);
    const ol = document.createElement('ol');
    for (const baris of k.isi) {
      const li = document.createElement('li');
      li.textContent = baris;
      ol.appendChild(li);
    }
    div.appendChild(ol);
    wadah.appendChild(div);
  }
}

function renderSkor(namaAel, angkaAel, namaBel, angkaBel) {
  $(namaAel).textContent = timA;
  $(angkaAel).textContent = String(skorA);
  $(namaBel).textContent = timB;
  $(angkaBel).textContent = String(skorB);
  $(namaAel).classList.toggle('giliran', giliranTim === 'A');
  $(namaBel).classList.toggle('giliran', giliranTim === 'B');
}

function renderOpsi() {
  for (const btn of tombolOpsi) {
    const huruf = btn.getAttribute('data-huruf');
    btn.querySelector('.teks').textContent = opsi ? opsi[huruf] : '';
    btn.classList.toggle('dibuang', opsiDibuang.indexOf(huruf) !== -1);
    btn.classList.toggle('terpilih', pilihan === huruf);
    btn.classList.remove('benar-opt', 'salah-opt');
    btn.disabled = terkunciLokal || opsiDibuang.indexOf(huruf) !== -1;
  }
}

function renderSoal() {
  $('nomor-soal').textContent = 'SOAL ' + nomorSoal + ' / ' + totalSoal;
  $('giliran').textContent = 'GILIRAN: ' + namaGiliran;
  renderOpsi();
  renderSkor('skor-nama-a', 'skor-angka-a', 'skor-nama-b', 'skor-angka-b');
}

function hentikanTimer() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

function mulaiTimerLokalDariSisa(sisa, total) {
  hentikanTimer();
  timerTotal = total;
  timerBerakhir = performance.now() + Math.max(0, sisa) * 1000;
  const isiBar = $('isi-bar');
  const angka = $('angka-detik');
  function bingkai() {
    const sisaMs = Math.max(0, timerBerakhir - performance.now());
    const s = sisaMs / 1000;
    isiBar.style.width = ((s / timerTotal) * 100).toFixed(2) + '%';
    angka.textContent = String(Math.ceil(s));
    angka.classList.toggle('mendesak', s <= 3.05 && s > 0);
    if (sisaMs <= 0) {
      hentikanTimer();
      kunciJawaban(null); // waktu habis = salah otomatis
      return;
    }
    rafId = requestAnimationFrame(bingkai);
  }
  rafId = requestAnimationFrame(bingkai);
}

async function panggilAksi(payload) {
  try {
    const r = await fetch('/api/aksi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.ok !== true || !j.snap) return null;
    terapkanSnapshot(j.snap);
    return j.snap;
  } catch (e) {
    return null;
  }
}

// Kunci pilihan via klik / keyboard. null = waktu habis.
function kunciJawaban(huruf) {
  if (fase !== 'SOAL' || terkunciLokal || menegangkan) return;
  if (huruf !== null) {
    if (opsiDibuang.indexOf(huruf) !== -1) return;
    terkunciLokal = true;
    renderOpsi();
  }
  // Optimistis: langsung tegang + drumroll tanpa menunggu server.
  menegangkan = true;
  hentikanTimer();
  AudioManager.stopAll();
  tampilkan('tampilan-tegang');
  $('pilihan-terkunci').textContent = huruf
    ? namaGiliran + ' memilih ' + huruf
    : 'Waktu habis — tidak ada jawaban';
  AudioManager.play('drumroll');
  jadwalUngkap(config.TEGANG_MS);
  panggilAksi({ aksi: 'jawab', pilihan: huruf });
}

// Penjadwalan ungkap hasil: hanya sekali per soal.
let ungkapTerjadwal = false;
function jadwalUngkap(ms) {
  if (ungkapTerjadwal) return;
  ungkapTerjadwal = true;
  setTimeout(() => {
    ungkapTerjadwal = false;
    ungkapHasil();
  }, ms);
}

// Animasi tegang otomatis TEGANG_MS, lalu ungkap hasil dari snapshot terakhir.
let snapTegang = null;

function ungkapHasil() {
  const s = snapTegang;
  if (!s || !s.hasilTerakhir) {
    if (fase === 'HASIL') jadwalUngkap(1000); // data belum datang: tunggu poll berikut
    return;
  }
  menegangkan = false;
  if (!s || s.fase !== 'HASIL') return; // poll berikutnya akan menangani
  AudioManager.stopAll();
  if (s.hasilTerakhir === 'BENAR') {
    AudioManager.play('correct');
    kedip('#22c55e');
    tampilHasilBenar(s);
  } else {
    AudioManager.play('wrong');
    kedip('#ef4444');
    tampilHasilSalah(s);
  }
}

function kedip(warna) {
  flashEl.style.background = warna;
  const durasi = config.DURASI_FLASH_MS;
  const awal = performance.now();
  function bingkai() {
    const x = (performance.now() - awal) / durasi;
    if (x >= 1) { flashEl.style.opacity = '0'; return; }
    const op = x < 0.5 ? (x / 0.5) * 0.85 : 0.85 * (1 - (x - 0.5) / 0.5);
    flashEl.style.opacity = String(op);
    requestAnimationFrame(bingkai);
  }
  requestAnimationFrame(bingkai);
}

function gambarHasilOpsi(s) {
  const wadah = $('hasil-opsi');
  wadah.textContent = '';
  if (!s.opsi) return;
  for (const huruf of ['A', 'B', 'C', 'D']) {
    const div = document.createElement('div');
    div.className = 'opsi mini';
    if (huruf === s.kunciTampil) div.classList.add('benar-opt');
    if (huruf === s.pilihan && s.pilihan !== s.kunciTampil) div.classList.add('salah-opt');
    if (s.opsiDibuang.indexOf(huruf) !== -1) div.classList.add('dibuang');
    const badge = document.createElement('span');
    badge.className = 'huruf';
    badge.textContent = huruf;
    const teks = document.createElement('span');
    teks.className = 'teks';
    teks.textContent = s.opsi[huruf];
    div.appendChild(badge);
    div.appendChild(teks);
    wadah.appendChild(div);
  }
}

function tampilHasilBenar(s) {
  const el = $('teks-hasil');
  el.textContent = 'BENAR!';
  el.className = '';
  el.classList.add('benar');
  $('detail-hasil').textContent = '+' + s.poinTerakhir + ' poin untuk ' + (s.giliranTim === 'A' ? s.timA : s.timB);
  gambarHasilOpsi(s);
  renderSkor('hasil-nama-a', 'hasil-angka-a', 'hasil-nama-b', 'hasil-angka-b');
  tampilkan('tampilan-hasil');
}

function tampilHasilSalah(s) {
  const el = $('teks-hasil');
  el.textContent = s.pilihan ? 'SALAH!' : 'WAKTU HABIS!';
  el.className = '';
  el.classList.add('salah');
  $('detail-hasil').textContent = 'Tidak ada poin untuk soal ini';
  gambarHasilOpsi(s);
  renderSkor('hasil-nama-a', 'hasil-angka-a', 'hasil-nama-b', 'hasil-angka-b');
  tampilkan('tampilan-hasil');
}

// Slot machine deterministik: selalu berhenti di winnerIdx.
function putarNama(winnerIdx, nama, el, selesai) {
  const N = 36;           // jumlah langkah
  let i = 0;
  (function langkah() {
    const idx = (winnerIdx + (N - 1 - i)) % 2; // bergantian A/B, langkah terakhir pasti = winnerIdx
    el.textContent = nama[idx];
    el.classList.remove('slot-in'); void el.offsetWidth; el.classList.add('slot-in'); // animasi geser vertikal singkat
    if (i === N - 1) return selesai();
    const x = i / (N - 1);
    const jeda = 50 + 330 * x * x * x;       // ease-out: 50ms (cepat) -> 380ms (lambat)
    i++;
    setTimeout(langkah, jeda);
  })();
}

function tembakKonfeti(durasiMs = 6000) {
  const akhir = Date.now() + durasiMs;
  const warna = ['#ff0040', '#ffd700', '#00e5ff', '#7cff00', '#ff00ff', '#ff8c00'];
  confetti({ particleCount: 150, angle: 60,  spread: 80, startVelocity: 70, origin: { x: 0, y: 1 }, colors: warna });
  confetti({ particleCount: 150, angle: 120, spread: 80, startVelocity: 65, origin: { x: 1, y: 1 }, colors: warna });
  (function frame() {
    confetti({ particleCount: 6, angle: 60,  spread: 70, startVelocity: 65, origin: { x: 0, y: 1 }, colors: warna });
    confetti({ particleCount: 6, angle: 120, spread: 70, startVelocity: 65, origin: { x: 1, y: 1 }, colors: warna });
    if (Date.now() < akhir) requestAnimationFrame(frame);
  })();
}

function jalankanWinner(pemenang, aTimA, aTimB, aSkorA, aSkorB) {
  fase = 'PEMENANG';
  hentikanTimer();
  AudioManager.stopAll();
  perbaruiBrand();
  tampilkan('tampilan-pemenang');
  const kicker = $('pemenang-kicker');
  const namaEl = $('nama-pemenang');
  const skorEl = $('skor-akhir');
  kicker.classList.remove('muncul');
  namaEl.textContent = '';
  namaEl.classList.remove('menang');
  skorEl.textContent = '';
  // 0 dtk: hitam total (sudah via tampilan pemenang berlatar hitam).
  setTimeout(() => {
    kicker.classList.add('muncul');
  }, 800);
  setTimeout(() => {
    AudioManager.play('roulette');
    const winnerIdx = pemenang === 'A' ? 0 : 1;
    putarNama(winnerIdx, [aTimA, aTimB], namaEl, () => {
      AudioManager.stopAll();
      AudioManager.play('fanfare');
      namaEl.classList.add('menang');
      skorEl.textContent = aTimA + ' ' + aSkorA + ' — ' + aSkorB + ' ' + aTimB;
      tembakKonfeti(6000);
    });
  }, 3300);
}

// Antrean kejadian dari server: tiap rev baru dimainkan sekali.
let revTerakhir = -1;

function prosesPeristiwa(s) {
  const rev = typeof s.rev === 'number' ? s.rev : 0;
  const daftar = Array.isArray(s.antrean) ? s.antrean.slice().sort((a, b) => a.rev - b.rev) : [];
  if (revTerakhir === -1) { revTerakhir = rev; return false; }
  if (rev < revTerakhir) { revTerakhir = rev; return false; } // epoch baru (reset)
  let selesai = false;
  for (const ev of daftar) {
    if (!ev || typeof ev.rev !== 'number' || ev.rev <= revTerakhir) continue;
    revTerakhir = ev.rev;
    if (mainkanPeristiwa(ev)) selesai = true;
  }
  return selesai;
}

function mainkanPeristiwa(ev) {
  switch (ev.jenis) {
    case 'SOAL_BARU':
      AudioManager.play('start');
      break;
    case 'HINT':
      AudioManager.play('start');
      break;
    case 'KUNCI_JAWABAN':
      // Suspense + drumroll sudah dimulai optimistis oleh pengunci.
      if (!terkunciLokal && !menegangkan) {
        AudioManager.stopAll();
        AudioManager.play('drumroll');
      }
      break;
    case 'BENAR_MCQ':
      // Diungkap setelah animasi tegang (lihat ungkapHasil).
      break;
    case 'SALAH_MCQ':
      break;
    case 'SELESAI':
      if (fase === 'PEMENANG') {
        jalankanWinner(ev.pemenang, timA, timB, skorA, skorB);
        return true;
      }
      break;
  }
  return false;
}

// Terapkan snapshot dari server.
function terapkanSnapshot(s) {
  if (!s || typeof s.fase !== 'string') return;
  terapkanConfig(s.config);
  const lama = faseSebelum;
  faseSebelum = s.fase;

  fase = s.fase;
  timA = s.timA; timB = s.timB;
  skorA = s.skorA; skorB = s.skorB;
  nomorSoal = s.nomorSoal; totalSoal = s.totalSoal;
  opsi = s.opsi;
  opsiDibuang = s.opsiDibuang || [];
  giliranTim = s.giliranTim; namaGiliran = s.namaGiliran;
  pilihan = s.pilihan;
  hasilTerakhir = s.hasilTerakhir;
  poinTerakhir = s.poinTerakhir;
  hintDipakai = !!s.hintDipakai;
  // Kunci untuk mengungkap hasil (hanya dipakai di tampilan hasil, tak dirender saat menjawab).
  kunciTampil = s.kunci;
  perbaruiBrand();

  if (s.fase === 'IDLE') {
    terkunciLokal = false;
    menegangkan = false;
    snapTegang = null;
    hentikanTimer();
    AudioManager.stopAll();
    renderPeraturan();
    tampilkan('tampilan-idle');
    if (!AudioManager.aktif) overlaySuara.classList.remove('sembunyi');
    else overlaySuara.classList.add('sembunyi');
    prosesPeristiwa(s);
    return;
  }
  overlaySuara.classList.add('sembunyi');

  if (s.fase === 'SOAL') {
    if (lama !== 'SOAL') {
      terkunciLokal = false;
      menegangkan = false;
      snapTegang = null;
      hentikanTimer();
      renderSoal();
      tampilkan('tampilan-soal');
      const total = config.DETIK_MENJAWAB;
      const sisa = typeof s.sisaDetik === 'number' ? s.sisaDetik : total;
      mulaiTimerLokalDariSisa(sisa, total);
      AudioManager.play('tick');
    } else {
      renderOpsi(); // hint baru / refresh: perbarui status opsi tanpa reset timer
    }
    prosesPeristiwa(s);
    return;
  }

  if (s.fase === 'HASIL') {
    hentikanTimer();
    snapTegang = {
      pilihan: s.pilihan,
      giliranTim: s.giliranTim,
      timA: s.timA, timB: s.timB,
      hasilTerakhir: s.hasilTerakhir,
      poinTerakhir: s.poinTerakhir,
      opsi: s.opsi,
      opsiDibuang: s.opsiDibuang || [],
      kunciTampil: s.kunci
    };
    const sinkronBaru = (revTerakhir === -1);
    prosesPeristiwa(s);
    if (sinkronBaru) {
      // Refresh di tengah HASIL: langsung ungkap tanpa tegang ulang.
      menegangkan = false;
      ungkapHasilLangsung(snapTegang);
    } else if (!menegangkan) {
      menegangkan = true;
      tampilkan('tampilan-tegang');
      $('pilihan-terkunci').textContent = s.pilihan
        ? (s.giliranTim === 'A' ? s.timA : s.timB) + ' memilih ' + s.pilihan
        : 'Waktu habis — tidak ada jawaban';
      AudioManager.stopAll();
      AudioManager.play('drumroll');
      jadwalUngkap(config.TEGANG_MS);
    }
    return;
  }

  if (s.fase === 'PEMENANG') {
    menegangkan = false;
    const animasiJalan = prosesPeristiwa(s);
    if (!animasiJalan) {
      tampilkan('tampilan-pemenang');
      $('pemenang-kicker').classList.add('muncul');
      const namaEl = $('nama-pemenang');
      if (!namaEl.classList.contains('menang')) {
        namaEl.textContent = s.pemenang === 'A' ? timA : timB;
        namaEl.classList.add('menang');
      }
      $('skor-akhir').textContent = timA + ' ' + skorA + ' — ' + skorB + ' ' + timB;
    }
  }
}

function ungkapHasilLangsung(s) {
  AudioManager.stopAll();
  if (s.hasilTerakhir === 'BENAR') {
    AudioManager.play('correct');
    kedip('#22c55e');
    tampilHasilBenar(s);
  } else {
    AudioManager.play('wrong');
    kedip('#ef4444');
    tampilHasilSalah(s);
  }
}

let pollJalan = false;
async function pollSekali() {
  if (pollJalan) return;
  pollJalan = true;
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    if (!r.ok) throw new Error('state ' + r.status);
    const s = await r.json();
    titikKoneksi.classList.add('hidup');
    terapkanSnapshot(s);
  } catch (e) {
    titikKoneksi.classList.remove('hidup');
  } finally {
    pollJalan = false;
  }
}

// Klik mouse pada opsi.
for (const btn of tombolOpsi) {
  btn.addEventListener('click', () => {
    kunciJawaban(btn.getAttribute('data-huruf'));
  });
}

// Keyboard A/B/C/D (huruf besar/kecil).
document.addEventListener('keydown', (e) => {
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  const h = String(e.key || '').toUpperCase();
  if (h !== 'A' && h !== 'B' && h !== 'C' && h !== 'D') return;
  if (fase !== 'SOAL' || terkunciLokal || menegangkan) return;
  e.preventDefault();
  kunciJawaban(h);
});

// Aktivasi suara: klik pertama.
function aktivasiSuara() {
  if (AudioManager.aktif) {
    overlaySuara.classList.add('sembunyi');
    return;
  }
  AudioManager.unlock().then(() => {
    overlaySuara.classList.add('sembunyi');
  }).catch(() => {
    overlaySuara.classList.add('sembunyi');
  });
}
document.addEventListener('pointerdown', aktivasiSuara);
document.addEventListener('keydown', aktivasiSuara);

renderPeraturan();
perbaruiBrand();
tampilkan('tampilan-idle');
pollSekali();
(function jadwalPoll() {
  setTimeout(async () => {
    await pollSekali();
    jadwalPoll();
  }, (fase === 'SOAL') ? POLL_CEPAT_MS : POLL_LAMBAT_MS);
})();
