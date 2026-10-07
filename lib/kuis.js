// Zeta Kuis - Inti logika permainan MCQ (Vercel serverless).
// Bahasa Indonesia. State disimpan di Redis (Upstash), BUKAN di memori.
// Aturan: POIN saja (giliran bergantian), soal pilihan ganda A-D tanpa batas
// jumlah, koreksi otomatis via kunci, hint 1x/soal (admin memilih opsi salah
// yang dibuang, benar setelah hint +setengah poin).
// Dipakai oleh api/*.js (Vercel) dan scripts/dev.js (uji lokal).

const kv = require('./kv');

const KUNCI = 'zeta-kuis:state:v1';

// Nilai CONFIG tidak boleh diubah namanya. Angka di sini menjadi acuan seluruh aplikasi.
const CONFIG = {
  PORT: 3000,
  DETIK_MENJAWAB: 10,            // waktu memilih jawaban tiap soal
  POIN_BENAR: 10,                // poin jika benar tanpa hint
  POIN_BENAR_HINT: 5,            // poin jika benar setelah memakai hint
  MIN_SOAL: 1,                   // jumlah soal TANPA batas atas
  MAKS_KARAKTER_SOAL: 300,       // pertanyaan (hanya tampil di admin, dibacakan juri)
  MAKS_KARAKTER_OPSI: 120,       // tiap opsi A-D (tampil di laptop, wrap bila panjang)
  MAKS_KARAKTER_NAMA_TIM: 20,
  DURASI_FLASH_MS: 800,          // durasi kedip hijau/merah di laptop
  TEGANG_MS: 3000                // animasi tegang otomatis setelah jawaban terkunci
};

// Tenggang server sebelum jawaban dianggap hangus (laptop mati saat timer jalan).
const TOLERANSI_HANGUS_MS = 5000;
const HURUF_OPSI = ['A', 'B', 'C', 'D'];

function stateAwal() {
  return {
    fase: 'IDLE',          // IDLE | SOAL | HASIL | PEMENANG
    timA: '',
    timB: '',
    skorA: 0,
    skorB: 0,
    daftarSoal: [],        // [{ tanya, opsi: {A,B,C,D}, kunci: 'A'..'D' }]
    soalAktif: -1,
    giliranTim: 'A',       // tim yang sedang berhak menjawab
    pilihan: null,         // 'A'..'D' | null = jawaban yang dikunci (null = waktu habis)
    hasilTerakhir: null,   // null | 'BENAR' | 'SALAH'
    poinTerakhir: 0,
    hintDipakai: false,    // hint sudah dipakai pada soal aktif
    opsiDibuang: [],       // opsi yang dibuang hint, mis. ['C']
    timerBerakhirPada: null,
    pemenang: null,
    rev: 0,                // nomor revisi, naik tiap ada kejadian
    antrean: []            // kejadian terakhir untuk memicu suara/kedip
  };
}

// Fungsi bantu wajib.
function namaTim(state, kode) {
  return kode === 'A' ? state.timA : state.timB;
}

function lawan(kode) {
  return kode === 'A' ? 'B' : 'A';
}

function giliranUntuk(indeks) {
  return indeks % 2 === 0 ? 'A' : 'B';
}

function potong(teks, maks) {
  const s = String(teks === undefined || teks === null ? '' : teks);
  return s.length > maks ? s.slice(0, maks) : s;
}

// Catat kejadian agar client yang poll belakangan tetap memainkan animasinya.
function catat(state, jenis, data) {
  state.rev += 1;
  const ev = Object.assign({ rev: state.rev, jenis: jenis }, data || {});
  state.antrean.push(ev);
  if (state.antrean.length > 8) state.antrean = state.antrean.slice(-8);
  return ev;
}

// Jika timer habis dan laptop tidak mengirim (mati/hilang), anggap waktu habis.
function terapkanKadaluarsa(state) {
  if (state.fase !== 'SOAL') return false;
  if (state.timerBerakhirPada === null) return false;
  if (Date.now() < state.timerBerakhirPada + TOLERANSI_HANGUS_MS) return false;
  kunciJawaban(state, null, true);
  return true;
}

// Kunci jawaban + nilai otomatis. Dipakai aksi jawab dan kadaluarsa.
function kunciJawaban(state, pilihan, otomatis) {
  state.pilihan = pilihan;
  const kunci = state.daftarSoal[state.soalAktif].kunci;
  const benar = pilihan !== null && pilihan === kunci;
  let poin = 0;
  if (benar) {
    poin = state.hintDipakai ? CONFIG.POIN_BENAR_HINT : CONFIG.POIN_BENAR;
    if (state.giliranTim === 'A') state.skorA += poin; else state.skorB += poin;
  }
  state.fase = 'HASIL';
  state.hasilTerakhir = benar ? 'BENAR' : 'SALAH';
  state.poinTerakhir = poin;
  state.timerBerakhirPada = null;
  catat(state, 'KUNCI_JAWABAN', { pilihan: pilihan, otomatis: !!otomatis });
  catat(state, benar ? 'BENAR_MCQ' : 'SALAH_MCQ', {
    pilihan: pilihan,
    kunci: kunci,
    poin: poin,
    tim: state.giliranTim,
    namaTim: namaTim(state, state.giliranTim)
  });
}

