// Zeta Kuis - Logika layar laptop (mode Vercel: REST + polling, tanpa Socket.IO).
// Live-typing antar layar dibuang sesuai keputusan: jawaban terkirim saat ENTER.
// Client hanya merender dan memanggil /api/aksi; state resmi di server (Redis).
const INTERVAL_POLL_MS = 1000;

let fase = 'IDLE';
let tahap = 'UTAMA';
let config = {
  DETIK_MENJAWAB: 10,
  DETIK_LEMPAR: 15,
  POIN_BENAR: 10,
  POIN_BENAR_LEMPAR: 5,
  TAMPILKAN_SOAL_SAAT_LEMPAR: true,
  MIN_SOAL: 1,
  MAKS_SOAL: 10,
  MAKS_KARAKTER_SOAL: 300,
  MAKS_KARAKTER_JAWABAN: 100,
  MAKS_KARAKTER_NAMA_TIM: 20,
  DURASI_FLASH_MS: 800
};

let timA = '';
let timB = '';
let skorA = 0;
let skorB = 0;
let nomorSoal = 0;
let totalSoal = 0;
let teksSoal = '';
let giliranTim = 'A';
let namaGiliran = '';
let babakAktif = 'POIN';
let rebutanDipilih = null;
let sudahKirim = false;
let faseSebelum = 'IDLE';
let rebutanTerakhir = '##';

// Timer lokal berbasis requestAnimationFrame.
let rafId = null;
let timerTotal = 0;
let timerBerakhir = 0;

const $ = (id) => document.getElementById(id);
const titikKoneksi = $('titik-koneksi');
const overlaySuara = $('overlay-suara');
const inputEl = $('kotak-jawaban');
const flashEl = $('flash');

AudioManager.init();

function terapkanConfig(c) {
  if (!c) return;
  config = Object.assign(config, c);
  inputEl.maxLength = config.MAKS_KARAKTER_JAWABAN;
}

function labelBabak() {
  return babakAktif === 'POIN' ? 'BABAK POIN' : 'BABAK REBUTAN';
}

function tampilkan(idAktif) {
  const daftar = ['tampilan-idle', 'tampilan-soal', 'tampilan-input', 'tampilan-loading', 'tampilan-hasil', 'tampilan-pemenang'];
  for (const id of daftar) {
    $(id).classList.toggle('aktif', id === idAktif);
  }
  document.body.classList.toggle('game-jalan', fase !== 'IDLE');
}

function perbaruiBrand() {
  $('brand-babak').textContent = fase === 'IDLE' ? '' : labelBabak();
}

