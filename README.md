# Logbook PHP + MySQL (shared hosting)

Versi mandiri untuk subdomain, PHP 8.3, MySQL/MariaDB. Browser hanya berbicara ke PHP; **MySQL adalah sumber utama setelah impor**. Tab `IDR`/`USD` tetap menjadi sumber untuk impor awal dan tombol sinkronisasi manual. Transaksi yang pernah diedit/dibatalkan di web **tidak ditimpa** oleh sinkronisasi. Perubahan web tidak dikirim balik ke Google Sheet.

## Struktur

- `public/` — **satu-satunya** folder yang boleh dijadikan document root subdomain.
- `app/bootstrap.php` — login, database, CRUD, dan integrasi Sheet.
- `bin/import.php` — impor awal via SSH.
- `Sync.gs` — endpoint baca Google Sheet pada project Apps Script lama.
- `schema.sql` — skema MySQL.
- `config.php` — dibuat dari `config.example.php` di root project; **jangan taruh di `public/`**.

Tidak membutuhkan Composer, Node.js, maupun service account Google Cloud. Hosting memerlukan ekstensi PHP `pdo_mysql`, `curl`, dan `mbstring`, akses HTTPS, serta izin koneksi keluar ke `script.google.com` dan `script.googleusercontent.com`.

## Menjalankan di localhost (Windows/Laragon)

PHP lokal sudah mendukung `pdo_mysql`, `curl`, dan `mbstring`. Lokasi project: `D:\web\logbook`.

1. Hidupkan **MySQL** dari Laragon. Buat database bernama `logbook` melalui phpMyAdmin; pilih database tersebut dan **Import** file `D:\web\logbook\schema.sql`. Alternatif lewat PowerShell setelah database dibuat:

   ```powershell
   & "C:\laragon\bin\mysql\mysql-8.4.3-winx64\bin\mysql.exe" -u root -p logbook -e "source D:/web/logbook/schema.sql"
   ```

2. Salin `config.example.php` sebagai `config.php` di `D:\web\logbook`. Ubah `db_dsn` menjadi `mysql:host=localhost;dbname=logbook;charset=utf8mb4` dan isi user/password MySQL Laragon. Isi juga URL `/exec` Apps Script dan `sync_secret` yang sama dengan **Script Properties**. Langkah Apps Script ada di bagian 1 di bawah; **jangan taruh rahasia di `public/`**.
3. Setelah `Sync.gs` di-deploy versi baru dan `setupSystem()` telah memberi App ID pada data Sheet, jalankan dari PowerShell:

   ```powershell
   php bin/import.php
   php -S localhost:8000 -t public
   ```

   Jalankan perintah di atas dengan working directory `D:\web\logbook`. Biarkan terminal server tetap terbuka, lalu akses **http://localhost:8000**. Hentikan server dengan `Ctrl+C`.

   Bila impor terhenti karena jaringan, jalankan `php bin/import.php OFFSET_IDR OFFSET_USD` dengan posisi terakhir yang tercetak, misalnya `php bin/import.php 750 0`. Impor aman dilanjutkan: data yang sudah masuk tidak diduplikasi.

Pada PHP built-in server, cookie login diizinkan lewat HTTP hanya untuk development; deployment hosting tetap memerlukan HTTPS. Jika `mysql` tidak dikenali sebagai perintah, gunakan path lengkap di atas atau impor `schema.sql` melalui phpMyAdmin.

## 1. Siapkan Google Apps Script

1. Pada project Apps Script lama yang terhubung ke spreadsheet, tambahkan file script bernama **`Sync`**; salin seluruh isi `Sync.gs`. Jangan mengganti `Code.gs` yang berisi `setupSystem()` dan web app lama.
2. Jalankan `setupSystem()` dari editor jika kolom `App ID` belum dibuat atau untuk memberi ID pada baris tambahan yang dimasukkan langsung di Sheet.
3. Buka **Project Settings → Script Properties**, tambahkan `LOGBOOK_SYNC_SECRET` dengan string acak minimal **32 karakter**. Simpan. Gunakan string **yang sama** di `config.php` hosting. Jangan kirim rahasia tersebut melalui chat.
4. **Deploy → Manage deployments → Edit (ikon pensil) → Version: New version → Deploy**. Pastikan web app tetap **Execute as: Me**, **Who has access: Anyone**. Salin URL `/exec` **tanpa `/u/1`**. Endpoint `doPost` hanya merespons permintaan dengan rahasia yang cocok.
5. Sheet boleh dan sebaiknya kembali **Restricted**; endpoint membaca Sheet dengan izin pemilik deployment.

## 2. Siapkan database dan hosting

1. Buat database MySQL dan user database di panel hosting. Jalankan `schema.sql` melalui phpMyAdmin atau perintah SSH (contoh):

   ```sh
   mysql -u USER_DATABASE -p NAMA_DATABASE < schema.sql
   ```

