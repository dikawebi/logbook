<?php
declare(strict_types=1);

// Konfigurasi lokal. File ini berada di luar document root public/.
return [
    'db_dsn' => 'mysql:host=localhost;dbname=logbook;charset=utf8mb4',
    'db_user' => 'root',
    'db_password' => '',
    'sheet_endpoint' => 'https://script.google.com/macros/s/AKfycbyviVcWtQy5cPsVHDm43zVlGttq2E9cl7Za5kcQ5zku-uSdbqsNeRdBKkGQLKkpXkQ-/exec',
    'sync_secret' => 'k9X2mP7qR4vW8zL1fY3bH6jN5dC0sF2g', // Isi setelah LOGBOOK_SYNC_SECRET disetel di Apps Script.
];
