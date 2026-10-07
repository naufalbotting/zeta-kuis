# AI.md — Sistem Cerdas Cermat Real-Time (Mode Lokal)

> **CATATAN 2026-10-07: arsitektur produksi PINDAH ke Vercel.**
> Spesifikasi Socket.IO di bawah ini adalah desain awal (mode lokal) dan
> sudah digantikan: `api/state.js` + `api/aksi.js` (REST + polling 1 detik),
> state di Upstash Redis (`lib/kuis.js`, `lib/kv.js`), live-typing dibuang
> (jawaban terkirim saat ENTER). Lihat `DEPLOY.md`. Aturan permainan,
> poin, dan babak tetap sama.

> **Dokumen ini adalah spesifikasi final untuk AI Vibecoding.**
> Semua keputusan desain sudah diambil di sini. **Jangan bertanya balik.** Jika ada hal yang terasa belum dijelaskan, gunakan nilai default di dokumen ini, lalu lanjut membangun.

---

## 0. Instruksi untuk AI (WAJIB DIBACA)

1. Ikuti spesifikasi ini **persis**. Nama event, nama variabel state, nama file, dan nilai CONFIG tidak boleh diubah.
2. **Bahasa:** seluruh teks UI dalam **Bahasa Indonesia**. Komentar kode juga Bahasa Indonesia. Nama variabel/state mengikuti dokumen ini.
3. **Jangan menambah library** selain `express`, `socket.io`, `canvas-confetti`. Tanpa framework (React/Vue/Tailwind dilarang). Frontend = HTML5 + CSS3 + Vanilla JS.
4. **Mode offline total.** Tidak boleh ada CDN, Google Fonts, atau URL eksternal apa pun. Semua aset dilayani dari server lokal.
5. **Keluarkan file lengkap**, bukan potongan. Setiap file harus langsung bisa dijalankan tanpa edit manual.
6. **Keamanan XSS:** semua teks dari pengguna (nama tim, soal, jawaban) ditampilkan dengan `textContent`, **dilarang** `innerHTML`.
7. **Server adalah satu-satunya sumber kebenaran** (`fase`, skor, giliran). Client hanya merender dan mengirim event. Setiap event dari client divalidasi terhadap `fase` saat ini; event yang tidak sesuai fase **diabaikan diam-diam**.
8. File audio (`.mp3`) disediakan pengguna sendiri. Jika file belum ada, aplikasi **tidak boleh error/crash**. Gagal memutar suara = diabaikan.
9. Kerjakan sesuai urutan di **Bagian 15**, lalu verifikasi dengan **Checklist Penerimaan di Bagian 16**.

---

## 1. Ringkasan Proyek

Aplikasi cerdas cermat dua tim yang berjalan di jaringan lokal (WiFi/hotspot, tanpa internet):

- **Laptop** (`/`) → layar untuk audiens/peserta. Menampilkan peraturan, soal, kotak jawaban, animasi, dan pemenang. Peserta mengetik jawaban langsung di keyboard laptop.
- **HP Admin/Juri** (`/admin`) → panel kontrol. Juri mengisi tim & soal, melihat jawaban peserta secara live, menekan BENAR/SALAH, lanjut soal, dan mengakhiri permainan.
- **Server Node.js** menghubungkan keduanya lewat Socket.IO secara real-time.

Tidak ada database, tidak ada login, tidak ada kunci jawaban di sistem. **Juri yang menilai jawaban secara manual.**

---

## 2. Teknologi

| Bagian | Teknologi |
|---|---|
| Backend | Node.js (CommonJS, `require`), Express 4.x, Socket.IO 4.x |
| Frontend | HTML5, CSS3 (Grid/Flexbox), Vanilla JavaScript (tanpa bundler) |
| Efek konfeti | `canvas-confetti` 1.x (diinstal via npm, dilayani lokal) |
| Penyimpanan | Variabel di memori server (hilang jika server restart — itu normal) |

`package.json` minimal:

```json
{
  "name": "cerdas-cermat",
  "version": "1.0.0",
  "main": "server.js",
  "scripts": { "start": "node server.js" },
  "dependencies": {
    "canvas-confetti": "^1.9.0",
    "express": "^4.19.0",
    "socket.io": "^4.7.0"
  }
}
```

---

## 3. Struktur Folder

```
cerdas-cermat/
├── package.json
├── server.js
├── AI.md
└── public/
    ├── laptop.html
    ├── admin.html
    ├── css/
    │   ├── base.css        (token warna, font, reset — dipakai kedua halaman)
    │   ├── laptop.css
    │   └── admin.css
    ├── js/
    │   ├── audio-manager.js
    │   ├── laptop.js
    │   └── admin.js
    ├── audio/
    │   ├── start.mp3
    │   ├── tick.mp3
    │   ├── drumroll.mp3
    │   ├── correct.mp3
    │   ├── wrong.mp3
    │   ├── roulette.mp3
    │   └── fanfare.mp3
    └── fonts/              (opsional: Inter & Bebas Neue .woff2 lokal)
```

**Routing server:**

| URL | Aksi |
|---|---|
| `/` | kirim `public/laptop.html` |
| `/admin` | kirim `public/admin.html` |
| `/lib/confetti/*` | static dari `node_modules/canvas-confetti/dist` (file: `confetti.browser.js`) |
| `/socket.io/socket.io.js` | otomatis dari Socket.IO |
| lainnya | static dari folder `public` |

**Server wajib:**
- `listen(PORT, '0.0.0.0')` agar HP bisa mengakses.
- Saat start, cetak ke console alamat IP LAN (pakai `os.networkInterfaces()`, ambil IPv4 non-internal), contoh:
  ```
  Layar Laptop : http://192.168.1.10:3000/
  Panel Admin  : http://192.168.1.10:3000/admin
  ```

---

## 4. CONFIG (satu tempat, di bagian atas `server.js`)

```js
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
```

Server **mengirim CONFIG (bagian yang relevan) ke client** di dalam `STATE_SYNC`, sehingga angka detik/poin pada teks peraturan di layar laptop selalu otomatis mengikuti CONFIG. **Dilarang menulis angka detik/poin langsung (hardcode) di HTML/JS client.**

---

## 5. Aturan Permainan (FINAL)

### 5.1 Aturan inti

