// Zeta Kuis - Akses penyimpanan state.
// Produksi (Vercel): Upstash Redis via Marketplace integration.
//   Env: UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN
//   (varian lama Vercel KV: KV_REST_API_URL + KV_REST_API_TOKEN juga didukung)
// Lokal (scripts/dev.js): memori proses, cukup untuk uji.

let redis = null;

function dapatRedis() {
  const url = process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  if (!redis) {
    const { Redis } = require('@upstash/redis');
    redis = new Redis({ url: url, token: token });
  }
  return redis;
}

const memori = new Map();

async function baca(kunci) {
  const r = dapatRedis();
  if (r) return await r.get(kunci);
  return memori.has(kunci) ? memori.get(kunci) : null;
}

async function tulis(kunci, nilai) {
  const r = dapatRedis();
  if (r) {
    await r.set(kunci, nilai);
    return;
  }
  memori.set(kunci, nilai);
}

module.exports = { baca, tulis };
