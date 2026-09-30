<?php
declare(strict_types=1);
require dirname(__DIR__) . '/app/bootstrap.php';

function matches(array $filters): int {
    [$where, $params] = recordSearch($filters);
    $stmt = db()->prepare('SELECT COUNT(*) FROM transactions WHERE ' . $where);
    $stmt->execute($params);
    return (int)$stmt->fetchColumn();
}

function sortedResult(array $filters): array {
    [$where, $params] = recordSearch($filters);
    $stmt = db()->prepare('SELECT id FROM transactions WHERE ' . $where . ' ORDER BY ' . recordOrder($filters) . ' LIMIT 3');
    $stmt->execute($params);
    return $stmt->fetchAll(PDO::FETCH_COLUMN);
}

if (matches(['currency' => 'IDR']) < 1) throw new RuntimeException('Impor IDR belum tersedia.');
$row = db()->query("SELECT data FROM transactions WHERE currency='IDR' AND vendor<>'' AND invoice<>'' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$[3]')), '')<>'' LIMIT 1")->fetchColumn();
$data = json_decode($row, true, flags: JSON_THROW_ON_ERROR);
$vendor = (string)$data[4];
$vendorCode = (string)$data[3];
$invoice = (string)$data[5];
if (matches(['currency' => 'IDR', 'c4' => $vendor]) < 1) throw new RuntimeException('Pencarian kolom Vendor gagal.');
if (matches(['currency' => 'IDR', 'keyword' => $vendor]) < 1) throw new RuntimeException('Pencarian semua field gagal.');
if (searchWords('"PT Borneo" fuel') !== ['PT Borneo', 'fuel']) throw new RuntimeException('Parser frasa gagal.');
if (matches(['currency' => 'IDR', 'keyword' => '"' . $vendor . '" "' . $invoice . '"']) < 1) {
    throw new RuntimeException('Pencarian multi-kata pada kolom berbeda gagal.');
}
if (matches(['currency' => 'IDR', 'c4' => '"' . $vendor . '"']) < 1) throw new RuntimeException('Pencarian frasa di kolom Vendor gagal.');
if (matches(['currency' => 'IDR', 'c4' => '"' . $vendor . '" tidak-mungkin-987654321']) !== 0) {
    throw new RuntimeException('Multi-kata pada kolom harus memakai aturan AND.');
}
if (matches(['currency' => 'IDR', 'keyword' => '"' . $vendor . '" tidak-mungkin-987654321']) !== 0) {
    throw new RuntimeException('Multi-kata global harus memakai aturan AND.');
}
if (matches(['currency' => 'IDR', 'c4' => 'tidak-mungkin-ada-ini-987654321']) !== 0) throw new RuntimeException('Filter kolom salah.');
if (matches(['currency' => 'IDR', 's4' => json_encode([$vendor, 'vendor-tidak-ada-987654321'])]) < 1) {
    throw new RuntimeException('Multi-pilihan OR dalam kolom Vendor gagal.');
}
if (matches(['currency' => 'IDR', 's4' => json_encode([$vendor]), 's5' => json_encode([$invoice])]) < 1) {
    throw new RuntimeException('Multi-pilihan AND antar kolom gagal.');
}
if (matches(['currency' => 'IDR', 's4' => json_encode([$vendor]), 's5' => json_encode(['invoice-tidak-ada-987654321'])]) !== 0) {
    throw new RuntimeException('Dropdown antar kolom harus memakai aturan AND.');
}
if (matches(['currency' => 'IDR', 's4' => json_encode([$vendor]), 'c4' => 'tidak-mungkin-987654321']) !== 0) {
    throw new RuntimeException('Dropdown dan pencarian teks harus dapat dikombinasikan.');
}
$options = distinctOptions('IDR', '4', $vendor);
if (!in_array($vendor, $options['values'], true)) throw new RuntimeException('Dropdown Vendor tidak menemukan nilai yang dicari.');
$vendorPairs = vendorOptions('IDR', $vendorCode, '', '');
if (!in_array($vendor, array_column($vendorPairs['pairs'], 'name'), true)) throw new RuntimeException('Vendor Name harus mengikuti Vendor Code.');
$vendorPairs = vendorOptions('IDR', '', $vendor, '');
if (!in_array($vendorCode, array_column($vendorPairs['pairs'], 'code'), true)) throw new RuntimeException('Vendor Code harus mengikuti Vendor Name.');
$uniqueVendor = db()->query("SELECT MIN(JSON_UNQUOTE(JSON_EXTRACT(data, '$[3]'))) AS code, JSON_UNQUOTE(JSON_EXTRACT(data, '$[4]')) AS name FROM transactions WHERE currency='IDR' AND cancelled=0 AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$[3]')), '')<>'' AND COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$[4]')), '')<>'' GROUP BY name HAVING COUNT(DISTINCT JSON_UNQUOTE(JSON_EXTRACT(data, '$[3]')))=1 LIMIT 1")->fetch();
if ($uniqueVendor) {
    $codes = array_values(array_unique(array_column(vendorOptions('IDR', '', (string)$uniqueVendor['name'], '')['pairs'], 'code')));
    if ($codes !== [(string)$uniqueVendor['code']]) throw new RuntimeException('Pasangan Vendor Name ke Vendor Code tidak tepat.');
}
$expectedStatuses = db()->query("SELECT DISTINCT CASE WHEN cancelled=1 THEN 'Dibatalkan' ELSE 'Aktif' END FROM transactions WHERE currency='IDR' ORDER BY 1")->fetchAll(PDO::FETCH_COLUMN);
if (distinctOptions('IDR', 'status')['values'] !== $expectedStatuses) throw new RuntimeException('Dropdown App Status harus mengikuti data yang tersedia.');
if (matches(['currency' => 'IDR', 'sStatus' => json_encode(['Aktif', 'Dibatalkan'])]) !== matches(['currency' => 'IDR'])) {
    throw new RuntimeException('Multi-pilihan App Status gagal.');
}
$allInvoices = (int)db()->query("SELECT COUNT(DISTINCT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$[5]')), '')) FROM transactions WHERE currency='IDR'")->fetchColumn();
if (count(distinctOptions('IDR', '5')['values']) !== $allInvoices || $allInvoices <= 50) {
    throw new RuntimeException('Dropdown belum menampilkan seluruh nilai unik invoice.');
}
$category = (string)db()->query("SELECT category FROM transactions WHERE currency='IDR' AND category<>'' LIMIT 1")->fetchColumn();
$vendorsForCategory = distinctOptions('IDR', '4', '', ['category' => $category]);
if (!in_array($vendor, distinctOptions('IDR', '4')['values'], true)) throw new RuntimeException('Opsi Vendor sumber gagal.');
$expected = db()->prepare("SELECT DISTINCT COALESCE(JSON_UNQUOTE(JSON_EXTRACT(data, '$[4]')), '') FROM transactions WHERE currency='IDR' AND category=?");
$expected->execute([$category]);
if (count($vendorsForCategory['values']) !== count($expected->fetchAll(PDO::FETCH_COLUMN))) {
    throw new RuntimeException('Dropdown Vendor tidak mengikuti filter kategori.');
}
if ($vendorsForCategory !== distinctOptions('IDR', '4', '', ['category' => $category, 's4' => json_encode(['tidak-ada'])])) {
    throw new RuntimeException('Dropdown harus mengabaikan pilihan kolomnya sendiri.');
}
try { chosenValues(['s4' => json_encode(array_fill(0, 31, 'x'))], 's4'); throw new RuntimeException('Batas pilihan dropdown tidak diterapkan.'); }
catch (DomainException) {}
foreach (['0', '4', '16', '25', '31', 'status'] as $sort) {
    foreach (['ASC', 'DESC'] as $direction) {
        if (count(sortedResult(['currency' => 'IDR', 'sort' => $sort, 'direction' => $direction])) < 1) throw new RuntimeException('Sort gagal: ' . $sort);
    }
}
try { recordOrder(['sort' => '32']); throw new RuntimeException('Sort ilegal tidak ditolak.'); }
catch (DomainException) {}
echo "Checks passed: pencarian multi-kata, dropdown tanpa batas, cascading kategori-vendor, OR/AND, serta sort.\n";