1. Ada **2 tim**: Tim A dan Tim B (nama diisi juri).
2. Soal tampil **satu per satu**, sesuai urutan yang diinput juri (tidak diacak).
3. **Giliran menjawab pertama bergantian:** soal ke-1 → Tim A, soal ke-2 → Tim B, soal ke-3 → Tim A, dan seterusnya (indeks soal genap = Tim A, ganjil = Tim B).
4. Layar menampilkan **soal besar** dan tulisan "GILIRAN: {nama tim}".
5. Tim yang mendapat giliran **mulai mengetik jawaban**. Begitu **huruf pertama** ditekan, soal **langsung hilang**, kotak jawaban muncul, dan **waktu menjawab (`DETIK_MENJAWAB` detik) mulai berjalan**.
6. **Selama waktu berjalan, seluruh anggota tim yang mendapat giliran BOLEH berdiskusi.** Hanya **SATU orang** yang mengetik di keyboard.
7. Jawaban terkirim jika **menekan ENTER**, atau **otomatis saat waktu habis** (apa pun yang sudah diketik).
8. Setelah terkirim, layar masuk mode **"Memeriksa Jawaban..."** sampai juri menekan BENAR atau SALAH.
9. **BENAR** → tim yang menjawab mendapat poin; layar berkedip hijau.
10. **SALAH pada kesempatan utama** → layar berkedip merah, lalu soal **dilempar ke tim lawan** dengan waktu `DETIK_LEMPAR` detik. Timer lemparan **langsung berjalan** (tanpa perlu menunggu ketikan pertama). **Tim lawan juga boleh berdiskusi** selama waktu berjalan.
11. **SALAH pada lemparan** → tidak ada tim yang mendapat poin; soal selesai.
12. **Tidak ada pengurangan poin** untuk jawaban salah.
13. Setelah satu soal selesai, juri menekan **Next Soal** untuk lanjut. Tidak ada pindah soal otomatis.
14. Juri menekan **Akhiri Permainan** kapan saja (dengan konfirmasi). **Skor tertinggi menang.** Jika skor seri, juri memilih pemenang manual (lihat Bagian 12.2).

### 5.2 Sistem poin (default)

| Kejadian | Poin |
|---|---|
| Benar di kesempatan utama | +`POIN_BENAR` (10) untuk tim yang giliran |
| Benar di lemparan | +`POIN_BENAR_LEMPAR` (5) untuk tim lawan |
| Salah | 0 |

### 5.3 Etika permainan (ditampilkan di peraturan)

- Saat bukan giliran, **tim lawan dilarang bersuara/membantu**.
- Dilarang membuka HP, buku, atau internet.
- **Keputusan juri mutlak.**

### 5.4 Teks Peraturan di Layar Laptop (Idle State)

Tampilkan **persis** teks berikut (ganti `{…}` dengan nilai dari `config` yang dikirim server). Gunakan judul besar + daftar bernomor dengan font besar, rata tengah layar:

```
PERATURAN

1. Soal tampil bergantian. Giliran pertama menjawab selalu bergantian antar tim.
2. Mulai ketik jawaban → soal hilang, waktu {DETIK_MENJAWAB} DETIK berjalan.
3. Selama waktu berjalan, SELURUH ANGGOTA TIM BOLEH BERDISKUSI.
   Hanya SATU orang yang mengetik.
4. Tekan ENTER untuk mengirim, atau otomatis terkirim saat waktu habis.
5. Jawaban SALAH → soal dilempar ke tim lawan, waktu {DETIK_LEMPAR} DETIK (boleh berdiskusi juga).
6. Benar = +{POIN_BENAR} poin. Benar saat lemparan = +{POIN_BENAR_LEMPAR} poin. Salah = 0.
7. Saat bukan giliran, tim lawan dilarang bersuara. Dilarang membuka HP, buku, atau internet.
8. Keputusan juri mutlak. Skor tertinggi menang.
```

Jika game belum dimulai dan audio belum aktif, tampilkan overlay "KLIK DI MANA SAJA UNTUK MENGAKTIFKAN SUARA" di atas peraturan (lihat Bagian 11).

---

## 6. State di Server

Variabel global di `server.js` (nama persis):

```js
const state = {
  fase: 'IDLE',          // IDLE | SOAL | MENJAWAB | MENILAI | MELEMPAR | HASIL | PEMENANG
  tahap: 'UTAMA',        // UTAMA | LEMPAR
  timA: '',
  timB: '',
  skorA: 0,
  skorB: 0,
  daftarSoal: [],        // array string, 1..MAKS_SOAL
  soalAktif: -1,         // indeks 0-based; -1 = belum mulai
  giliranTim: 'A',       // 'A' | 'B' = tim yang sedang berhak menjawab SAAT INI
  giliranAwal: 'A',      // tim yang mendapat kesempatan utama pada soal aktif
  jawabanLive: '',       // ketikan terakhir (diterima via LIVE_TYPING)
  jawabanFinal: '',      // jawaban yang dikirim (SUBMIT_ANSWER)
  hasilTerakhir: null,   // null | 'BENAR' | 'SALAH'  (untuk soal aktif; dipakai saat sync)
  poinTerakhir: 0,       // poin yang baru didapat pada soal aktif
  timerBerakhirPada: null, // timestamp ms (Date.now()) kapan timer habis, atau null
  pemenang: null         // null | 'A' | 'B'
};
let timeoutPengaman = null; // setTimeout cadangan
let timeoutLempar = null;   // setTimeout jeda sebelum lemparan
```

**Fungsi bantu wajib:**
- `namaTim(kode)` → mengembalikan `state.timA` atau `state.timB`.
- `lawan(kode)` → `'A'` ↔ `'B'`.
- `snapshot()` → objek untuk `STATE_SYNC` (lihat 7.3).
- `bersihkanTimer()` → `clearTimeout` kedua timeout, `timerBerakhirPada = null`.
- `giliranAwalUntuk(indeks)` → `indeks % 2 === 0 ? 'A' : 'B'`.

---

## 7. State Machine & Socket.IO

### 7.1 Tabel Fase

| `fase` | Arti | Tampilan Laptop | Tampilan Admin |
|---|---|---|---|
| `IDLE` | Belum mulai / setelah reset | Peraturan | **Setup Mode** (form) |
| `SOAL` | Soal tampil, menunggu ketikan pertama (hanya `tahap=UTAMA`) | **Question State** | **Read Mode** |
| `MENJAWAB` | Timer berjalan, peserta mengetik | **Input State** | Live-typing (tombol BENAR/SALAH nonaktif) |
| `MENILAI` | Jawaban terkirim, menunggu juri | **Loading State** | **Judgement Mode** (tombol aktif) |
| `MELEMPAR` | Jeda singkat (transisi) setelah SALAH menuju lemparan | Flash merah | Menunggu (semua tombol nonaktif kecuali Akhiri) |
| `HASIL` | Satu soal selesai, menunggu Next | **Result State** | Hasil + tombol Next aktif |
| `PEMENANG` | Permainan berakhir | **Winner State** | Layar selesai + tombol "Permainan Baru" |

