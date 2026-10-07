// Zeta Kuis - Akses penyimpanan state.
// Produksi (Vercel): Upstash Redis / Vercel KV via integration.
//   Nama env yang didukung (prioritas dari atas):
//   URL:   UPSTASH_REDIS_REST_URL, KV_REST_API_URL, ZETA_KUIS_KV_REST_API_URL
//   Token: UPSTASH_REDIS_REST_TOKEN, KV_REST_API_TOKEN, ZETA_KUIS_KV_REST_API_TOKEN
//   (token read-only TIDAK dipakai: state butuh tulis)
// Lokal (scripts/dev.js): memori proses, cukup untuk uji.
// Di deploy Vercel tanpa Redis: GAGAL KERAS dengan pesan jelas (bukan diam
// pakai memori yang bikin split-brain antar instance).
let redis = null;

const NAMA_URL = ['UPSTASH_REDIS_REST_URL', 'KV_REST_API_URL', 'ZETA_KUIS_KV_REST_API_URL'];
const NAMA_TOKEN = ['UPSTASH_REDIS_REST_TOKEN', 'KV_REST_API_TOKEN', 'ZETA_KUIS_KV_REST_API_TOKEN'];

function bacaEnv(daftar) {
  for (const n of daftar) {
    const v = String(process.env[n] || '').trim();
    if (v) return v;
  }
  return '';
}

function dapatRedis() {
  const url = bacaEnv(NAMA_URL);
  const token = bacaEnv(NAMA_TOKEN);
  if (!url || !token) return null;
  if (!redis) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({ url: url, token: token });
  }
  return redis;
}

function diVercel() {
  return process.env.VERCEL === '1';
}

function galatRedis() {
  const e = new Error('NO_REDIS');
  e.kode = 'NO_REDIS';
  return e;
}

const memori = new Map();

async function baca(kunci) {
  const r = dapatRedis();
  if (r) return await r.get(kunci);
  if (diVercel()) throw galatRedis();
  return memori.has(kunci) ? memori.get(kunci) : null;
}

async function tulis(kunci, nilai) {
  const r = dapatRedis();
  if (r) {
    await r.set(kunci, nilai);
    return;
  }
  if (diVercel()) throw galatRedis();
  memori.set(kunci, nilai);
}

const PESAN_REDIS = 'Redis belum terhubung. Tambahkan integrasi Upstash Redis ke project ini lalu Redeploy.';

module.exports = { baca, tulis, PESAN_REDIS };
