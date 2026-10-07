# Deploy Zeta Kuis ke Vercel via GitHub

Arsitektur: frontend statis + 2 API serverless (`api/state.js`, `api/aksi.js`)
+ Upstash Redis (state permainan). Tanpa Socket.IO: layar polling tiap 1 detik.
Jawaban terkirim saat ENTER (live-typing dibuang sesuai keputusan).

## 1. Push ke GitHub (sekali saja)

```bash
cd D:\zeta-kuis
git init
git add -A
git commit -m "Zeta Kuis versi Vercel"
git branch -M main
git remote add origin https://github.com/naufalbotting/zeta-kuis.git
git push -u origin main
```
Saat diminta login: pakai Personal Access Token
(GitHub → Settings → Developer settings → Tokens), bukan password.

## 2. Buat Redis (sekali saja)

1. Buka vercel.com/marketplace → cari **Upstash Redis** → Add Integration.
2. Pilih akun + project `zeta-kuis` (atau buat saat import di langkah 3,
   lalu kembali ke sini dan hubungkan ke project itu).
3. Setelah terhubung, env `UPSTASH_REDIS_REST_URL` +
   `UPSTASH_REDIS_REST_TOKEN` terisi otomatis di project.

## 3. Import project di Vercel (sekali saja)

1. vercel.com/new → Import `naufalbotting/zeta-kuis`.
2. Framework Preset: **Other**. Biarkan build command kosong.
3. Deploy. Jadi: `https://zeta-kuis.vercel.app/`
   (laptop) dan `https://zeta-kuis.vercel.app/admin` (HP juri).

## 4. Domain sendiri (nanti, oleh kamu)

Vercel → project → Settings → Domains → tambah domainmu.

## 5. Uji lokal (opsional)

Tanpa Redis pun bisa (pakai memori, data hilang saat restart):

```bash
npm install
npm run dev    # terminal 1 -> http://localhost:3000/
npm run uji    # terminal 2 -> 21 cek otomatis
```

## Catatan operasional

- Polling 1 detik: kuota irit (teks kecil, tanpa gambar/video).
- Timer jalan lokal di tiap layar dari timestamp server; selisih <1 detik wajar.
- Satu permainan = satu state global. Jangan jalankan 2 lomba
  bersamaan di deploy yang sama.
- Kalau layar macet di "Memeriksa..." padahal juri sudah menilai:
  refresh halaman (polling pulih otomatis dari Redis).