### 7.2 Transisi (dijalankan SERVER)

| Event masuk | Syarat `fase` | Aksi server | Event keluar |
|---|---|---|---|
| `SETUP_GAME` | `IDLE` | Validasi (Bagian 7.5). Simpan tim & soal, skor 0, `soalAktif=0`, `tahap='UTAMA'`, `giliranAwal=giliranTim=giliranAwalUntuk(0)`, `fase='SOAL'` | `GAME_START` lalu `SHOW_QUESTION` (ke semua) |
| `FIRST_KEYSTROKE` | `SOAL` & `tahap=UTAMA` | `fase='MENJAWAB'`, `jawabanLive=''`, mulai timer `DETIK_MENJAWAB`, pasang `timeoutPengaman` | `TIMER_START` (ke semua) |
| `LIVE_TYPING` | `MENJAWAB` | `jawabanLive = text` (dipotong `MAKS_KARAKTER_JAWABAN`) | `LIVE_TYPING` (hanya ke room `admin`) |
| `SUBMIT_ANSWER` | `MENJAWAB` | `jawabanFinal = text`, `fase='MENILAI'`, `bersihkanTimer()` | `ANSWER_SUBMITTED` (ke semua) |
| `JUDGE_CORRECT` | `MENILAI` | Tambah poin ke `giliranTim` (UTAMA → `POIN_BENAR`, LEMPAR → `POIN_BENAR_LEMPAR`), `fase='HASIL'`, `hasilTerakhir='BENAR'` | `ANSWER_CORRECT` |
| `WRONG_ANSWER` | `MENILAI` & `tahap=UTAMA` | `fase='MELEMPAR'`, lalu setelah `JEDA_SEBELUM_LEMPAR_MS`: `tahap='LEMPAR'`, `giliranTim=lawan(giliranAwal)`, `fase='MENJAWAB'`, `jawabanLive=''`, mulai timer `DETIK_LEMPAR`, pasang `timeoutPengaman` | `ANSWER_WRONG` {lanjut:'LEMPAR'} segera, lalu `THROW_START` setelah jeda |
| `WRONG_ANSWER` | `MENILAI` & `tahap=LEMPAR` | `fase='HASIL'`, `hasilTerakhir='SALAH'`, `poinTerakhir=0` | `ANSWER_WRONG` {lanjut:'HASIL'} |
| `THROW_NOW` | `SOAL` & `tahap=UTAMA` | Lempar tanpa menunggu jawaban (tim tidak menjawab). Langsung `tahap='LEMPAR'`, `giliranTim=lawan(giliranAwal)`, `fase='MENJAWAB'`, timer `DETIK_LEMPAR` | `THROW_START` (tanpa flash/buzzer) |
| `NEXT_QUESTION` | `HASIL` & `soalAktif < total-1` | `soalAktif++`, `tahap='UTAMA'`, `giliranAwal=giliranTim=giliranAwalUntuk(soalAktif)`, reset jawaban/hasil, `fase='SOAL'` | `SHOW_QUESTION` |
| `CONFIRM_END_GAME` | semua kecuali `IDLE`, `PEMENANG` | Validasi `pemenang` ('A'/'B'), `bersihkanTimer()`, `fase='PEMENANG'` | `END_GAME` |
| `RESET_GAME` | `PEMENANG` | Reset seluruh `state` ke nilai awal, `fase='IDLE'` | `STATE_SYNC` (ke semua) |
| `REGISTER` | kapan saja | `socket.join(role)` (`'laptop'` atau `'admin'`) | `STATE_SYNC` (ke pengirim saja) |

**`timeoutPengaman`:** saat timer dimulai (UTAMA maupun LEMPAR), server pasang `setTimeout` selama `(detik*1000 + 2000)` ms. Jika saat itu `fase` masih `MENJAWAB` (laptop gagal mengirim), server otomatis melakukan transisi `SUBMIT_ANSWER` dengan `text = jawabanLive`.

### 7.3 Daftar Event & Payload

**Client → Server**

| Event | Dari | Payload |
|---|---|---|
| `REGISTER` | keduanya (saat connect/reconnect) | `{ role: 'laptop' \| 'admin' }` |
| `SETUP_GAME` | admin | `{ timA: string, timB: string, soal: string[] }` |
| `FIRST_KEYSTROKE` | laptop | `{}` |
| `LIVE_TYPING` | laptop | `{ text: string }` (teks lengkap saat ini, bukan selisih) |
| `SUBMIT_ANSWER` | laptop | `{ text: string, alasan: 'ENTER' \| 'TIMEOUT' }` |
| `JUDGE_CORRECT` | admin | `{}` |
| `WRONG_ANSWER` | admin | `{}` |
| `THROW_NOW` | admin | `{}` |
| `NEXT_QUESTION` | admin | `{}` |
| `CONFIRM_END_GAME` | admin | `{ pemenang: 'A' \| 'B' }` |
| `RESET_GAME` | admin | `{}` |

**Server → Client**

| Event | Ke | Payload |
|---|---|---|
| `STATE_SYNC` | pengirim `REGISTER` / semua saat reset | `{ fase, tahap, timA, timB, skorA, skorB, totalSoal, nomorSoal, teksSoal, giliranTim, namaGiliran, jawabanLive, jawabanFinal, hasilTerakhir, poinTerakhir, sisaDetik, pemenang, config }` — `nomorSoal` = `soalAktif+1` (0 jika belum mulai); `teksSoal` = '' jika belum mulai; `sisaDetik` = sisa waktu timer (angka) atau `null`; `config` = `{ DETIK_MENJAWAB, DETIK_LEMPAR, POIN_BENAR, POIN_BENAR_LEMPAR, TAMPILKAN_SOAL_SAAT_LEMPAR, MIN_SOAL, MAKS_SOAL, MAKS_KARAKTER_SOAL, MAKS_KARAKTER_JAWABAN, MAKS_KARAKTER_NAMA_TIM, DURASI_FLASH_MS }` |
| `GAME_START` | semua | `{ timA, timB, skorA, skorB, totalSoal }` |
| `SHOW_QUESTION` | semua | `{ nomorSoal, totalSoal, teksSoal, giliranTim, namaGiliran, skorA, skorB }` |
| `TIMER_START` | semua | `{ detik, tahap: 'UTAMA' }` (hanya dipakai untuk kesempatan utama) |
| `LIVE_TYPING` | room `admin` | `{ text }` |
| `ANSWER_SUBMITTED` | semua | `{ text, alasan }` |
| `ANSWER_CORRECT` | semua | `{ tim: 'A'\|'B', namaTim, poin, skorA, skorB, tahap }` |
| `ANSWER_WRONG` | semua | `{ tahap, lanjut: 'LEMPAR' \| 'HASIL', skorA, skorB }` |
| `THROW_START` | semua | `{ giliranTim, namaGiliran, teksSoal, detik, dariSalah: boolean }` |
| `END_GAME` | semua | `{ pemenang: 'A'\|'B', namaPemenang, timA, timB, skorA, skorB }` |
| `ERROR_MSG` | pengirim event | `{ pesan: string }` (admin menampilkannya sebagai toast merah 3 detik) |

