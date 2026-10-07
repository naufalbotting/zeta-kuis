// Zeta Kuis - Panel admin HP versi MCQ (Vercel: REST + polling).
// Juri: isi tim & soal (tanpa batas), bacakan soal, boleh 1x hint per soal
// (memilih opsi salah yang dibuang), lanjut soal, akhiri permainan.
// Penilaian OTOMATIS oleh server via kunci jawaban.
const POLL_CEPAT_MS = 400;
const POLL_LAMBAT_MS = 1500;

let fase = 'IDLE';
let config = {
  DETIK_MENJAWAB: 10,
  POIN_BENAR: 10,
  POIN_BENAR_HINT: 5,
  MIN_SOAL: 1,
  MAKS_KARAKTER_SOAL: 300,
  MAKS_KARAKTER_OPSI: 120,
  MAKS_KARAKTER_NAMA_TIM: 20
};
let timA = '';
let timB = '';
let skorA = 0;
let skorB = 0;
let nomorSoal = 0;
let totalSoal = 0;
let tanya = '';
let opsi = null;
let kunci = null;
let opsiDibuang = [];
let giliranTim = 'A';
let namaGiliran = '';
let pilihan = null;
let hasilTerakhir = null;
let poinTerakhir = 0;
let hintDipakai = false;
let pemenang = null;
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

function tampilMode(idAktif) {
  const daftar = ['mode-setup', 'mode-menjawab', 'mode-hasil', 'mode-selesai'];
  for (const id of daftar) {
    $(id).classList.toggle('aktif', id === idAktif);
  }
  const berjalan = fase !== 'IDLE' && fase !== 'PEMENANG';
  $('panel-kontrol').classList.toggle('sembunyi', !berjalan);
}