function snapshot(state) {
  const sudahMulai = state.soalAktif >= 0 && state.daftarSoal.length > 0;
  const soal = sudahMulai ? state.daftarSoal[state.soalAktif] : null;
  let sisaDetik = null;
  if (state.timerBerakhirPada !== null) {
    sisaDetik = Math.max(0, Math.ceil((state.timerBerakhirPada - Date.now()) / 1000));
  }
  return {
    fase: state.fase,
    timA: state.timA,
    timB: state.timB,
    skorA: state.skorA,
    skorB: state.skorB,
    totalSoal: state.daftarSoal.length,
    nomorSoal: sudahMulai ? state.soalAktif + 1 : 0,
    // CATATAN: tanya & kunci ikut terkirim agar HP admin bisa membacakan soal.
    // Layar laptop SENGAJA tidak merender keduanya (hanya opsi A-D).
    tanya: soal ? soal.tanya : '',
    opsi: soal ? { A: soal.opsi.A, B: soal.opsi.B, C: soal.opsi.C, D: soal.opsi.D } : null,
    kunci: soal ? soal.kunci : null,
    opsiDibuang: state.opsiDibuang.slice(),
    giliranTim: state.giliranTim,
    namaGiliran: namaTim(state, state.giliranTim) || '',
    pilihan: state.pilihan,
    hasilTerakhir: state.hasilTerakhir,
    poinTerakhir: state.poinTerakhir,
    hintDipakai: state.hintDipakai,
    sisaDetik: sisaDetik,
    pemenang: state.pemenang,
    rev: state.rev || 0,
    antrean: Array.isArray(state.antrean) ? state.antrean.slice(-5) : [],
    config: {
      DETIK_MENJAWAB: CONFIG.DETIK_MENJAWAB,
      POIN_BENAR: CONFIG.POIN_BENAR,
      POIN_BENAR_HINT: CONFIG.POIN_BENAR_HINT,
      TEGANG_MS: CONFIG.TEGANG_MS,
      MIN_SOAL: CONFIG.MIN_SOAL,
      MAKS_KARAKTER_SOAL: CONFIG.MAKS_KARAKTER_SOAL,
      MAKS_KARAKTER_OPSI: CONFIG.MAKS_KARAKTER_OPSI,
      MAKS_KARAKTER_NAMA_TIM: CONFIG.MAKS_KARAKTER_NAMA_TIM,
      DURASI_FLASH_MS: CONFIG.DURASI_FLASH_MS
    }
  };
}

function mulaiTimer(state, detik) {
  state.timerBerakhirPada = Date.now() + detik * 1000;
}

async function muatState() {
  const tersimpan = await kv.baca(KUNCI);
  const state = tersimpan && typeof tersimpan === 'object' ? Object.assign(stateAwal(), tersimpan) : stateAwal();
  if (!Array.isArray(state.opsiDibuang)) state.opsiDibuang = [];
  if (terapkanKadaluarsa(state)) {
    await kv.tulis(KUNCI, state);
  }
  return state;
}

async function simpanState(state) {
  await kv.tulis(KUNCI, state);
}

function resetSoalAktif(state) {
  state.pilihan = null;
  state.hasilTerakhir = null;
  state.poinTerakhir = 0;
  state.hintDipakai = false;
  state.opsiDibuang = [];
  state.timerBerakhirPada = null;
}

