# PteroServerPanel

Panel web ringan untuk mengelola **satu server Pterodactyl** melalui Client API. API key disimpan di backend dan tidak dikirim ke browser.

## Fitur
- Login panel dengan cookie HttpOnly dan rate limit percobaan login
- Monitor status, CPU, RAM, disk, dan network
- Start, stop, restart server
- Live console melalui WebSocket Pterodactyl
- Kirim command ke console
- Tampilan responsif untuk desktop dan HP

## Persyaratan
- Node.js 20+
- Pterodactyl Panel yang dapat diakses oleh aplikasi ini
- Client API key dari akun Pterodactyl yang memiliki akses ke server target

## Instalasi lokal / VPS
1. Clone repository.
2. Jalankan `npm install`.
3. Salin `.env.example` menjadi `.env`.
4. Isi seluruh variabel environment.
5. Jalankan `npm start`.
6. Buka `http://localhost:3000`.

Contoh membuat secret sesi acak: `openssl rand -hex 32`.

### Variabel environment
- `PTERO_URL`: URL panel Pterodactyl, tanpa slash di akhir.
- `PTERO_API_KEY`: Client API key (`ptlc_...`), bukan Application API key.
- `PTERO_SERVER_ID`: identifier pendek server, bukan UUID penuh.
- `PANEL_PASSWORD`: password untuk login ke panel web ini, minimal 16 karakter.
- `SESSION_SECRET`: secret HMAC acak, minimal 32 karakter.
- `PORT`: port HTTP aplikasi (default 3000).
- `NODE_ENV`: gunakan `production` saat deployment HTTPS.

Buat Client API key melalui **Account → API Credentials** di Pterodactyl. Jangan pernah commit file `.env`.

## Deployment
Deploy sebagai proses Node.js persisten di VPS/container yang dapat mengakses Pterodactyl. Pasang reverse proxy HTTPS (Nginx/Caddy) dan set `NODE_ENV=production`. Vercel serverless tidak direkomendasikan untuk fitur console WebSocket dan proses server yang persisten.

## Keamanan dan batasan
- Credential Pterodactyl hanya digunakan oleh backend.
- Cookie sesi HttpOnly, SameSite=Strict, dan Secure pada production.
- Login dibatasi 8 percobaan per 15 menit per IP.
- Sesi disimpan dalam memori; restart aplikasi akan mengakhiri sesi. Untuk beberapa instance, gunakan session store bersama seperti Redis.
- Panel ini mengelola satu server yang ditentukan oleh `PTERO_SERVER_ID`; tidak membuat server baru dan tidak mengelola user/admin Pterodactyl.
- Wajib gunakan HTTPS dan batasi akses jaringan ke panel admin.

## Troubleshooting
- **401/403**: cek Client API key dan izin akun Pterodactyl.
- **404 server**: cek identifier server.
- **Console gagal tersambung**: pastikan browser dapat menjangkau alamat WebSocket yang dikembalikan Pterodactyl dan proxy mengizinkan WebSocket.
- **Aplikasi tidak start**: cek semua environment variable dan gunakan Node.js 20 atau lebih baru.
