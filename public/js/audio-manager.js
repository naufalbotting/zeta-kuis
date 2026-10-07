// Zeta Kuis - Pengatur suara layar laptop. HP admin tidak mengeluarkan suara.
// Hanya satu suara boleh bunyi pada satu waktu: play() selalu stopAll() dulu.
// File .mp3 disediakan pengguna; jika belum ada, gagal putar diabaikan.

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
    for (const a of Object.values(this.objek)) { try { a.pause(); a.currentTime = 0; } catch (e) {} }
  },

  play(nama) {
    this.stopAll();
    const a = this.objek[nama];
    if (!a) return;
    a.play().catch(() => {}); // jangan pernah melempar error
  }
};
