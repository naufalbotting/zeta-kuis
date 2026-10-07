# DESAIN.md — Panduan Mempercantik Zeta Kuis

Dokumen ini menjelaskan sistem desain agar kamu bisa mengubah tampilan
tanpa merusak logika. Aturan emas: **boleh ubah CSS seenaknya, jangan
ubah/hapus `id` elemen dan jangan ubah file `js/`** (JS mencari elemen
lewat `id`; kalau `id` hilang, layar rusak).

## 1. Token dasar (`public/css/base.css`, `:root`)

| Token | Sekarang | Fungsi |
|---|---|---|
| `--bg` | `#121212` | latar utama |
| `--bg-2` | `#1a1a1a` | kartu / tombol opsi |
| `--bg-3` | `#2a2a2a` | garis / track timer |
| `--putih` | `#ffffff` | teks utama |
| `--abu-terang` / `--abu` / `--abu-gelap` | `#cfcfcf` / `#888` / `#444` | teks sekunder |
| `--hijau` | `#22c55e` | HANYA untuk BENAR |
| `--merah` | `#ef4444` | HANYA untuk SALAH |
| `--font-judul` | Bebas Neue | angka & judul besar |
| `--font-isi` | Inter | teks biasa |

Cara ganti tema tercepat: ubah 3 token ini saja —
`--bg` (mis. navy `#0a1128`), `--bg-2` (kartu), `--putih` (teks).
Hijau/merah JANGAN dipakai untuk hal lain agar artinya konsisten.

## 2. Peta layar laptop (`public/laptop.html` + `laptop.css`)

| `id` | Isi | Kunci CSS |
|---|---|---|
| `tampilan-idle` | kartu cara main | `.kartu-aturan` |
| `nomor-soal`, `giliran` | info soal & giliran | font + letter-spacing |
| `daftar-opsi` + `.opsi` | 4 tombol A–D (klik + keyboard) | grid 2 kolom; `.huruf` badge; `.teks` wrap |
| `.opsi:hover` | efek saat kursor di atas | **titik utama percantik** |
| `.opsi.terpilih` | opsi yang dikunci | border putih |
| `.opsi.dibuang` | opsi buangan hint | redup + coret |
| `.opsi.benar-opt` / `.salah-opt` | ungkap hasil | hijau / merah |
| `lintasan-bar`, `isi-bar`, `angka-detik` | timer bar + angka | `.mendesak` = denyut 3 detik terakhir |
| `tampilan-tegang` | animasi tegang 3 detik (`???`) | `@keyframes tegang` |
| `teks-hasil` + `.benar`/`.salah` | BENAR!/SALAH!/WAKTU HABIS! | ukuran raksasa |
| `hasil-opsi` | 4 opsi mini saat ungkap | `.opsi.mini` |
| `flash` | kedip fullscreen hijau/merah | JS `kedip()` + `DURASI_FLASH_MS` |
| `cahaya` | cahaya putih ikut kursor | radial-gradient, 300px |
| `tampilan-pemenang` | slot machine + konfeti | `.slot-in`, `.menang` (zoom + emas) |

## 3. Animasi yang tersedia (tinggal poles)

| Animasi | Lokasi | Cara percantik |
|---|---|---|
| Denyut detik akhir | `@keyframes denyut` | tambah `text-shadow` / warna kuning |
| Pulse "Menunggu hasil..." | `@keyframes pulse` | ubah skala / tambah titik-titik animasi |
| Tegang `???` | `@keyframes tegang` | ganti jadi hitung mundur 3-2-1 (JS: `TEGANG_MS`) |
| Slot machine pemenang | `@keyframes slotmasuk` + `putarNama()` | tambah blur / percepat langkah |
| Zoom pemenang | `.menang` | ganti `scale(1.6)` + warna emas |
| Konfeti | `tembakKonfeti()` di `laptop.js` | ubah `warna`, `particleCount`, `durasiMs` |
| Flash benar/salah | `kedip()` + `#flash` | ubah opacity 0.85 / tambah pola |

## 4. Suara (`public/js/audio-manager.js`, file di `public/audio/`)

`start` (soal baru) · `tick` loop (timer) · `drumroll` loop (tegang) ·
`correct` · `wrong` · `roulette` loop (slot) · `fanfare` (menang).
Ganti file `.mp3` dengan nama yang sama untuk ganti suara.
Aturan: hanya 1 suara dalam 1 waktu (`play()` selalu `stopAll()` dulu).

## 5. Panel admin (`public/admin.html` + `admin.css`)

Mobile-first, tombol min 64px. Yang bisa dipoles: `.kartu` (radius/border),
`button.primer` (Mulai), `.opsi-admin.kunci` (kunci hijau), `#modal-hint`
(pilih opsi buangan), `#toast` (peringatan merah).

## 6. Ide cepat biar makin menarik (urut termudah)

1. Background gradasi: `body { background: radial-gradient(...) }`.
2. Opsi hover: `transform: scale(1.03)` + glow `box-shadow: 0 0 24px #fff3`.
3. Timer menipis berubah warna: `#isi-bar` merah saat `.mendesak` (JS tambah class).
4. Huruf badge A–D berwarna (A emas, B biru...) — pecah monokrom, tapi meriah.
5. Tegang 3-2-1 angka besar + drumroll makin cepat (ubah `mulaiTegang`).
6. Skor beranimasi count-up (ubah `renderSkor`).
7. Logo/tim besar di belakang opsi (watermark `opacity: 0.05`).

## 7. Jangan

- Ubah/hapus `id` di HTML tanpa mengubah JS yang memakainya.
- Tampilkan `tanya`/`kunci` di laptop (sengaja disembunyikan; juri yang membacakan).
- Menambah request internet (font/CDN) — semua harus lokal agar cepat.