// Aturan ditulis ulang agar gampang dibaca: 3 kartu pendek.
function renderPeraturan() {
  const wadah = $('kartu-aturan');
  wadah.textContent = '';
  const kartu = [
    {
      judul: 'BABAK POIN',
      isi: [
        'Giliran otomatis bergantian: Soal 1 Tim A, Soal 2 Tim B, dst.',
        'Ketik huruf pertama → soal hilang, waktu ' + config.DETIK_MENJAWAB + ' detik jalan.',
        'Boleh diskusi, 1 orang mengetik. ENTER kirim / habis waktu terkirim.'
      ]
    },
    {
      judul: 'BABAK REBUTAN',
      isi: [
        'Juri menunjuk tim tercepat angkat tangan.',
        'Tim terpilih mengetik, waktu ' + config.DETIK_MENJAWAB + ' detik jalan.',
        'Boleh diskusi, 1 orang mengetik.'
      ]
    },
    {
      judul: 'NILAI & ETIKA',
      isi: [
        'Benar +' + config.POIN_BENAR + '. Benar lemparan +' + config.POIN_BENAR_LEMPAR + '. Salah 0.',
        'Salah → dilempar ke lawan, waktu ' + config.DETIK_LEMPAR + ' detik.',
        'Bukan giliran dilarang bersuara. Tanpa HP/buku. Juri mutlak.'
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

function renderSoal() {
  $('nomor-soal').textContent = 'SOAL ' + nomorSoal + ' / ' + totalSoal;
  $('lencana-babak').textContent = labelBabak();
  const el = $('teks-soal');
  el.textContent = teksSoal;
  el.classList.toggle('panjang', teksSoal.length > 120);
  if (babakAktif === 'REBUTAN' && !rebutanDipilih) {
    $('giliran').textContent = 'MENUNGGU JURI MEMILIH TIM PEREBUT…';
  } else {
    $('giliran').textContent = 'GILIRAN: ' + namaGiliran;
  }
  renderSkor('skor-nama-a', 'skor-angka-a', 'skor-nama-b', 'skor-angka-b');
}

function hentikanTimer() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

function gambarBingkaiTimer(total, akhir) {
  const isiBar = $('isi-bar');
  const angka = $('angka-detik');
  function bingkai() {
    const sisaMs = Math.max(0, akhir - performance.now());
    const sisa = sisaMs / 1000;
    isiBar.style.width = ((sisa / total) * 100).toFixed(2) + '%';
    angka.textContent = String(Math.ceil(sisa));
    angka.classList.toggle('mendesak', sisa <= 3.05 && sisa > 0);
    if (sisaMs <= 0) {
      hentikanTimer();
      kirimJawaban('TIMEOUT');
      return;
    }
    rafId = requestAnimationFrame(bingkai);
  }
  rafId = requestAnimationFrame(bingkai);
}

function mulaiTimerLokal(detik) {
  hentikanTimer();
  timerTotal = detik;
  timerBerakhir = performance.now() + detik * 1000;
  gambarBingkaiTimer(timerTotal, timerBerakhir);
}

function mulaiTimerLokalDariSisa(sisa, total) {
  hentikanTimer();
  timerTotal = total;
  timerBerakhir = performance.now() + Math.max(0, sisa) * 1000;
  gambarBingkaiTimer(timerTotal, timerBerakhir);
}

function masukModeInput() {
  fase = 'MENJAWAB';
  sudahKirim = false;
  tampilkan('tampilan-input');
  $('lencana-babak-input').textContent = labelBabak();
  $('banner-lempar').classList.toggle('tampil', tahap === 'LEMPAR');
  const soalKecil = $('soal-kecil-lempar');
  if (tahap === 'LEMPAR' && config.TAMPILKAN_SOAL_SAAT_LEMPAR) {
    soalKecil.textContent = teksSoal;
    soalKecil.classList.add('tampil');
  } else {
    soalKecil.textContent = '';
    soalKecil.classList.remove('tampil');
  }
  $('label-penjawab').textContent = namaGiliran;
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

function kirimJawaban(alasan) {
  if (sudahKirim) return;
  if (alasan === 'ENTER' && inputEl.value === '') return;
  sudahKirim = true;
  hentikanTimer();
  const text = inputEl.value;
  AudioManager.stopAll();
  fase = 'MENILAI';
  tampilkan('tampilan-loading');
  AudioManager.play('drumroll');
  panggilAksi({ aksi: 'jawab', text: text, alasan: alasan });
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

function tampilHasilBenar(namaTimPoin, poin) {
  const el = $('teks-hasil');
  el.textContent = 'BENAR!';
  el.className = '';
  el.classList.add('benar');
  $('detail-hasil').textContent = '+' + poin + ' poin untuk ' + namaTimPoin;
  renderSkor('hasil-nama-a', 'hasil-angka-a', 'hasil-nama-b', 'hasil-angka-b');
  tampilkan('tampilan-hasil');
}

function tampilHasilSalah() {
  const el = $('teks-hasil');
  el.textContent = 'SALAH!';
  el.className = '';
  el.classList.add('salah');
  $('detail-hasil').textContent = 'Tidak ada poin untuk soal ini';
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

// Terapkan snapshot dari server; bunyikan transisi hanya saat fase berubah.
function terapkanSnapshot(s) {
  if (!s || typeof s.fase !== 'string') return;
  terapkanConfig(s.config);
  const lama = faseSebelum;
  faseSebelum = s.fase;

  fase = s.fase;
  tahap = s.tahap;
  timA = s.timA; timB = s.timB;
  skorA = s.skorA; skorB = s.skorB;
  nomorSoal = s.nomorSoal; totalSoal = s.totalSoal;
  teksSoal = s.teksSoal;
  giliranTim = s.giliranTim; namaGiliran = s.namaGiliran;
  babakAktif = s.babakAktif || 'POIN';
  rebutanDipilih = s.rebutanDipilih || null;
  perbaruiBrand();

  if (s.fase === 'IDLE') {
    sudahKirim = false;
    hentikanTimer();
    AudioManager.stopAll();
    renderPeraturan();
    tampilkan('tampilan-idle');
    if (!AudioManager.aktif) overlaySuara.classList.remove('sembunyi');
    else overlaySuara.classList.add('sembunyi');
    return;
  }
  overlaySuara.classList.add('sembunyi');

  if (s.fase === 'SOAL') {
    if (lama !== 'SOAL' || rebutanTerakhir !== String(s.rebutanDipilih)) {
      sudahKirim = false;
      hentikanTimer();
      inputEl.value = '';
      AudioManager.play('start');
      renderSoal();
      tampilkan('tampilan-soal');
    } else {
      renderSoal();
    }
    rebutanTerakhir = String(s.rebutanDipilih);
    return;
  }

  if (s.fase === 'MENJAWAB') {
    // Saya yang sedang mengetik: jangan ganggu timer & ketikan lokal.
    if (lama === 'MENJAWAB' && !sudahKirim) return;
    sudahKirim = false;
    inputEl.value = '';
    if (tahap === 'LEMPAR') {
      $('banner-lempar').classList.add('tampil');
      const soalKecil = $('soal-kecil-lempar');
      if (config.TAMPILKAN_SOAL_SAAT_LEMPAR) {
        soalKecil.textContent = teksSoal;
        soalKecil.classList.add('tampil');
      }
    } else {
      $('banner-lempar').classList.remove('tampil');
      $('soal-kecil-lempar').classList.remove('tampil');
    }
    $('label-penjawab').textContent = namaGiliran;
    $('lencana-babak-input').textContent = labelBabak();
    tampilkan('tampilan-input');
    try { inputEl.focus(); } catch (e) {}
    AudioManager.play('tick');
    const total = tahap === 'LEMPAR' ? config.DETIK_LEMPAR : config.DETIK_MENJAWAB;
    const sisa = typeof s.sisaDetik === 'number' ? s.sisaDetik : total;
    mulaiTimerLokalDariSisa(sisa, total);
    return;
  }

  if (s.fase === 'MENILAI') {
    if (lama === 'MENILAI') return; // idempoten
    sudahKirim = true;
    hentikanTimer();
    AudioManager.stopAll();
    tampilkan('tampilan-loading');
    AudioManager.play('drumroll');
    return;
  }

  if (s.fase === 'MELEMPAR') {
    if (lama === 'MELEMPAR') return;
    sudahKirim = true;
    hentikanTimer();
    AudioManager.stopAll();
    AudioManager.play('wrong');
    kedip('#ef4444');
    tampilkan('tampilan-loading');
    return;
  }

  if (s.fase === 'HASIL') {
    if (lama === 'HASIL') return;
    sudahKirim = true;
    hentikanTimer();
    AudioManager.stopAll();
    if (s.hasilTerakhir === 'BENAR') {
      AudioManager.play('correct');
      kedip('#22c55e');
      tampilHasilBenar(s.giliranTim === 'A' ? timA : timB, s.poinTerakhir);
    } else {
      AudioManager.play('wrong');
      kedip('#ef4444');
      tampilHasilSalah();
    }
    return;
  }

  if (s.fase === 'PEMENANG') {
    sudahKirim = true;
    if (lama !== 'PEMENANG') {
      jalankanWinner(s.pemenang, timA, timB, skorA, skorB);
    } else {
      // Poll berikutnya: tampilkan statis tanpa mengulang animasi & suara.
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

// Interupsi keyboard: hanya saat SOAL + UTAMA. Rebutan menunggu pilihan juri.
document.addEventListener('keydown', (e) => {
  if (fase !== 'SOAL' || tahap !== 'UTAMA') return;
  if (babakAktif === 'REBUTAN' && !rebutanDipilih) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;     // abaikan shortcut
  if (e.key.length !== 1) return;                     // hanya karakter yang bisa dicetak (abaikan Shift, F5, Esc, Tab, dll)
  e.preventDefault();
  masukModeInput();                                   // tampilkan Input State
  inputEl.value = e.key;                              // masukkan huruf pertama secara manual (agar tidak hilang)
  inputEl.focus();
  mulaiTimerLokal(config.DETIK_MENJAWAB);             // timer lokal langsung jalan (tanpa menunggu server)
  AudioManager.play('tick');                          // loop
  panggilAksi({ aksi: 'mulai' });
});

inputEl.addEventListener('paste', (e) => e.preventDefault());
inputEl.addEventListener('contextmenu', (e) => e.preventDefault());
inputEl.addEventListener('blur', () => {
  if (fase === 'MENJAWAB' && !sudahKirim) {
    try { inputEl.focus(); } catch (e) {}
  }
});
inputEl.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return;
  if (fase !== 'MENJAWAB' || sudahKirim) return;
  e.preventDefault();
  if (inputEl.value === '') return; // ENTER kosong diabaikan
  kirimJawaban('ENTER');
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
setInterval(pollSekali, INTERVAL_POLL_MS);