2. Unggah folder project ke lokasi di luar `public_html`, misalnya `~/logbook/`. Arahkan **document root subdomain** ke `~/logbook/public/`. Hindari menyalin seluruh project langsung ke folder web publik.
3. Salin `config.example.php` menjadi `config.php` di `~/logbook/`. Isi kredensial MySQL, URL Apps Script `/exec` dari langkah 1, dan `sync_secret` yang sama. Atur permission file hanya untuk akun hosting bila memungkinkan.
4. Jalankan impor awal dari root project via SSH:

   ```sh
   php bin/import.php
   ```

   Ini mengimpor pengguna lama dari tab `Pengguna`, transaksi IDR/USD dari baris yang mempunyai `App ID`, dan audit lama dari tab `AuditLog`. Perintah dapat dijalankan ulang; akun yang sudah ada tidak ditimpa dan transaksi yang diedit di web tetap aman.
5. Buka subdomain melalui **HTTPS**. Masuk dengan email `andika.kuswidyarto@borneoprima.com` serta password Apps Script yang lama. Saat login pertama, hash lama dimigrasikan ke hash PHP dan aplikasi meminta Anda mengganti password.

## Pemakaian

- Halaman login dan dashboard mengikuti branding portal Asset Tagging PT Borneo Prima: logo, foto tambang, warna biru, topbar, dan sidebar. File logo/foto ada di `public/images/`.
- Menu **Logbook IDR/USD**: daftar, detail 32 kolom, pencarian umum pada seluruh field, pencarian teks dan dropdown multi-pilih yang dapat dicari pada setiap kolom, sort naik/turun pada setiap judul kolom, filter tanggal/kategori/status, tambah/edit/batal. Urutan dan pencarian tetap berlaku saat berpindah halaman.
- Pilihan dropdown pada kolom yang sama memakai OR (salah satu cocok); antar-kolom memakai AND. Dropdown menampilkan **seluruh nilai unik** yang cocok dengan filter lain; misalnya setelah Category = IT, Vendor Name hanya menampilkan vendor pada transaksi IT. Ketik dalam dropdown untuk menyaring pilihan. Maksimal 30 nilai yang dicentang per kolom.
- Di bawah tabel, pilih **10/25/50/100 baris per halaman** dan centang kolom mana yang ditampilkan. Preferensi tersimpan pada browser; semua kolom tetap tersedia di detail transaksi.
- Tombol **Mode Gelap/Mode Terang** tersedia di login dan aplikasi. Pilihannya tersimpan di browser. Tampilan ponsel menyesuaikan lebar layar; tabel dapat digeser horizontal.
- Pencarian menerima beberapa kata dipisah spasi (semua kata harus cocok). Pada filter kolom semua kata harus berada dalam kolom tersebut; pencarian umum memperbolehkan kata berada di kolom berbeda pada baris yang sama. Frasa berurutan dapat ditulis dalam tanda kutip, contohnya `"PT Borneo" fuel`. Maksimal 8 kata kunci per kotak.
- Tabel menampilkan seluruh 32 kolom berurutan seperti Sheet, dengan scroll horizontal; nominal ditampilkan dengan dua angka desimal. Nama kolom mengikuti header IDR/USD setelah `php bin/refresh_headers.php` dijalankan.
- Menu **Pengguna** (admin): kelola status/role dan password sementara. Password sementara tampil satu kali.
- Password awal untuk akun baru atau akun yang di-reset adalah `password`; login pertama mewajibkan perubahan menjadi password baru minimal 8 karakter.
- Menu **Audit trail**: perubahan aplikasi PHP dan riwayat AuditLog lama yang diimpor.
- Menu **Sinkronisasi** (admin): tekan tombol untuk membaca ulang Sheet dalam beberapa batch. Baris baru masuk; baris yang belum diedit di web diperbarui; baris yang pernah diedit/batal di web dilewati.

**Aturan kerja:** setelah impor awal, lakukan edit transaksi dari web. Jika ada data baru yang masih ditambahkan ke Sheet, jalankan `setupSystem()` di Apps Script agar barisnya memperoleh `App ID`, lalu tekan **Sinkronkan sekarang** di web. Jangan mengedit baris yang sama di kedua tempat jika ingin menghindari kebingungan; nilai web selalu menang setelah diedit.

## Verifikasi lokal

```sh
php tests/smoke.php
php -l app/bootstrap.php
php -l public/index.php
php -l bin/import.php
node --check public/app.js
```

Uji integrasi MySQL, Apps Script, dan subdomain memerlukan kredensial serta akses hosting Anda; `config.php` tidak disertakan di project.

## Pembaruan instalasi yang sudah ada: header Sheet

Untuk database yang dibuat sebelum fitur tampilan 32 kolom, buat tabel tambahan ini **sekali saja** melalui phpMyAdmin atau MySQL:

```sql
CREATE TABLE IF NOT EXISTS sheet_headers (
  currency ENUM('IDR','USD') PRIMARY KEY,
  labels JSON NOT NULL,
  synced_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

Perbarui file `Sync.gs` di Apps Script, deploy **New version**, kemudian jalankan `php bin/refresh_headers.php`. Sampai langkah itu selesai, nama kolom cadangan tetap tampil dan urutan 32 kolom tetap sama. Tidak perlu mengimpor ulang seluruh transaksi.