function perbaruiHeader() {
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

// ---- Setup dinamis (tanpa batas jumlah soal) ----
function jumlahSoal() {
  return $('daftar-soal').querySelectorAll('.blok-soal-mcq').length;
}

function bacaSoalDariForm() {
  const blokir = $('daftar-soal').querySelectorAll('.blok-soal-mcq');
  return Array.from(blokir).map((blok) => {
    const opsi = {};
    for (const h of ['A', 'B', 'C', 'D']) {
      opsi[h] = blok.querySelector('input[data-opsi="' + h + '"]').value;
    }
    const kunciCek = blok.querySelector('input[name^="kunci-"]:checked');
    return {
      tanya: blok.querySelector('textarea').value,
      opsi: opsi,
      kunci: kunciCek ? kunciCek.value : ''
    };
  });
}

function soalTerisi() {
  return bacaSoalDariForm().filter((s) => s.tanya.trim().length > 0).length;
}

function perbaruiBantuanGiliran() {
  const a = $('input-tim-a').value.trim() || 'Tim 1';
  const b = $('input-tim-b').value.trim() || 'Tim 2';
  $('bantuan-giliran').textContent = 'Giliran bergantian: soal 1 → ' + a + ', soal 2 → ' + b + ', dst. ' +
    soalTerisi() + ' soal terisi. Benar +' + config.POIN_BENAR + ' (setelah hint +' + config.POIN_BENAR_HINT + ').';
}

function tambahSoal() {
  const idx = jumlahSoal();
  const blok = document.createElement('div');
  blok.className = 'blok-soal-mcq kartu';
  const judul = document.createElement('h3');
  judul.className = 'judul-kecil';
  judul.textContent = 'Soal ' + (idx + 1);
  blok.appendChild(judul);
  const labelTanya = document.createElement('label');
  labelTanya.className = 'judul-kecil';
  labelTanya.textContent = 'Pertanyaan (dibacakan, tidak tampil di laptop)';
  blok.appendChild(labelTanya);
  const area = document.createElement('textarea');
  area.maxLength = config.MAKS_KARAKTER_SOAL;
  area.placeholder = 'Tulis pertanyaan...';
  area.addEventListener('input', perbaruiBantuanGiliran);
  blok.appendChild(area);
  for (const h of ['A', 'B', 'C', 'D']) {
    const baris = document.createElement('div');
    baris.className = 'baris-opsi';
    const radio = document.createElement('input');
    radio.type = 'radio';
    radio.name = 'kunci-' + idx;
    radio.value = h;
    radio.title = 'Jadikan kunci jawaban';
    const lab = document.createElement('label');
    lab.className = 'huruf-opsi';
    lab.textContent = h;
    const inp = document.createElement('input');
    inp.type = 'text';
    inp.setAttribute('data-opsi', h);
    inp.maxLength = config.MAKS_KARAKTER_OPSI;
    inp.placeholder = 'Opsi ' + h;
    inp.autocomplete = 'off';
    inp.addEventListener('input', perbaruiBantuanGiliran);
    baris.appendChild(radio);
    baris.appendChild(lab);
    baris.appendChild(inp);
    blok.appendChild(baris);
  }
  const ket = document.createElement('p');
  ket.className = 'bantuan';
  ket.textContent = 'Centang radio = kunci jawaban.';
  blok.appendChild(ket);
  if (idx >= 1) {
    const hapus = document.createElement('button');
    hapus.type = 'button';
    hapus.className = 'kecil';
    hapus.textContent = '− Hapus soal ini';
    hapus.addEventListener('click', () => {
      blok.remove();
      perbaruiNomorSoal();
      perbaruiBantuanGiliran();
    });
    blok.appendChild(hapus);
  }
  $('daftar-soal').appendChild(blok);
  perbaruiNomorSoal();
}

function perbaruiNomorSoal() {
  $('daftar-soal').querySelectorAll('.blok-soal-mcq h3').forEach((h, i) => {
    h.textContent = 'Soal ' + (i + 1);
  });
}

$('tombol-tambah-soal').addEventListener('click', tambahSoal);
$('input-tim-a').addEventListener('input', perbaruiBantuanGiliran);
$('input-tim-b').addEventListener('input', perbaruiBantuanGiliran);

$('tombol-mulai').addEventListener('click', () => {
  const a = $('input-tim-a').value.trim();
  const b = $('input-tim-b').value.trim();
  if (!a || !b) { toast('Nama kedua tim wajib diisi.'); return; }
  const daftar = bacaSoalDariForm().filter((s) => s.tanya.trim().length > 0);
  if (daftar.length < 1) { toast('Minimal 1 soal terisi lengkap.'); return; }
  for (let i = 0; i < daftar.length; i++) {
    const s = daftar[i];
    for (const h of ['A', 'B', 'C', 'D']) {
      if (!s.opsi[h].trim()) { toast('Soal ' + (i + 1) + ': opsi ' + h + ' wajib diisi.'); return; }
    }
    if (['A', 'B', 'C', 'D'].indexOf(s.kunci) === -1) { toast('Soal ' + (i + 1) + ': pilih kunci jawaban.'); return; }
  }
  panggilAksi({ aksi: 'setup', timA: a, timB: b, soal: daftar });
});

$('tombol-hint').addEventListener('click', () => {
  if (fase !== 'SOAL' || hintDipakai) return;
  bukaModalHint();
});

$('modal-hint-batal').addEventListener('click', () => {
  $('modal-hint').classList.remove('tampil');
});

function bukaModalHint() {
  const wadah = $('modal-hint-tombol');
  wadah.textContent = '';
  for (const h of ['A', 'B', 'C', 'D']) {
    if (h === kunci) continue; // kunci tak boleh dibuang
    if (opsiDibuang.indexOf(h) !== -1) continue;
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = 'Buang ' + h + ': ' + ((opsi && opsi[h]) || '');
    btn.addEventListener('click', () => {
      $('modal-hint').classList.remove('tampil');
      panggilAksi({ aksi: 'hint', buang: h });
    });
    wadah.appendChild(btn);
  }
  $('modal-hint').classList.add('tampil');
}

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

function gambarOpsiAdmin(elId, kunciId) {
  const wadah = $(elId);
  wadah.textContent = '';
  if (!opsi) return;
  for (const h of ['A', 'B', 'C', 'D']) {
    const div = document.createElement('div');
    div.className = 'opsi-admin';
    if (h === kunci) div.classList.add('kunci');
    if (opsiDibuang.indexOf(h) !== -1) div.classList.add('dibuang');
    if (h === pilihan) div.classList.add('dipilih');
    div.textContent = h + '. ' + opsi[h] + (h === kunci ? ' ✓' : '');
    wadah.appendChild(div);
  }
  if (kunciId) $(kunciId).textContent = 'Kunci: ' + (kunci || '-');
}

function renderDariSnapshot(s, kosongkanForm) {
  fase = s.fase;
  timA = s.timA; timB = s.timB;
  skorA = s.skorA; skorB = s.skorB;
  nomorSoal = s.nomorSoal; totalSoal = s.totalSoal;
  tanya = s.tanya || '';
  opsi = s.opsi;
  kunci = s.kunci;
  opsiDibuang = s.opsiDibuang || [];
  giliranTim = s.giliranTim; namaGiliran = s.namaGiliran;
  pilihan = s.pilihan;
  hasilTerakhir = s.hasilTerakhir; poinTerakhir = s.poinTerakhir;
  hintDipakai = !!s.hintDipakai;
  pemenang = s.pemenang;
  hentikanHitungMundur();
  perbaruiHeader();
  if (fase === 'IDLE') {
    if (kosongkanForm) {
      $('input-tim-a').value = '';
      $('input-tim-b').value = '';
      $('daftar-soal').textContent = '';
      tambahSoal();
      perbaruiBantuanGiliran();
    }
    tampilMode('mode-setup');
  } else if (fase === 'SOAL') {
    $('jawab-nomor').textContent = 'Soal ' + nomorSoal + ' / ' + totalSoal;
    $('jawab-soal').textContent = tanya;
    gambarOpsiAdmin('jawab-opsi', 'jawab-kunci');
    $('jawab-penjawab').textContent = 'Menjawab: ' + namaGiliran;
    $('tombol-hint').disabled = hintDipakai;
    $('tombol-hint').textContent = hintDipakai ? 'Hint sudah dipakai (opsi ' + opsiDibuang.join(',') + ' dibuang)' : 'Hint: Buang 1 Opsi Salah';
    if (typeof s.sisaDetik === 'number') mulaiHitungMundur(s.sisaDetik, 'jawab-sisa');
    tampilMode('mode-menjawab');
    perbaruiTombolNext();
  } else if (fase === 'HASIL') {
    if (hasilTerakhir === 'BENAR') {
      $('teks-hasil-admin').textContent = 'BENAR — +' + poinTerakhir + ' untuk ' + (giliranTim === 'A' ? timA : timB);
      $('teks-hasil-admin').className = 'hasil-benar';
    } else {
      $('teks-hasil-admin').textContent = pilihan ? 'SALAH — tidak ada poin' : 'WAKTU HABIS — tidak ada poin';
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

function faseAktif() {
  return fase === 'SOAL';
}

// Inisialisasi form.
tambahSoal();
perbaruiBantuanGiliran();
perbaruiHeader();
perbaruiTombolNext();
pollSekali();
(function jadwalPoll() {
  setTimeout(async () => {
    await pollSekali();
    jadwalPoll();
  }, faseAktif() ? POLL_CEPAT_MS : POLL_LAMBAT_MS);
})();
