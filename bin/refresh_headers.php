<?php
declare(strict_types=1);
require dirname(__DIR__) . '/app/bootstrap.php';
if (PHP_SAPI !== 'cli') exit("Jalankan melalui SSH atau terminal.\n");
try {
    foreach (['IDR', 'USD'] as $currency) {
        $names = refreshSheetHeaders($currency);
        echo "$currency: " . count($names) . " kolom tersinkronisasi.\n";
    }
} catch (Throwable $e) {
    fwrite(STDERR, "Gagal: {$e->getMessage()}\n"); exit(1);
}
