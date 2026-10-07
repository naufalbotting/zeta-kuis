// Zeta Kuis - Inti logika permainan untuk Vercel serverless.
// Bahasa Indonesia. State disimpan di Redis (Upstash), BUKAN di memori,
// karena tiap request Vercel bisa jatuh ke instance berbeda.
// Dipakai oleh api/*.js (Vercel) dan scripts/dev.js (uji lokal).

const kv = require('./kv');

const KUNCI = 'zeta-kuis:state:v1';

// Nilai CONFIG tidak boleh diubah namanya. Angka di sini menjadi acuan seluruh aplikasi.
const CONFIG = {
  PORT: 3000,
  DETIK_MENJAWAB: 10,            // waktu menjawab tim yang mendapat giliran
  DETIK_LEMPAR: 15,              // waktu menjawab tim lawan setelah soal dilempar
  POIN_BENAR: 10,                // poin jika benar pada kesempatan utama
  POIN_BENAR_LEMPAR: 5,          // poin jika benar pada soal lemparan
  MIN_SOAL: 1,
  MAKS_SOAL: 10,
  MAKS_KARAKTER_SOAL: 300,
  MAKS_KARAKTER_JAWABAN: 100,
  MAKS_KARAKTER_NAMA_TIM: 20,
  DURASI_FLASH_MS: 800,          // durasi kedip hijau/merah di laptop
  JEDA_SEBELUM_LEMPAR_MS: 1500,  // jeda setelah SALAH sebelum timer lempar mulai
  TAMPILKAN_SOAL_SAAT_LEMPAR: true // tampilkan soal kecil di atas kotak input saat lemparan
};

// Tenggang server sebelum jawaban dianggap hangus (laptop mati saat timer jalan).
const TOLERANSI_HANGUS_MS = 5000;

function stateAwal() {
  return {
    fase: 'IDLE',          // IDLE | SOAL | MENJAWAB | MENILAI | MELEMPAR | HASIL | PEMENANG
    tahap: 'UTAMA',        // UTAMA | LEMPAR
    timA: '',
    timB: '',
    skorA: 0,
    skorB: 0,
    daftarSoal: [],
    soalAktif: -1,
    giliranTim: 'A',
    giliranAwal: 'A',
    jawabanLive: '',
    jawabanFinal: '',
    hasilTerakhir: null,
    poinTerakhir: 0,
    timerBerakhirPada: null,
    pemenang: null,
    mode: 'POIN',
    urutanBabak: ['POIN', 'REBUTAN'],
    jumlahBabakPertama: 0,
    babakAktif: 'POIN',
    rebutanDipilih: null,
    rev: 0,            // nomor revisi, naik tiap ada kejadian (agar client tak ketinggalan animasi)
    antrean: []        // kejadian terakhir [{ rev, jenis, ... }] untuk memicu suara/kedip
  };
}

// Catat kejadian agar client yang poll belakangan tetap memainkan animasinya.
function catat(state, jenis, data) {
  state.rev += 1;
  const ev = Object.assign({ rev: state.rev, jenis: jenis }, data || {});
  state.antrean.push(ev);
  if (state.antrean.length > 8) state.antrean = state.antrean.slice(-8);
  return ev;
}

// Fungsi bantu wajib.
function namaTim(state, kode) {
  return kode === 'A' ? state.timA : state.timB;
}

function lawan(kode) {
  return kode === 'A' ? 'B' : 'A';
}

function giliranAwalUntuk(indeks) {
  return indeks % 2 === 0 ? 'A' : 'B';
}

function babakUntuk(state, indeks) {
  if (state.mode === 'POIN') return 'POIN';
  if (state.mode === 'REBUTAN') return 'REBUTAN';
  if (indeks < state.jumlahBabakPertama) return state.urutanBabak[0];
  return state.urutanBabak[1];
}

function giliranPoinUntuk(state, indeks) {
  let posisi = 0;
  for (let i = 0; i < indeks; i++) {
    if (babakUntuk(state, i) === 'POIN') posisi++;
  }
  return posisi % 2 === 0 ? 'A' : 'B';
}

function labelBabak(kode) {
  return kode === 'POIN' ? 'BABAK POIN' : 'BABAK REBUTAN';
}

function potong(teks, maks) {
  const s = String(teks === undefined || teks === null ? '' : teks);
  return s.length > maks ? s.slice(0, maks) : s;
}

function tidur(ms) {
  return new Promise((selesai) => setTimeout(selesai, ms));
}