**Aturan penting:**
- Setiap perubahan `state` pada server dibarengi event di atas. Client yang baru connect/reconnect cukup memakai `STATE_SYNC` untuk menggambar ulang layar sesuai `fase`.
- Saat memproses `STATE_SYNC`, client **tidak** memicu suara satu-kali (start/correct/wrong/fanfare). Untuk `fase=MENJAWAB` nyalakan lagi loop `tick`; untuk `fase=MENILAI` nyalakan loop `drumroll` (jika audio sudah aktif). Timer client dilanjutkan dari `sisaDetik`.
- Server **tidak** menunggu konfirmasi dari client mana pun.

### 7.4 Contoh urutan satu soal (alur normal)

```
Admin  ──SETUP_GAME──▶ Server ──GAME_START, SHOW_QUESTION──▶ Laptop & Admin
Laptop ──FIRST_KEYSTROKE──▶ Server ──TIMER_START──▶ semua
Laptop ──LIVE_TYPING (tiap huruf)──▶ Server ──LIVE_TYPING──▶ Admin
Laptop ──SUBMIT_ANSWER──▶ Server ──ANSWER_SUBMITTED──▶ semua   (Laptop = Loading)
Admin  ──WRONG_ANSWER──▶ Server ──ANSWER_WRONG {lanjut:LEMPAR}──▶ semua   (flash merah)
                         (jeda 1,5 dtk) ──THROW_START──▶ semua (timer 15 dtk jalan)
Laptop ──SUBMIT_ANSWER──▶ Server ──ANSWER_SUBMITTED──▶ semua
Admin  ──JUDGE_CORRECT──▶ Server ──ANSWER_CORRECT──▶ semua   (flash hijau, +poin lemparan)
Admin  ──NEXT_QUESTION──▶ Server ──SHOW_QUESTION──▶ semua
```

### 7.5 Validasi `SETUP_GAME` (server)

- `timA` dan `timB`: `trim()`, tidak kosong, maksimal `MAKS_KARAKTER_NAMA_TIM`, **tidak boleh sama** (abaikan huruf besar/kecil).
- `soal`: array; setiap item di-`trim()`; **item kosong dibuang**; sisa harus `MIN_SOAL..MAKS_SOAL`; tiap soal maksimal `MAKS_KARAKTER_SOAL`.
- Jika gagal → kirim `ERROR_MSG` ke pengirim dengan pesan jelas (contoh: "Nama kedua tim tidak boleh sama.") dan **jangan** ubah state.

---

## 8. Spesifikasi Layar Laptop (`laptop.html` + `laptop.js` + `laptop.css`)

Layar penuh (`100vw × 100vh`), tanpa scroll, `cursor: none` saat game berjalan (kecuali di IDLE). Latar `#121212`. Hanya satu "tampilan" yang terlihat dalam satu waktu (pakai `<section>` per state dengan class `.aktif`).

### 8.1 Tampilan per State

| State | Isi |
|---|---|
| **Idle** | Teks peraturan (Bagian 5.4) rata tengah, font besar. Overlay "KLIK UNTUK MENGAKTIFKAN SUARA" jika audio belum di-unlock. |
| **Question** | Pojok kiri atas kecil: `SOAL {nomor} / {total}`. Tengah: **teks soal ukuran raksasa** (`clamp(3rem, 7vw, 9rem)`, font Bebas Neue/Impact, rata tengah, `white-space: pre-line`, maks lebar 90vw). Di bawah soal: `GILIRAN: {namaGiliran}` (abu-abu terang). Bawah: papan skor (lihat 8.2). Jika soal > 120 karakter, kecilkan satu tingkat (`clamp(2rem, 4.5vw, 5.5rem)`). |
| **Input** | Soal **disembunyikan**. Tengah: kotak input teks besar (lebar 80vw, tinggi ±120px, font 4rem, border putih 3px, latar `#1a1a1a`, teks putih, rata tengah). Di atasnya: label nama tim yang menjawab. Di bawah kotak: **Progress Bar Timer** + angka detik sisa (besar). Banner "KESEMPATAN TIM LAWAN" muncul di atas jika `tahap=LEMPAR` (lihat 8.5). |
| **Loading** | Input hilang. Teks "Memeriksa Jawaban..." di tengah dengan animasi **pulse** (opacity 0.3↔1 dan scale 0.97↔1.03, 1,2 detik, infinite). |
| **Result** | Tengah: "BENAR!" (hijau `#22c55e`) atau "SALAH!" (merah `#ef4444`) sangat besar. Di bawahnya: "+{poin} poin untuk {namaTim}" (jika benar) atau "Tidak ada poin untuk soal ini" (jika salah di lemparan). Di bawah: papan skor besar. **Tidak berganti otomatis**; menunggu admin menekan Next Soal. |
| **Winner** | Lihat Bagian 12. |

### 8.2 Papan Skor

Strip di bagian bawah layar pada state Question & Result: `[NAMA TIM A]  {skorA}   —   {skorB}  [NAMA TIM B]`. Tim yang sedang `giliranTim` ditandai dengan teks putih terang + garis bawah; tim lainnya abu-abu. Pada state Result, papan skor ditampilkan lebih besar.

### 8.3 Interupsi Keyboard (First Keystroke) — DETAIL PENTING

Berlaku **hanya** saat `fase='SOAL'` dan `tahap='UTAMA'`:

