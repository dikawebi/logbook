<?php
declare(strict_types=1);
require dirname(__DIR__) . '/app/bootstrap.php';

function check(bool $passed, string $message): void {
    if (!$passed) { fwrite(STDERR, "FAILED: $message\n"); exit(1); }
}

check(legacyVerify('secret-old', 'v2$3000$test-salt$kL7M3lpk1NM_zKa92rl0DbCeH5xoLov2PLvQlXBC3C0='), 'Migrasi hash GAS v2');
check(!legacyVerify('wrong', 'v2$3000$test-salt$kL7M3lpk1NM_zKa92rl0DbCeH5xoLov2PLvQlXBC3C0='), 'Password salah ditolak');
check(legacyVerify('secret-old', base64_encode(hash('sha256', 'secret-old', true))), 'Migrasi hash GAS lama');
check(isoDate('2 Jul 26') === '2026-07-02', 'Tanggal teks dari sheet');
check(isoDate('2026-02-30') === null, 'Tanggal tidak valid ditolak');
$data = array_fill(0, 32, '');
$data[0] = '7-Jan-26'; $data[4] = 'Vendor A'; $data[5] = 'INV-1';
$data[24] = '(480,000)'; $data[25] = '1,200.50';
$normalized = normalizeImported($data);
check($normalized[0] === '2026-01-07' && $normalized[24] === '-480000' && $normalized[25] === '1200.50', 'Normalisasi Sheet');
check(cleanRecord($normalized)[5] === 'INV-1', 'Data valid dapat diedit');
$idr = array_fill(0, 32, '');
$idr[4] = 'Vendor A'; $idr[5] = 'INV-IDR'; $idr[6] = '2026-01-07'; $idr[12] = 'Fuel'; $idr[15] = '100'; $idr[16] = '200'; $idr[18] = '3'; $idr[19] = '4'; $idr[20] = '5'; $idr[21] = '6'; $idr[24] = '-10'; $idr[26] = '30';
$idr = applyRecordFormulas($idr, 'IDR');
check($idr[13] === 'INV-IDR; Fuel' && $idr[17] === '22' && $idr[22] === '340' && $idr[25] === '330' && $idr[27] === '2026-02-06', 'Formula IDR');
check(inferVatMultiplier(array_replace($idr, [5 => 'INV-T/1272/BAS/X/25', 16 => '100000', 17 => '1100'])) === 0.011, 'VAT historis 1.1% terdeteksi');
check(applyRecordFormulas($idr, 'IDR', 0.011)[17] === '2', 'VAT dihitung dengan multiplier lokal');
check(recordColumns($idr)[1] === '2026-02-06', 'Due date tersimpan untuk query overdue');
$usd = array_fill(0, 32, '');
$usd[4] = 'Vendor B'; $usd[5] = 'INV-USD'; $usd[6] = '2026-01-07'; $usd[12] = 'Service'; $usd[14] = '2%'; $usd[15] = '100'; $usd[16] = '50'; $usd[26] = '14';
$usd = applyRecordFormulas($usd, 'USD');
check($usd[13] === 'INV-USD; Vendor B; Service' && $usd[17] === '6' && $usd[22] === '100' && $usd[24] === '-3' && $usd[25] === '97' && $usd[27] === '2026-01-21', 'Formula USD');
echo "Checks passed: password migration, date validation, Sheet normalization, VAT multiplier formulas, and due-date persistence.\n";
