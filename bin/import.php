<?php
declare(strict_types=1);
require dirname(__DIR__) . '/app/bootstrap.php';
if (PHP_SAPI !== 'cli') exit("Jalankan melalui SSH.\n");
try {
    echo 'Akun baru diimpor: ' . importUsers() . "\n";
    foreach (['IDR', 'USD'] as $currency) {
        $position = $currency === 'IDR' ? 1 : 2;
        $offset = max(0, (int)($argv[$position] ?? 0)); $imported = 0; $skipped = 0;
        do {
            $batch = syncBatch($currency, $offset);
            $offset = $batch['next']; $imported += $batch['imported']; $skipped += $batch['skipped'];
            echo "$currency: $offset/{$batch['total']} diproses\n";
        } while ($offset < $batch['total']);
        echo "$currency selesai: $imported disinkron, $skipped dilewati.\n";
    }
    $offset = 0; $auditCount = 0;
    do {
        $batch = importAuditBatch($offset);
        $offset = $batch['next']; $auditCount += $batch['imported'];
    } while ($offset < $batch['total']);
    echo "Audit lama diimpor: $auditCount\n";
} catch (Throwable $e) {
    fwrite(STDERR, "Gagal: {$e->getMessage()}\n"); exit(1);
}