```js
document.addEventListener('keydown', (e) => {
  if (fase !== 'SOAL' || tahap !== 'UTAMA') return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;     // abaikan shortcut
  if (e.key.length !== 1) return;                     // hanya karakter yang bisa dicetak (abaikan Shift, F5, Esc, Tab, dll)
  e.preventDefault();
  masukModeInput();                                   // tampilkan Input State
  inputEl.value = e.key;                              // masukkan huruf pertama secara manual (agar tidak hilang)
  inputEl.focus();
  socket.emit('FIRST_KEYSTROKE');
  socket.emit('LIVE_TYPING', { text: inputEl.value });
  mulaiTimerLokal(config.DETIK_MENJAWAB);             // timer lokal langsung jalan (tanpa menunggu server)
  AudioManager.play('tick');                          // loop
});
```

Saat `fase` selain `SOAL`, penekanan tombol **diabaikan** (kecuali di dalam kotak input saat `MENJAWAB`).

### 8.4 Kotak Input (saat `fase='MENJAWAB'`)

- `<input type="text" maxlength="100" autocomplete="off" spellcheck="false" autocapitalize="off">`
- Selalu fokus: pada event `blur`, panggil `focus()` kembali (kecuali saat sudah terkirim).
- Event `input` → `socket.emit('LIVE_TYPING', { text: inputEl.value })`.
- **Paste dinonaktifkan** (`paste` → `preventDefault()`), klik kanan dinonaktifkan.
- `Enter`: jika teks kosong → abaikan (tidak terkirim). Jika ada isi → kirim jawaban.
- Waktu habis: kirim apa pun isinya (boleh kosong).
- **Kirim jawaban (`kirimJawaban(alasan)`):** hanya sekali (flag `sudahKirim`), lalu: hentikan timer, `AudioManager.stopAll()`, tampilkan Loading State **segera**, `AudioManager.play('drumroll')` (loop), dan `socket.emit('SUBMIT_ANSWER', { text, alasan })`. Setelah `sudahKirim = true`, semua input keyboard diabaikan. Event `ANSWER_SUBMITTED` dari server bersifat idempoten (jika sudah di Loading, tidak melakukan apa-apa).

### 8.5 Timer & Progress Bar

- Hitung dengan `requestAnimationFrame` berbasis `performance.now()` (bukan `setInterval`, agar halus).
- Bar: wadah (track) hitam `#000` tinggi 24px, isi bar abu-abu `#888` yang **menyusut dari 100% ke 0%** (lebar = sisa/total).
- Angka detik: `Math.ceil(sisa)` ditampilkan besar (±6rem). Pada ≤ 3 detik terakhir, angka berubah putih terang dan berdenyut sekali per detik.
- **Tahap LEMPAR:** banner di atas kotak input: **"KESEMPATAN TIM LAWAN"** (font besar, putih) + nama tim lawan di bawahnya. Jika `config.TAMPILKAN_SOAL_SAAT_LEMPAR=true`, tampilkan teks soal **kecil** (abu-abu terang, 1.6rem) di atas kotak input. Kotak input direset (kosong), timer `DETIK_LEMPAR` langsung berjalan saat event `THROW_START` diterima (`tick` loop ikut menyala). Input langsung aktif & fokus tanpa perlu ketikan pertama.
- Saat `STATE_SYNC` dengan `fase='MENJAWAB'`, lanjutkan timer dari `sisaDetik` (total = DETIK sesuai `tahap`).

### 8.6 Kedip Hijau / Merah

Elemen `<div id="flash">` fixed fullscreen, `pointer-events:none`, `opacity:0`. Saat `ANSWER_CORRECT`/`ANSWER_WRONG` animasi opacity `0 → 0.85 → 0` selama `DURASI_FLASH_MS` dengan warna `#22c55e` / `#ef4444`.

**Urutan setelah event:**
- `ANSWER_CORRECT`: `stopAll()` → `play('correct')` → flash hijau → tampilkan Result State.
- `ANSWER_WRONG` dengan `lanjut='HASIL'`: `stopAll()` → `play('wrong')` → flash merah → tampilkan Result State.
- `ANSWER_WRONG` dengan `lanjut='LEMPAR'`: `stopAll()` → `play('wrong')` → flash merah → tetap tampil layar Loading/gelap sampai `THROW_START` datang (±`JEDA_SEBELUM_LEMPAR_MS`).

---

## 9. Spesifikasi Panel Admin HP (`admin.html` + `admin.js` + `admin.css`)

Desain **mobile-first** (viewport `width=device-width, initial-scale=1, maximum-scale=1`), tema monokrom sama dengan laptop. Tombol besar (tinggi min **64px**), jarak antar tombol ≥ 12px. Bagian atas (header) selalu menampilkan: indikator koneksi (titik hijau/merah), `SOAL x/y` (saat game berjalan), dan skor kedua tim. Bagian bawah (**Control Panel**, `position: sticky; bottom: 0`) berisi tombol **Next Soal** dan tombol merah **Akhiri Permainan**, tampil hanya saat game berjalan (`fase` bukan `IDLE`/`PEMENANG`).

### 9.1 Setup Mode (`fase='IDLE'`)

- Input teks: **Nama Tim 1** (jadi Tim A) dan **Nama Tim 2** (jadi Tim B), `maxlength=20`.
- Daftar textarea soal dinamis: awal **1 textarea**; tombol "+ Tambah Soal" (maks 10, disable jika sudah 10); tombol "− Hapus" pada setiap soal selain jika hanya tersisa 1. Label "Soal 1", "Soal 2", dst. (nomor di-update ulang setelah menghapus). `maxlength=300`. **Tidak ada input jawaban.**
- Tombol besar **MULAI PERMAINAN** → validasi sisi client sederhana (nama tidak kosong, minimal 1 soal terisi) lalu `emit('SETUP_GAME', …)`. Validasi final tetap di server (Bagian 7.5).
- Teks bantuan kecil di bawah form: "Giliran pertama menjawab bergantian: soal 1 → {Tim 1}, soal 2 → {Tim 2}, dst."

### 9.2 Read Mode (`fase='SOAL'`)

- Kartu menampilkan: nomor soal, **teks soal** yang sedang tayang di laptop, dan "GILIRAN: {namaGiliran}".
- Status: "Menunggu peserta mulai mengetik…".
- Tombol sekunder (abu-abu): **"Lempar ke Tim Lawan"** (hanya jika `tahap='UTAMA'`) → `emit('THROW_NOW')`, dipakai jika tim tidak menjawab. Pakai konfirmasi `confirm()` sederhana.
- Tombol BENAR/SALAH tidak ditampilkan di mode ini.

### 9.3 Live Typing (`fase='MENJAWAB'`)