// Jika timer habis dan laptop tidak mengirim (mati/hilang), anggap jawaban terkirim.
function terapkanKadaluarsa(state) {
  if (state.fase !== 'MENJAWAB') return false;
  if (state.timerBerakhirPada === null) return false;
  if (Date.now() < state.timerBerakhirPada + TOLERANSI_HANGUS_MS) return false;
  state.jawabanFinal = state.jawabanLive || '';
  state.fase = 'MENILAI';
  state.timerBerakhirPada = null;
  catat(state, 'JAWAB_TERKIRIM', { otomatis: true });
  return true;
}

function snapshot(state) {
  const sudahMulai = state.soalAktif >= 0 && state.daftarSoal.length > 0;
  let sisaDetik = null;
  if (state.timerBerakhirPada !== null) {
    sisaDetik = Math.max(0, Math.ceil((state.timerBerakhirPada - Date.now()) / 1000));
  }
  return {
    fase: state.fase,
    tahap: state.tahap,
    timA: state.timA,
    timB: state.timB,
    skorA: state.skorA,
    skorB: state.skorB,
    totalSoal: state.daftarSoal.length,
    nomorSoal: sudahMulai ? state.soalAktif + 1 : 0,
    teksSoal: sudahMulai ? (state.daftarSoal[state.soalAktif] || '') : '',
    giliranTim: state.giliranTim,
    namaGiliran: namaTim(state, state.giliranTim) || '',
    jawabanLive: state.jawabanLive,
    jawabanFinal: state.jawabanFinal,
    hasilTerakhir: state.hasilTerakhir,
    poinTerakhir: state.poinTerakhir,
    sisaDetik: sisaDetik,
    pemenang: state.pemenang,
    mode: state.mode,
    urutanBabak: state.urutanBabak.slice(),
    jumlahBabakPertama: state.jumlahBabakPertama,
    babakAktif: state.babakAktif,
    rebutanDipilih: state.rebutanDipilih,
    rev: state.rev || 0,
    antrean: Array.isArray(state.antrean) ? state.antrean.slice(-5) : [],
    config: {
      DETIK_MENJAWAB: CONFIG.DETIK_MENJAWAB,
      DETIK_LEMPAR: CONFIG.DETIK_LEMPAR,
      POIN_BENAR: CONFIG.POIN_BENAR,
      POIN_BENAR_LEMPAR: CONFIG.POIN_BENAR_LEMPAR,
      TAMPILKAN_SOAL_SAAT_LEMPAR: CONFIG.TAMPILKAN_SOAL_SAAT_LEMPAR,
      MIN_SOAL: CONFIG.MIN_SOAL,
      MAKS_SOAL: CONFIG.MAKS_SOAL,
      MAKS_KARAKTER_SOAL: CONFIG.MAKS_KARAKTER_SOAL,
      MAKS_KARAKTER_JAWABAN: CONFIG.MAKS_KARAKTER_JAWABAN,
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
  if (terapkanKadaluarsa(state)) {
    await kv.tulis(KUNCI, state);
  }
  return state;
}

async function simpanState(state) {
  await kv.tulis(KUNCI, state);
}

// Setiap aksi mengembalikan { snap } atau { pesan }.
const aksi = {
  async setup(data) {
    const state = await muatState();
    if (state.fase !== 'IDLE') return { pesan: 'Permainan sedang berjalan.' };
    const timA = String(data && data.timA !== undefined ? data.timA : '').trim();
    const timB = String(data && data.timB !== undefined ? data.timB : '').trim();
    let soal = Array.isArray(data && data.soal) ? data.soal : [];
    let mode = data && data.mode ? String(data.mode).toUpperCase() : 'POIN';
    if (mode !== 'POIN' && mode !== 'REBUTAN' && mode !== 'KEDUA') mode = 'POIN';
    let urutan = data && data.urutan ? String(data.urutan).toUpperCase() : 'POIN_DULU';
    if (urutan !== 'POIN_DULU' && urutan !== 'REBUTAN_DULU') urutan = 'POIN_DULU';
    const jumlahPertama = parseInt(data && data.jumlahBabakPertama !== undefined ? data.jumlahBabakPertama : NaN, 10);

    if (!timA || !timB) return { pesan: 'Nama kedua tim wajib diisi.' };
    if (timA.length > CONFIG.MAKS_KARAKTER_NAMA_TIM || timB.length > CONFIG.MAKS_KARAKTER_NAMA_TIM) {
      return { pesan: 'Nama tim maksimal ' + CONFIG.MAKS_KARAKTER_NAMA_TIM + ' karakter.' };
    }
    if (timA.toLowerCase() === timB.toLowerCase()) return { pesan: 'Nama kedua tim tidak boleh sama.' };
    soal = soal.map((s) => String(s !== undefined && s !== null ? s : '').trim()).filter((s) => s.length > 0);
    if (soal.length < CONFIG.MIN_SOAL || soal.length > CONFIG.MAKS_SOAL) {
      return { pesan: 'Jumlah soal harus ' + CONFIG.MIN_SOAL + ' sampai ' + CONFIG.MAKS_SOAL + '.' };
    }
    for (const s of soal) {
      if (s.length > CONFIG.MAKS_KARAKTER_SOAL) {
        return { pesan: 'Setiap soal maksimal ' + CONFIG.MAKS_KARAKTER_SOAL + ' karakter.' };
      }
    }
    if (mode === 'KEDUA' && soal.length < 2) {
      return { pesan: 'Mode Keduanya butuh minimal 2 soal (1 per babak).' };
    }
    let urutanBabak = ['POIN', 'REBUTAN'];
    let jumlahBabakPertama = 0;
    if (mode === 'KEDUA') {
      urutanBabak = urutan === 'REBUTAN_DULU' ? ['REBUTAN', 'POIN'] : ['POIN', 'REBUTAN'];
      if (!Number.isFinite(jumlahPertama) || jumlahPertama < 1 || jumlahPertama > soal.length - 1) {
        jumlahBabakPertama = Math.ceil(soal.length / 2);
      } else {
        jumlahBabakPertama = jumlahPertama;
      }
    }

    state.timA = timA;
    state.timB = timB;
    state.skorA = 0;
    state.skorB = 0;
    state.daftarSoal = soal;
    state.soalAktif = 0;
    state.tahap = 'UTAMA';
    state.mode = mode;
    state.urutanBabak = urutanBabak;
    state.jumlahBabakPertama = jumlahBabakPertama;
    state.babakAktif = mode === 'POIN' ? 'POIN' : mode === 'REBUTAN' ? 'REBUTAN' : urutanBabak[0];
    if (state.babakAktif === 'POIN') {
      state.giliranAwal = giliranPoinUntuk(state, 0);
      state.giliranTim = state.giliranAwal;
      state.rebutanDipilih = null;
    } else {
      state.giliranAwal = 'A';
      state.giliranTim = 'A';
      state.rebutanDipilih = null;
    }
    state.jawabanLive = '';
    state.jawabanFinal = '';
    state.hasilTerakhir = null;
    state.poinTerakhir = 0;
    state.timerBerakhirPada = null;
    state.pemenang = null;
    state.fase = 'SOAL';
    catat(state, 'SOAL_BARU', { nomor: 1 });
    await simpanState(state);
    return { snap: snapshot(state) };
  },

  // Ketikan pertama di laptop: SOAL -> MENJAWAB, timer utama jalan.
  async mulai() {
    const state = await muatState();
    if (state.fase !== 'SOAL' || state.tahap !== 'UTAMA') return { snap: snapshot(state) };
    if (state.babakAktif === 'REBUTAN' && !state.rebutanDipilih) {
      return { pesan: 'Juri belum memilih tim perebut.' };
    }
    state.fase = 'MENJAWAB';
    state.jawabanLive = '';
    mulaiTimer(state, CONFIG.DETIK_MENJAWAB);
    catat(state, 'MULAI_MENJAWAB', { tahap: 'UTAMA' });
    await simpanState(state);
    return { snap: snapshot(state) };
  },

  // ENTER atau waktu habis di laptop: MENJAWAB -> MENILAI.
  async jawab(data) {
    const state = await muatState();
    if (state.fase !== 'MENJAWAB') return { snap: snapshot(state) };
    const text = potong(data && data.text !== undefined ? data.text : '', CONFIG.MAKS_KARAKTER_JAWABAN);
    state.jawabanFinal = text;
    state.fase = 'MENILAI';
    state.timerBerakhirPada = null;
    catat(state, 'JAWAB_TERKIRIM', {});
    await simpanState(state);
    return { snap: snapshot(state) };
  },

  // Penilaian juri: BENAR langsung HASIL; SALAH utama -> jeda -> LEMPAR.
  async nilai(data) {
    const state = await muatState();
    if (state.fase !== 'MENILAI') return { snap: snapshot(state) };
    const hasil = data && data.hasil === 'SALAH' ? 'SALAH' : 'BENAR';
    if (hasil === 'BENAR') {
      const poin = state.tahap === 'LEMPAR' ? CONFIG.POIN_BENAR_LEMPAR : CONFIG.POIN_BENAR;
      if (state.giliranTim === 'A') state.skorA += poin; else state.skorB += poin;
      state.fase = 'HASIL';
      state.hasilTerakhir = 'BENAR';
      state.poinTerakhir = poin;
      state.timerBerakhirPada = null;
      catat(state, 'BENAR', { poin: poin, tim: state.giliranTim, namaTim: namaTim(state, state.giliranTim), tahap: state.tahap });
      await simpanState(state);
      return { snap: snapshot(state) };
    }
    if (state.tahap === 'UTAMA') {
      state.fase = 'MELEMPAR';
      state.timerBerakhirPada = null;
      catat(state, 'SALAH_LEMPAR', {});
      await simpanState(state);
      await tidur(CONFIG.JEDA_SEBELUM_LEMPAR_MS);
      const terbaru = await muatState();
      // Jika permainan sudah diakhiri saat jeda, jangan lanjutkan lemparan.
      if (terbaru.fase !== 'MELEMPAR') return { snap: snapshot(terbaru) };
      terbaru.tahap = 'LEMPAR';
      terbaru.giliranTim = lawan(terbaru.giliranAwal);
      terbaru.fase = 'MENJAWAB';
      terbaru.jawabanLive = '';
      terbaru.jawabanFinal = '';
      mulaiTimer(terbaru, CONFIG.DETIK_LEMPAR);
      catat(terbaru, 'MULAI_LEMPAR', { giliranTim: terbaru.giliranTim });
      await simpanState(terbaru);
      return { snap: snapshot(terbaru) };
    }
    state.fase = 'HASIL';
    state.hasilTerakhir = 'SALAH';
    state.poinTerakhir = 0;
    state.timerBerakhirPada = null;
    catat(state, 'SALAH_HASIL', {});
    await simpanState(state);
    return { snap: snapshot(state) };
  },

  // Juri melempar tanpa menunggu jawaban (tim tidak menjawab).
  async lempar() {
    const state = await muatState();
    if (state.fase !== 'SOAL' || state.tahap !== 'UTAMA') return { snap: snapshot(state) };
    if (state.babakAktif === 'REBUTAN' && !state.rebutanDipilih) {
      return { pesan: 'Juri belum memilih tim perebut.' };
    }
    state.tahap = 'LEMPAR';
    state.giliranTim = lawan(state.giliranAwal);
    state.fase = 'MENJAWAB';
    state.jawabanLive = '';
    state.jawabanFinal = '';
    mulaiTimer(state, CONFIG.DETIK_LEMPAR);
    catat(state, 'MULAI_LEMPAR', { giliranTim: state.giliranTim });
    await simpanState(state);
    return { snap: snapshot(state) };
  },

  async next() {
    const state = await muatState();
    if (state.fase !== 'HASIL') return { snap: snapshot(state) };
    if (!(state.soalAktif < state.daftarSoal.length - 1)) return { snap: snapshot(state) };
    state.soalAktif += 1;
    state.tahap = 'UTAMA';
    state.babakAktif = babakUntuk(state, state.soalAktif);
    if (state.babakAktif === 'POIN') {
      state.giliranAwal = giliranPoinUntuk(state, state.soalAktif);
      state.giliranTim = state.giliranAwal;
      state.rebutanDipilih = null;
    } else {
      state.giliranAwal = 'A';
      state.giliranTim = 'A';
      state.rebutanDipilih = null;
    }
    state.jawabanLive = '';
    state.jawabanFinal = '';
    state.hasilTerakhir = null;
    state.poinTerakhir = 0;
    state.timerBerakhirPada = null;
    state.fase = 'SOAL';
    catat(state, 'SOAL_BARU', { nomor: state.soalAktif + 1 });
    await simpanState(state);
    return { snap: snapshot(state) };
  },

  // Juri menunjuk tim perebut (khusus babak REBUTAN, fase SOAL).
  async rebutan(data) {
    const state = await muatState();
    if (state.fase !== 'SOAL' || state.babakAktif !== 'REBUTAN') return { snap: snapshot(state) };
    const tim = data && data.tim;
    if (tim !== 'A' && tim !== 'B') return { pesan: 'Tim perebut tidak valid.' };
    state.giliranAwal = tim;
    state.giliranTim = tim;
    state.rebutanDipilih = tim;
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

module.exports = { CONFIG, KUNCI, muatState, simpanState, snapshot, aksi };