// Setiap aksi mengembalikan { snap } atau { pesan }.
const aksi = {
  async setup(data) {
    const state = await muatState();
    if (state.fase !== 'IDLE') return { pesan: 'Permainan sedang berjalan.' };
    const timA = String(data && data.timA !== undefined ? data.timA : '').trim();
    const timB = String(data && data.timB !== undefined ? data.timB : '').trim();
    const mentah = Array.isArray(data && data.soal) ? data.soal : [];

    if (!timA || !timB) return { pesan: 'Nama kedua tim wajib diisi.' };
    if (timA.length > CONFIG.MAKS_KARAKTER_NAMA_TIM || timB.length > CONFIG.MAKS_KARAKTER_NAMA_TIM) {
      return { pesan: 'Nama tim maksimal ' + CONFIG.MAKS_KARAKTER_NAMA_TIM + ' karakter.' };
    }
    if (timA.toLowerCase() === timB.toLowerCase()) return { pesan: 'Nama kedua tim tidak boleh sama.' };

    const soal = [];
    for (let i = 0; i < mentah.length; i++) {
      const m = mentah[i] || {};
      const tanya = String(m.tanya !== undefined && m.tanya !== null ? m.tanya : '').trim();
      if (!tanya) continue; // blok soal kosong dibuang
      if (tanya.length > CONFIG.MAKS_KARAKTER_SOAL) {
        return { pesan: 'Soal ' + (i + 1) + ' maksimal ' + CONFIG.MAKS_KARAKTER_SOAL + ' karakter.' };
      }
      const opsi = {};
      const o = m.opsi || {};
      for (const h of HURUF_OPSI) {
        const teks = String(o[h] !== undefined && o[h] !== null ? o[h] : '').trim();
        if (!teks) return { pesan: 'Soal ' + (i + 1) + ': opsi ' + h + ' wajib diisi.' };
        if (teks.length > CONFIG.MAKS_KARAKTER_OPSI) {
          return { pesan: 'Soal ' + (i + 1) + ' opsi ' + h + ' maksimal ' + CONFIG.MAKS_KARAKTER_OPSI + ' karakter.' };
        }
        opsi[h] = teks;
      }
      const kunci = String(m.kunci !== undefined && m.kunci !== null ? m.kunci : '').toUpperCase();
      if (HURUF_OPSI.indexOf(kunci) === -1) {
        return { pesan: 'Soal ' + (i + 1) + ': kunci jawaban wajib A/B/C/D.' };
      }
      soal.push({ tanya: tanya, opsi: opsi, kunci: kunci });
    }
    if (soal.length < CONFIG.MIN_SOAL) {
      return { pesan: 'Minimal ' + CONFIG.MIN_SOAL + ' soal terisi lengkap.' };
    }

    state.timA = timA;
    state.timB = timB;
    state.skorA = 0;
    state.skorB = 0;
    state.daftarSoal = soal;
    state.soalAktif = 0;
    state.giliranTim = giliranUntuk(0);
    resetSoalAktif(state);
    state.pemenang = null;
    state.fase = 'SOAL';
    mulaiTimer(state, CONFIG.DETIK_MENJAWAB);
    catat(state, 'SOAL_BARU', { nomor: 1 });
    await simpanState(state);
    return { snap: snapshot(state) };
  },

  // Kunci pilihan: klik mouse atau tombol A/B/C/D. pilihan null = waktu habis.
  async jawab(data) {
    const state = await muatState();
    if (state.fase !== 'SOAL') return { snap: snapshot(state) };
    let pilihan = data && data.pilihan !== undefined && data.pilihan !== null
      ? String(data.pilihan).toUpperCase()
      : null;
    if (pilihan !== null) {
      if (HURUF_OPSI.indexOf(pilihan) === -1) return { pesan: 'Pilihan harus A, B, C, atau D.' };
      if (state.opsiDibuang.indexOf(pilihan) !== -1) return { pesan: 'Opsi itu sudah dibuang hint.' };
    }
    kunciJawaban(state, pilihan, pilihan === null);
    await simpanState(state);
    return { snap: snapshot(state) };
  },

  // Hint 1x/soal: admin memilih 1 opsi SALAH untuk dibuang.
  async hint(data) {
    const state = await muatState();
    if (state.fase !== 'SOAL') return { snap: snapshot(state) };
    if (state.hintDipakai) return { pesan: 'Hint soal ini sudah dipakai.' };
    const buang = data && data.buang !== undefined && data.buang !== null
      ? String(data.buang).toUpperCase()
      : '';
    if (HURUF_OPSI.indexOf(buang) === -1) return { pesan: 'Opsi hint harus A, B, C, atau D.' };
    const kunci = state.daftarSoal[state.soalAktif].kunci;
    if (buang === kunci) return { pesan: 'Tidak boleh membuang kunci jawaban.' };
    state.hintDipakai = true;
    state.opsiDibuang = [buang];
    catat(state, 'HINT', { buang: buang });
    await simpanState(state);
    return { snap: snapshot(state) };
  },

  async next() {
    const state = await muatState();
    if (state.fase !== 'HASIL') return { snap: snapshot(state) };
    if (!(state.soalAktif < state.daftarSoal.length - 1)) return { snap: snapshot(state) };
    state.soalAktif += 1;
    state.giliranTim = giliranUntuk(state.soalAktif);
    resetSoalAktif(state);
    state.fase = 'SOAL';
    mulaiTimer(state, CONFIG.DETIK_MENJAWAB);
    catat(state, 'SOAL_BARU', { nomor: state.soalAktif + 1 });
    await simpanState(state);
    return { snap: snapshot(state) };
  },

  async akhiri(data) {
    const state = await muatState();
    if (state.fase === 'IDLE' || state.fase === 'PEMENANG') return { snap: snapshot(state) };
    const pemenang = data && data.pemenang;
    if (pemenang !== 'A' && pemenang !== 'B') return { pesan: 'Pemenang tidak valid.' };
    state.timerBerakhirPada = null;
    state.pemenang = pemenang;
    state.fase = 'PEMENANG';
    catat(state, 'SELESAI', { pemenang: pemenang });
    await simpanState(state);
    return { snap: snapshot(state) };
  },

  async reset() {
    const state = await muatState();
    if (state.fase !== 'PEMENANG') return { snap: snapshot(state) };
    const kosong = stateAwal();
    await simpanState(kosong);
    return { snap: snapshot(kosong) };
  }
};

module.exports = { CONFIG, KUNCI, HURUF_OPSI, muatState, simpanState, snapshot, aksi };