- Teks soal tetap terlihat (lebih kecil), label "Sedang menjawab: {namaGiliran}" dan tahap ("Kesempatan utama" / "Lemparan").
- Kotak **live-typing** besar menampilkan `LIVE_TYPING.text` secara real-time (placeholder "(belum ada ketikan)"). Gunakan `textContent`.
- Tombol BENAR & SALAH **tampil tetapi nonaktif** (`disabled`, abu-abu) karena jawaban belum dikirim.
- Timer sisa detik ditampilkan kecil (hitung mundur lokal dari `sisaDetik`/`TIMER_START`/`THROW_START`).

### 9.4 Judgement Mode (`fase='MENILAI'`)

- Kotak jawaban final (dari `ANSWER_SUBMITTED.text`; jika kosong tampilkan "(tidak ada jawaban)").
- Dua tombol besar bersisian/atas-bawah: **BENAR** (hijau `#22c55e`, teks hitam/putih kontras) → `emit('JUDGE_CORRECT')`, dan **SALAH** (merah `#ef4444`) → `emit('WRONG_ANSWER')`.
- Setelah salah satu ditekan, kedua tombol langsung `disabled` (cegah ketukan ganda). Server juga mengabaikan event ganda.

### 9.5 Fase `MELEMPAR` dan `HASIL`

- `MELEMPAR`: pesan "Soal dilempar ke {namaTim lawan}…", semua tombol nonaktif (kecuali Akhiri Permainan).
- `HASIL`: tampil hasil ("BENAR — +{poin} untuk {tim}" hijau, atau "SALAH — tidak ada poin" merah) dan skor. Tombol **Next Soal** aktif. **Jika ini soal terakhir** (`nomorSoal === totalSoal`), tombol Next **nonaktif** dengan label "Soal terakhir selesai — tekan Akhiri Permainan".
- Pada fase selain `HASIL`, tombol **Next Soal nonaktif**.

### 9.6 Akhiri Permainan (konfirmasi)

Tombol merah **Akhiri Permainan** → munculkan modal pop-up (overlay gelap, kartu tengah, **bukan** `alert()` bawaan browser):

- **Skor tidak seri:** teks `Calon Pemenang: {Nama Tim berskor tertinggi}. Setuju?` dengan tombol **"Ya, Akhiri"** (→ `emit('CONFIRM_END_GAME', { pemenang })`) dan **"Batal"** (tutup modal).
- **Skor seri:** teks `Skor SERI ({skor} - {skor}). Pilih pemenang:` dengan dua tombol besar bertuliskan nama tim masing-masing (→ `CONFIRM_END_GAME` dengan tim yang dipilih) dan tombol **"Batal"** (kembali bermain, misalnya untuk soal tambahan di luar sistem).

### 9.7 Layar Selesai (`fase='PEMENANG'`)

Tampilkan "PERMAINAN SELESAI", nama pemenang, skor akhir. Tombol **"Permainan Baru"** → `confirm()` → `emit('RESET_GAME')`, kembali ke Setup Mode (form kosong).

### 9.8 Toast & Koneksi

- `ERROR_MSG` → toast merah di atas layar selama 3 detik.
- `connect`/`reconnect` → selalu `emit('REGISTER', { role: 'admin' })`, titik koneksi hijau. `disconnect` → titik merah + teks "Terputus, mencoba menyambung…".

---

## 10. Audio Manager (`audio-manager.js`)

Dipakai **hanya di laptop**. HP admin **tidak mengeluarkan suara**.

### 10.1 File Suara

| Nama | File | Jenis | Kapan |
|---|---|---|---|
| `start` | `/audio/start.mp3` | sekali | Bunyi swoosh saat soal muncul (`SHOW_QUESTION`) |
| `tick` | `/audio/tick.mp3` | **loop** | Jam berdetak cepat selama timer berjalan (10 dtk & 15 dtk) |
| `drumroll` | `/audio/drumroll.mp3` | **loop** | Detak jantung/drumroll saat Loading State (menunggu juri) |
| `correct` | `/audio/correct.mp3` | sekali | Chime/ding ceria saat BENAR |
| `wrong` | `/audio/wrong.mp3` | sekali | Buzzer keras saat SALAH (**durasi file disarankan ≤ 1,5 detik**, agar tidak terpotong oleh `tick` lemparan) |
| `roulette` | `/audio/roulette.mp3` | **loop** | Suara roulette saat animasi putar nama tim di final |
| `fanfare` | `/audio/fanfare.mp3` | sekali | Fanfare saat nama pemenang berhenti & konfeti |

### 10.2 Aturan Utama: TIDAK ADA SUARA BERTUMPUK

- Hanya **satu suara** boleh bunyi pada satu waktu.
- `AudioManager.play(nama)` **selalu memanggil `stopAll()` terlebih dahulu**, baru memutar suara yang diminta.
- `stopAll()` = `pause()` + `currentTime = 0` pada semua objek Audio.

### 10.3 Pemetaan Momen → Suara (laptop)

| Momen | Aksi audio |
|---|---|
| `SHOW_QUESTION` | `play('start')` |
| Ketikan pertama (lokal) / `THROW_START` | `play('tick')` (loop) |
| ENTER atau waktu habis (masuk Loading) | `stopAll()` → `play('drumroll')` (loop) |
| `ANSWER_CORRECT` | `stopAll()` → `play('correct')` |
| `ANSWER_WRONG` | `stopAll()` → `play('wrong')` |
| `END_GAME` (mulai putar) | `stopAll()` → `play('roulette')` (loop) |
| Putaran berhenti di pemenang | `stopAll()` → `play('fanfare')` |
| `RESET_GAME` / `STATE_SYNC fase=IDLE` | `stopAll()` |

### 10.4 Kerangka Kode

```js
const AudioManager = {
  daftar: {
    start:    { src: '/audio/start.mp3',    loop: false },
    tick:     { src: '/audio/tick.mp3',     loop: true  },
    drumroll: { src: '/audio/drumroll.mp3', loop: true  },
    correct:  { src: '/audio/correct.mp3',  loop: false },
    wrong:    { src: '/audio/wrong.mp3',    loop: false },
    roulette: { src: '/audio/roulette.mp3', loop: true  },
    fanfare:  { src: '/audio/fanfare.mp3',  loop: false }
  },
  objek: {},
  aktif: false,

  init() {
    for (const [nama, cfg] of Object.entries(this.daftar)) {
      const a = new Audio(cfg.src);
      a.preload = 'auto';
      a.loop = cfg.loop;
      a.addEventListener('error', () => {}); // file belum ada = abaikan
      this.objek[nama] = a;
    }
  },

  // Dipanggil dari klik pertama pengguna (kebijakan autoplay browser)
  async unlock() {
    for (const a of Object.values(this.objek)) {
      try { a.muted = true; await a.play(); a.pause(); a.currentTime = 0; } catch (e) {}
      a.muted = false;
    }
    this.aktif = true;
  },

  stopAll() {
    for (const a of Object.values(this.objek)) { a.pause(); a.currentTime = 0; }
  },

  play(nama) {
    this.stopAll();
    const a = this.objek[nama];
    if (!a) return;
    a.play().catch(() => {}); // jangan pernah melempar error
  }
};
```

