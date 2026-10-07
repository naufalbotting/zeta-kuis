// Zeta Kuis - Panel admin HP (mode Vercel: REST + polling, tanpa Socket.IO).
// Live-typing antar layar dibuang sesuai keputusan: juri menilai jawaban final
// yang dikirim peserta saat ENTER. Juri mengisi tim & soal, menilai, lanjut soal.
const INTERVAL_POLL_MS = 1000;

let fase = 'IDLE';
let tahap = 'UTAMA';
let config = {
  DETIK_MENJAWAB: 10,
  DETIK_LEMPAR: 15,
  POIN_BENAR: 10,
  POIN_BENAR_LEMPAR: 5,
  MIN_SOAL: 1,
  MAKS_SOAL: 10,
  MAKS_KARAKTER_SOAL: 300,
  MAKS_KARAKTER_JAWABAN: 100,
  MAKS_KARAKTER_NAMA_TIM: 20
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
let modeAktif = 'POIN';
let hasilTerakhir = null;
let poinTerakhir = 0;
let pemenang = null;
let dinilai = false; // cegah ketukan ganda BENAR/SALAH
let faseSebelum = 'IDLE';

// Timer kecil admin.
let sisaLokal = null;
let intervalTimer = null;

const $ = (id) => document.getElementById(id);
const titik = $('titik-koneksi');
const statusKoneksi = $('status-koneksi');
let toastTimeout = null;

function toast(pesan) {
  const el = $('toast');
  el.textContent = pesan;
  el.classList.add('tampil');
  if (toastTimeout) clearTimeout(toastTimeout);
  toastTimeout = setTimeout(() => el.classList.remove('tampil'), 3000);
}

function labelBabak(kode) {
  return kode === 'POIN' ? 'BABAK POIN' : 'BABAK REBUTAN';
}

function tampilMode(idAktif) {
  const daftar = ['mode-setup', 'mode-baca', 'mode-live', 'mode-nilai', 'mode-melempar', 'mode-hasil', 'mode-selesai'];
  for (const id of daftar) {
    $(id).classList.toggle('aktif', id === idAktif);
  }
  const berjalan = fase !== 'IDLE' && fase !== 'PEMENANG';
  $('panel-kontrol').classList.toggle('sembunyi', !berjalan);
}

function perbaruiHeader() {
  $('info-babak').textContent = (fase === 'IDLE' || fase === 'PEMENANG') ? '' : labelBabak(babakAktif);
  if (totalSoal > 0 && fase !== 'IDLE' && fase !== 'PEMENANG') {
    $('info-soal').textContent = 'SOAL ' + nomorSoal + '/' + totalSoal;
  } else {
    $('info-soal').textContent = '';
  }
  if (fase === 'IDLE') {
    $('info-skor').textContent = '';
  } else {
    $('info-skor').textContent = (timA || 'Tim A') + ' ' + skorA + ' — ' + skorB + ' ' + (timB || 'Tim B');
  }
}

function mulaiHitungMundur(sisa, label) {
  hentikanHitungMundur();
  sisaLokal = sisa;
  gambarSisa(label);
  intervalTimer = setInterval(() => {
    if (sisaLokal === null) return;
    sisaLokal = Math.max(0, sisaLokal - 1);
    gambarSisa(label);
    if (sisaLokal <= 0) hentikanHitungMundur();
  }, 1000);
}

function gambarSisa(label) {
  const el = $(label);
  if (!el || sisaLokal === null) return;
  el.textContent = 'Sisa waktu: ' + sisaLokal + ' detik';
}

function hentikanHitungMundur() {
  if (intervalTimer) { clearInterval(intervalTimer); intervalTimer = null; }
}

async function panggilAksi(payload) {
  try {
    const r = await fetch('/api/aksi', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const j = await r.json().catch(() => null);
    if (!r.ok || !j || j.ok !== true || !j.snap) {
      toast((j && j.pesan) || 'Gagal. Coba lagi.');
      return null;
    }
    const kosongkan = faseSebelum === 'PEMENANG' && j.snap.fase === 'IDLE';
    faseSebelum = j.snap.fase;
    renderDariSnapshot(j.snap, kosongkan);
    return j.snap;
  } catch (e) {
    toast('Terputus, mencoba menyambung…');
    return null;
  }
}

// ---- Setup dinamis ----
function modeDipilih() {
  const cek = document.querySelector('input[name="mode"]:checked');
  return cek ? cek.value : 'POIN';
}

function jumlahSoal() {
  return $('daftar-soal').querySelectorAll('textarea').length;
}

function soalTerisi() {
  return bacaSoalDariForm().filter((s) => s.trim().length > 0).length;
}

function perbaruiPengaturanKedua() {
  const mode = modeDipilih();
  $('pengaturan-kedua').style.display = mode === 'KEDUA' ? '' : 'none';
  if (mode !== 'KEDUA') return;
  const total = Math.max(soalTerisi(), jumlahSoal());
  const inputJumlah = $('input-jumlah-pertama');
  inputJumlah.max = String(Math.max(1, total - 1));
  inputJumlah.min = '1';
  let pertama = parseInt(inputJumlah.value, 10);
  if (!Number.isFinite(pertama) || pertama < 1) pertama = Math.ceil(total / 2);
  if (pertama > total - 1) pertama = Math.max(1, total - 1);
  const urutan = $('pilih-urutan').value;
  const pertamaLabel = urutan === 'REBUTAN_DULU' ? 'REBUTAN' : 'POIN';
  const keduaLabel = pertamaLabel === 'POIN' ? 'REBUTAN' : 'POIN';
  $('pratinjau-pembagian').textContent = 'Soal 1–' + pertama + ': ' + pertamaLabel + '. Soal ' + (pertama + 1) + '–' + total + ': ' + keduaLabel + '. Skor tetap diakumulasi.';
  perbaruiBantuanGiliran();
}

function perbaruiLabelSoal() {
  const areas = $('daftar-soal').querySelectorAll('.blok-soal');
  areas.forEach((blok, i) => {
    blok.querySelector('label').textContent = 'Soal ' + (i + 1);
  });
  $('tombol-tambah-soal').disabled = jumlahSoal() >= config.MAKS_SOAL;
}

function tambahSoal(nilaiAwal) {
  if (jumlahSoal() >= config.MAKS_SOAL) return;
  const blok = document.createElement('div');
  blok.className = 'blok-soal';
  const label = document.createElement('label');
  label.className = 'judul-kecil';
  const area = document.createElement('textarea');
  area.maxLength = config.MAKS_KARAKTER_SOAL;
  area.placeholder = 'Tulis soal...';
  if (nilaiAwal) area.value = nilaiAwal;
  area.addEventListener('input', perbaruiPengaturanKedua);
  blok.appendChild(label);
  blok.appendChild(area);
  if (jumlahSoal() >= 1) {
    const hapus = document.createElement('button');
    hapus.type = 'button';
    hapus.className = 'kecil';
    hapus.textContent = '− Hapus';
    hapus.addEventListener('click', () => {
      if (jumlahSoal() <= 1) return;
      blok.remove();
      perbaruiLabelSoal();
      perbaruiPengaturanKedua();
    });
    blok.appendChild(hapus);
  }
  $('daftar-soal').appendChild(blok);
  perbaruiLabelSoal();
  perbaruiPengaturanKedua();
}

function bacaSoalDariForm() {
  const areas = $('daftar-soal').querySelectorAll('textarea');
  return Array.from(areas).map((a) => a.value);
}

function perbaruiBantuanGiliran() {
  const a = $('input-tim-a').value.trim() || 'Tim 1';
  const b = $('input-tim-b').value.trim() || 'Tim 2';
  const mode = modeDipilih();
  if (mode === 'POIN') {
    $('bantuan-giliran').textContent = 'Babak Poin: giliran otomatis bergantian. Soal 1 → ' + a + ', soal 2 → ' + b + ', dst.';
  } else if (mode === 'REBUTAN') {
    $('bantuan-giliran').textContent = 'Babak Rebutan: juri menunjuk tim tercepat angkat tangan untuk tiap soal.';
  } else {
    const urutan = $('pilih-urutan').value === 'REBUTAN_DULU' ? 'Rebutan dulu, lalu Poin' : 'Poin dulu, lalu Rebutan';
    $('bantuan-giliran').textContent = 'Mode Keduanya (' + urutan + '). Skor diakumulasi. ' + $('pratinjau-pembagian').textContent;
  }
}

$('tombol-tambah-soal').addEventListener('click', () => tambahSoal(''));
$('input-tim-a').addEventListener('input', perbaruiBantuanGiliran);
$('input-tim-b').addEventListener('input', perbaruiBantuanGiliran);
document.querySelectorAll('input[name="mode"]').forEach((r) => r.addEventListener('change', () => { perbaruiPengaturanKedua(); perbaruiBantuanGiliran(); }));
$('pilih-urutan').addEventListener('change', () => { perbaruiPengaturanKedua(); perbaruiBantuanGiliran(); });
$('input-jumlah-pertama').addEventListener('input', () => { perbaruiPengaturanKedua(); perbaruiBantuanGiliran(); });

$('tombol-mulai').addEventListener('click', () => {
  const a = $('input-tim-a').value.trim();
  const b = $('input-tim-b').value.trim();
  const soal = bacaSoalDariForm();
  const mode = modeDipilih();
  if (!a || !b) { toast('Nama kedua tim wajib diisi.'); return; }
  const terisi = soal.filter((s) => s.trim().length > 0).length;
  if (terisi < 1) { toast('Minimal 1 soal terisi.'); return; }
  if (mode === 'KEDUA' && terisi < 2) { toast('Mode Keduanya butuh minimal 2 soal.'); return; }
  const payload = { aksi: 'setup', timA: a, timB: b, soal: soal, mode: mode };
  if (mode === 'KEDUA') {
    payload.urutan = $('pilih-urutan').value;
    payload.jumlahBabakPertama = parseInt($('input-jumlah-pertama').value, 10);
  }
  panggilAksi(payload);
});

$('tombol-lempar').addEventListener('click', () => {
  if (tahap !== 'UTAMA') return;
  if (babakAktif === 'REBUTAN' && !rebutanDipilih) { toast('Pilih tim perebut dulu.'); return; }
  if (!confirm('Lempar soal ini ke tim lawan?')) return;
  panggilAksi({ aksi: 'lempar' });
});

$('tombol-pilih-a').addEventListener('click', () => {
  panggilAksi({ aksi: 'rebutan', tim: 'A' });
});
$('tombol-pilih-b').addEventListener('click', () => {
  panggilAksi({ aksi: 'rebutan', tim: 'B' });
});

$('tombol-benar').addEventListener('click', () => {
  if (dinilai) return;
  dinilai = true;
  $('tombol-benar').disabled = true;
  $('tombol-salah').disabled = true;
  panggilAksi({ aksi: 'nilai', hasil: 'BENAR' });
});
$('tombol-salah').addEventListener('click', () => {
  if (dinilai) return;
  dinilai = true;
  $('tombol-benar').disabled = true;
  $('tombol-salah').disabled = true;
  panggilAksi({ aksi: 'nilai', hasil: 'SALAH' });
});

$('tombol-next').addEventListener('click', () => {
  panggilAksi({ aksi: 'next' });
});

$('tombol-akhiri').addEventListener('click', () => {
  bukaModalAkhir();
});
$('modal-batal').addEventListener('click', () => {
  $('modal-akhir').classList.remove('tampil');
});

$('tombol-baru').addEventListener('click', () => {
  if (!confirm('Mulai permainan baru? Semua data akan dihapus.')) return;
  panggilAksi({ aksi: 'reset' });
});

function bukaModalAkhir() {
  const modal = $('modal-akhir');
  const teks = $('modal-teks');
  const wadah = $('modal-tombol');
  wadah.textContent = '';
  if (skorA === skorB) {
    teks.textContent = 'Skor SERI (' + skorA + ' - ' + skorB + '). Pilih pemenang:';
    const btnA = document.createElement('button');
    btnA.type = 'button';
    btnA.textContent = timA;
    btnA.addEventListener('click', () => {
      modal.classList.remove('tampil');
      panggilAksi({ aksi: 'akhiri', pemenang: 'A' });
    });
    const btnB = document.createElement('button');
    btnB.type = 'button';
    btnB.textContent = timB;
    btnB.addEventListener('click', () => {
      modal.classList.remove('tampil');
      panggilAksi({ aksi: 'akhiri', pemenang: 'B' });
    });
    wadah.appendChild(btnA);
    wadah.appendChild(btnB);
  } else {
    const menang = skorA > skorB ? 'A' : 'B';
    const nama = menang === 'A' ? timA : timB;
    teks.textContent = 'Calon Pemenang: ' + nama + '. Setuju?';
    const btnYa = document.createElement('button');
    btnYa.type = 'button';
    btnYa.className = 'bahaya';
    btnYa.textContent = 'Ya, Akhiri';
    btnYa.addEventListener('click', () => {
      modal.classList.remove('tampil');
      panggilAksi({ aksi: 'akhiri', pemenang: menang });
    });
    wadah.appendChild(btnYa);
  }
  modal.classList.add('tampil');
}

function renderDariSnapshot(s, kosongkanForm) {
  fase = s.fase; tahap = s.tahap;
  timA = s.timA; timB = s.timB;
  skorA = s.skorA; skorB = s.skorB;
  nomorSoal = s.nomorSoal; totalSoal = s.totalSoal;
  teksSoal = s.teksSoal;
  giliranTim = s.giliranTim; namaGiliran = s.namaGiliran;
  babakAktif = s.babakAktif || 'POIN';
  rebutanDipilih = s.rebutanDipilih || null;
  modeAktif = s.mode || 'POIN';
  hasilTerakhir = s.hasilTerakhir; poinTerakhir = s.poinTerakhir;
  pemenang = s.pemenang;
  hentikanHitungMundur();
  perbaruiHeader();
  if (fase === 'IDLE') {
    if (kosongkanForm) {
      $('input-tim-a').value = '';
      $('input-tim-b').value = '';
      $('daftar-soal').textContent = '';
      tambahSoal('');
      perbaruiBantuanGiliran();
      perbaruiPengaturanKedua();
    }
    tampilMode('mode-setup');
    perbaruiLabelSoal();
  } else if (fase === 'SOAL') {
    dinilai = false;
    renderModeBaca();
    tampilMode('mode-baca');
    perbaruiTombolNext();
  } else if (fase === 'MENJAWAB') {
    dinilai = false;
    $('live-babak').textContent = labelBabak(babakAktif);
    $('live-soal').textContent = teksSoal;
    $('live-penjawab').textContent = 'Sedang menjawab: ' + namaGiliran;
    $('live-tahap').textContent = tahap === 'LEMPAR' ? 'Lemparan' : 'Kesempatan utama';
    $('kotak-live').textContent = '(menunggu jawaban dikirim…)';
    tampilMode('mode-live');
    if (typeof s.sisaDetik === 'number') mulaiHitungMundur(s.sisaDetik, 'live-sisa');
    perbaruiTombolNext();
  } else if (fase === 'MENILAI') {
    dinilai = false;
    $('nilai-babak').textContent = labelBabak(babakAktif);
    $('kotak-final').textContent = s.jawabanFinal || '(tidak ada jawaban)';
    $('tombol-benar').disabled = false;
    $('tombol-salah').disabled = false;
    tampilMode('mode-nilai');
    perbaruiTombolNext();
  } else if (fase === 'MELEMPAR') {
    const namaLawan = giliranTim === 'A' ? timA : timB;
    $('teks-melempar').textContent = 'Soal dilempar ke ' + (namaLawan || '') + '…';
    tampilMode('mode-melempar');
    perbaruiTombolNext();
  } else if (fase === 'HASIL') {
    $('hasil-babak-admin').textContent = labelBabak(babakAktif);
    if (hasilTerakhir === 'BENAR') {
      const nama = giliranTim === 'A' ? timA : timB;
      $('teks-hasil-admin').textContent = 'BENAR — +' + poinTerakhir + ' untuk ' + nama;
      $('teks-hasil-admin').className = 'hasil-benar';
    } else {
      $('teks-hasil-admin').textContent = 'SALAH — tidak ada poin';
      $('teks-hasil-admin').className = 'hasil-salah';
    }
    $('skor-hasil-admin').textContent = timA + ' ' + skorA + ' — ' + skorB + ' ' + timB;
    tampilMode('mode-hasil');
    perbaruiTombolNext();
  } else if (fase === 'PEMENANG') {
    const nama = pemenang === 'A' ? timA : timB;
    $('teks-pemenang-admin').textContent = nama;
    $('skor-selesai-admin').textContent = timA + ' ' + skorA + ' — ' + skorB + ' ' + timB;
    tampilMode('mode-selesai');
  }
}

function renderModeBaca() {
  $('baca-babak').textContent = labelBabak(babakAktif);
  $('baca-nomor').textContent = 'Soal ' + nomorSoal + ' / ' + totalSoal;
  $('baca-soal').textContent = teksSoal;
  const butuhPilih = babakAktif === 'REBUTAN' && !rebutanDipilih;
  $('pemilih-rebutan').style.display = butuhPilih ? '' : 'none';
  if (butuhPilih) {
    $('tombol-pilih-a').textContent = (timA || 'Tim A') + ' merebut';
    $('tombol-pilih-b').textContent = (timB || 'Tim B') + ' merebut';
    $('baca-giliran').textContent = 'Belum ada tim terpilih.';
    $('baca-status').textContent = 'Pilih tim tercepat angkat tangan, lalu peserta mulai mengetik.';
  } else {
    $('baca-giliran').textContent = 'GILIRAN: ' + namaGiliran;
    $('baca-status').textContent = 'Menunggu peserta mulai mengetik…';
  }
  $('tombol-lempar').style.display = tahap === 'UTAMA' && !butuhPilih ? '' : 'none';
}

function perbaruiTombolNext() {
  const btn = $('tombol-next');
  if (fase !== 'HASIL') {
    btn.disabled = true;
    btn.textContent = 'Next Soal';
    return;
  }
  if (nomorSoal >= totalSoal) {
    btn.disabled = true;
    btn.textContent = 'Soal terakhir selesai — tekan Akhiri Permainan';
  } else {
    btn.disabled = false;
    btn.textContent = 'Next Soal';
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
    if (s.config) config = Object.assign(config, s.config);
    titik.classList.add('hidup');
    statusKoneksi.textContent = 'Terhubung';
    const kosongkan = faseSebelum === 'PEMENANG' && s.fase === 'IDLE';
    faseSebelum = s.fase;
    renderDariSnapshot(s, kosongkan);
  } catch (e) {
    titik.classList.remove('hidup');
    statusKoneksi.textContent = 'Terputus, mencoba menyambung…';
  } finally {
    pollJalan = false;
  }
}

// Inisialisasi form.
tambahSoal('');
perbaruiBantuanGiliran();
perbaruiPengaturanKedua();
perbaruiHeader();
perbaruiTombolNext();
pollSekali();
setInterval(pollSekali, INTERVAL_POLL_MS);
