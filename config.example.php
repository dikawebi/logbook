<?php
declare(strict_types=1);

// Salin sebagai config.php di folder project (di luar public/). Jangan commit kredensial.
return [
    'db_dsn' => 'mysql:host=localhost;dbname=NAMA_DATABASE;charset=utf8mb4',
    'db_user' => 'USER_DATABASE',
    'db_password' => 'PASSWORD_DATABASE',
    'sheet_endpoint' => 'https://script.google.com/macros/s/DEPLOYMENT_ID/exec',
    'sync_secret' => 'ISI_RAHASIA_PANJANG_MINIMAL_32_KARAKTER',
];