### 10.5 Aktivasi Suara (Autoplay Policy)

Browser memblokir suara sebelum ada interaksi pengguna. Laptop **wajib** menampilkan overlay "KLIK DI MANA SAJA UNTUK MENGAKTIFKAN SUARA" saat pertama dibuka. Klik (atau penekanan tombol) pertama memanggil `AudioManager.unlock()` lalu menyembunyikan overlay. Panduan operator (cetak di console server atau README): buka laptop, klik sekali, tekan **F11** untuk fullscreen, baru mulai permainan dari HP.

---

## 11. Desain Visual (Monokrom)

### 11.1 Token CSS (di `base.css`)

```css
:root {
  --bg: #121212;          /* latar utama */
  --bg-2: #1a1a1a;        /* kartu / input */
  --bg-3: #2a2a2a;        /* garis / track */
  --putih: #ffffff;
  --abu-terang: #cfcfcf;
  --abu: #888888;
  --abu-gelap: #444444;
  --hijau: #22c55e;       /* HANYA untuk BENAR */
  --merah: #ef4444;       /* HANYA untuk SALAH & tombol Akhiri */
  --font-judul: 'Bebas Neue', Impact, 'Arial Narrow Bold', sans-serif;
  --font-isi: 'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, Arial, sans-serif;
}
```

### 11.2 Aturan Warna

- **Hanya** hitam `#121212`, putih, dan abu-abu, **kecuali:** hijau (BENAR), merah (SALAH, tombol Akhiri), dan **full color** pada Winner State (nama pemenang + konfeti).
- Font Inter & Bebas Neue **harus dimuat lokal** lewat `@font-face` dari `/fonts/` (jika file font tidak ada, otomatis jatuh ke font cadangan di `--font-judul`/`--font-isi`). Dilarang Google Fonts.
- Gunakan `box-sizing: border-box`, `margin: 0` reset, `overflow: hidden` pada `body` laptop.

---

## 12. Grand Final & Animasi Kemenangan (Winner State)

### 12.1 Alur Event

Admin menekan Akhiri → konfirmasi (Bagian 9.6) → `CONFIRM_END_GAME` → server mengirim `END_GAME` → laptop menjalankan sekuens:

| Waktu | Tahap |
|---|---|
| 0 dtk | `stopAll()`, layar menjadi **hitam total** (`#000`), semua elemen lain disembunyikan |
| +0,8 dtk | Teks **"PEMENANGNYA ADALAH..."** muncul (fade-in 1,5 dtk, putih, font judul besar) |
| +3,3 dtk | Mulai **animasi slot machine / spin**: nama Tim A & Tim B bergantian cepat di tengah layar, `play('roulette')` |
| ±+8 dtk | Kecepatan melambat (ease-out), **berhenti di nama pemenang** |
| berhenti | `stopAll()` → `play('fanfare')`, nama tim membesar (**Scale Zoom**) + warna penuh, konfeti dari **kedua sudut bawah layar** |
| selesai | Tetap di layar akhir (nama pemenang + skor akhir kecil di bawah) sampai `RESET_GAME` |

### 12.2 Aturan Penentuan Pemenang

Pemenang ditentukan **admin** lewat `CONFIRM_END_GAME.pemenang` (server hanya memvalidasi `'A'` atau `'B'`). Jika skor tidak seri, tombol "Ya, Akhiri" otomatis memakai tim berskor tertinggi. Jika seri, admin memilih sendiri. Animasi slot **selalu berhenti di tim yang dikirim di `END_GAME.pemenang`**, apa pun skornya.

### 12.3 Kode Slot Machine (deterministik)

```js
// winnerIdx: 0 = Tim A, 1 = Tim B ; nama: [namaA, namaB]
function putarNama(winnerIdx, nama, el, selesai) {
  const N = 36;           // jumlah langkah
  let i = 0;
  (function langkah() {
    const idx = (winnerIdx + (N - 1 - i)) % 2; // bergantian A/B, langkah terakhir pasti = winnerIdx
    el.textContent = nama[idx];
    el.classList.remove('slot-in'); void el.offsetWidth; el.classList.add('slot-in'); // animasi geser vertikal singkat
    if (i === N - 1) return selesai();
    const x = i / (N - 1);
    const jeda = 50 + 330 * x * x * x;       // ease-out: 50ms (cepat) → 380ms (lambat)
    i++;
    setTimeout(langkah, jeda);
  })();
}
```

`.slot-in` = keyframes singkat (±80ms): `translateY(-40%)` + `opacity:0` → `translateY(0)` + `opacity:1`.

### 12.4 Zoom & Konfeti

- Setelah berhenti: elemen nama pemenang diberi class `.menang` → `transform: scale(1.6)`, `transition: transform 1.2s cubic-bezier(.2,.8,.2,1)`, teks berwarna penuh (gradien warna-warni atau emas `#ffd700`).
- `canvas-confetti` dimuat dengan `<script src="/lib/confetti/confetti.browser.js"></script>` (lokal, bukan CDN).

```js
function tembakKonfeti(durasiMs = 6000) {
  const akhir = Date.now() + durasiMs;
  const warna = ['#ff0040', '#ffd700', '#00e5ff', '#7cff00', '#ff00ff', '#ff8c00'];
  confetti({ particleCount: 150, angle: 60,  spread: 80, startVelocity: 70, origin: { x: 0, y: 1 }, colors: warna });
  confetti({ particleCount: 150, angle: 120, spread: 80, startVelocity: 70, origin: { x: 1, y: 1 }, colors: warna });
  (function frame() {
    confetti({ particleCount: 6, angle: 60,  spread: 70, startVelocity: 65, origin: { x: 0, y: 1 }, colors: warna });
    confetti({ particleCount: 6, angle: 120, spread: 70, startVelocity: 65, origin: { x: 1, y: 1 }, colors: warna });
    if (Date.now() < akhir) requestAnimationFrame(frame);
  })();
}
```

---

## 13. Edge Case & Perilaku Wajib

| Situasi | Perilaku yang benar |
|---|---|
| Laptop di-refresh di tengah permainan | Kirim `REGISTER`, terima `STATE_SYNC`, gambar ulang sesuai `fase`; timer lanjut dari `sisaDetik` |
| HP admin di-refresh / terputus | Sama: `REGISTER` → `STATE_SYNC`. Laptop tetap di state-nya (tidak reset) |
| Admin terputus saat `MENILAI` | Laptop tetap Loading + drumroll sampai admin kembali dan menilai |
| Event datang di fase yang salah (mis. `JUDGE_CORRECT` saat `SOAL`) | Diabaikan server tanpa error |
| `SETUP_GAME` ketika game sedang berjalan | Ditolak + `ERROR_MSG` "Permainan sedang berjalan." |
| Waktu habis tapi belum mengetik apa pun (di lemparan) | `SUBMIT_ANSWER` dengan `text=''` → juri tetap menilai ("(tidak ada jawaban)") |
| Laptop mati/tertutup saat timer | `timeoutPengaman` server memaksa transisi ke `MENILAI` dengan `jawabanLive` |
| Tim tidak menjawab sama sekali di kesempatan utama | Juri menekan "Lempar ke Tim Lawan" (`THROW_NOW`) |
| Soal terakhir selesai | Next Soal nonaktif; juri menekan Akhiri Permainan |
| Akhiri Permainan ditekan saat timer berjalan | Diizinkan; `bersihkanTimer()`; skor apa adanya (soal yang belum dinilai tidak dihitung) |
| Teks soal/nama/jawaban berisi `<script>` atau HTML | Tampil sebagai teks biasa (karena `textContent`) |
| Soal mengandung baris baru | Dipertahankan (`white-space: pre-line`) |
| Beberapa laptop/admin terhubung bersamaan | Diizinkan; semua menerima broadcast yang sama |
| Server di-restart | State hilang; semua client menerima `STATE_SYNC` dengan `fase='IDLE'` saat reconnect |
| Indikator koneksi | Titik kecil pojok layar: hijau (terhubung) / merah (terputus), di laptop dan admin |

---

## 14. Cara Menjalankan (untuk operator)

```bash
npm install
npm start
```

1. Laptop & HP terhubung ke **WiFi/hotspot yang sama**.
2. Buka di laptop: `http://localhost:3000/` (atau alamat IP yang dicetak di console). Klik sekali di layar untuk mengaktifkan suara, tekan **F11** untuk fullscreen.
3. Buka di HP: `http://<IP-LAPTOP>:3000/admin`.
4. Isi nama tim & soal di HP → **Mulai Permainan**.
5. Jika HP tidak bisa membuka alamat: izinkan Node.js/port 3000 di Windows Firewall.

---

## 15. Urutan Pengerjaan (5 Fase)

**Fase 1 — Infrastruktur & Server Lokal**
`package.json`, install dependensi, `server.js` (Express + Socket.IO, port 3000, `0.0.0.0`, cetak IP LAN), folder `public`, routing `/` dan `/admin`, route `/lib/confetti`, `CONFIG`, objek `state`, `REGISTER` + `STATE_SYNC`.

**Fase 2 — Antarmuka (UI/UX)**
`base.css` (token), `laptop.html/css` dengan semua state (Idle, Question, Input, Loading, Result, Winner), `admin.html/css` dengan semua mode (Setup, Read, Live-typing, Judgement, Hasil, Selesai, modal konfirmasi). Dulu statis dengan data dummy.

**Fase 3 — Logika Inti & Socket.IO**
Seluruh transisi di Bagian 7.2, first-keystroke, live typing, timer lokal + `timeoutPengaman`, alur BENAR/SALAH/lempar, `NEXT_QUESTION`, validasi `SETUP_GAME`, `ERROR_MSG`.

**Fase 4 — Audio & Tension**
`audio-manager.js`, overlay aktivasi suara, pemetaan suara (Bagian 10.3), kedip hijau/merah, animasi pulse Loading.

**Fase 5 — Grand Final**
Modal konfirmasi pemenang (termasuk kasus seri), `CONFIRM_END_GAME` → `END_GAME`, sekuens Winner (gelap → teks → slot machine → fanfare + konfeti + zoom), `RESET_GAME`.

---

## 16. Checklist Penerimaan (uji sebelum dianggap selesai)

- [ ] `npm install && npm start` jalan tanpa error; console menampilkan URL laptop & admin.
- [ ] Tidak ada request ke internet (cek tab Network: semua dari host lokal).
- [ ] Idle: peraturan tampil, angka detik/poin sesuai `CONFIG`.
- [ ] Setup: bisa 1–10 soal; nama kembar ditolak; soal kosong dibuang.
- [ ] Mulai: laptop menampilkan Soal 1, giliran Tim A, terdengar `start`.
- [ ] Menekan Shift/Ctrl/F-key **tidak** memicu mode input; huruf biasa memicu dan huruf pertama **tidak hilang**.
- [ ] Timer 10 detik: bar abu-abu menyusut, `tick` loop bunyi, admin melihat ketikan live.
- [ ] ENTER kosong diabaikan; ENTER berisi → Loading + `drumroll`; waktu habis → otomatis Loading.
- [ ] Tombol BENAR/SALAH admin nonaktif saat mengetik, aktif saat Judgement.
- [ ] BENAR → kedip hijau, `correct`, +10 poin untuk tim giliran, tampil Result.
- [ ] SALAH (utama) → kedip merah, `wrong`, ±1,5 dtk kemudian "KESEMPATAN TIM LAWAN" dengan timer 15 detik langsung jalan.
- [ ] BENAR di lemparan → +5 untuk tim lawan. SALAH di lemparan → 0 poin, Result.
- [ ] Next Soal: giliran awal bergantian (Soal 2 → Tim B). Di soal terakhir Next nonaktif.
- [ ] Tidak pernah ada dua suara bersamaan.
- [ ] Refresh laptop/admin di tengah permainan → tampilan dan timer pulih benar.
- [ ] Akhiri: pop-up "Calon Pemenang: …. Setuju?"; skor seri → pilih pemenang manual.
- [ ] Final: gelap → "PEMENANGNYA ADALAH..." → slot melambat → berhenti **tepat di pemenang** → fanfare + konfeti dua sudut bawah + zoom.
- [ ] "Permainan Baru" mengembalikan semuanya ke Idle/Setup.

---

## 17. Di Luar Cakupan (JANGAN dibuat)

Database, login/akun, kunci jawaban otomatis, penilaian otomatis, pengurangan poin, lebih dari 2 tim, input suara, penyimpanan riwayat permainan, framework frontend, dan koneksi internet apa pun.
