<?php
declare(strict_types=1);
require dirname(__DIR__) . '/app/bootstrap.php';

function check(bool $passed, string $message): void {
    if (!$passed) { fwrite(STDERR, "FAILED: $message\n"); exit(1); }
}

check(class_exists(ZipArchive::class), 'ZipArchive tersedia');
$source = file_get_contents(dirname(__DIR__) . '/public/index.php');
$start = strpos($source, 'function xlsxContentTypes');
check($start !== false, 'Helper XLSX ditemukan');
eval(substr($source, $start));

$headers = array_fill(0, 32, 'Text');
$headers[0] = 'Received Date';
$headers[15] = 'DPP Non VAT';
array_splice($headers, 17, 0, 'VAT in multiplier');
$values = array_fill(0, 32, '');
$values[0] = '2026-01-07';
$values[15] = '-1200.50';
array_splice($values, 17, 0, '11%');
$rows = [[...$headers, 'App Status'], [...$values, '=HYPERLINK("https://example.test")']];
$path = tempnam(sys_get_temp_dir(), 'xlsx-validation-');
$zip = new ZipArchive();
check($zip->open($path, ZipArchive::OVERWRITE) === true, 'ZIP dibuat');
$zip->addFromString('[Content_Types].xml', xlsxContentTypes());
$zip->addFromString('_rels/.rels', xlsxRootRelationships());
$zip->addFromString('xl/workbook.xml', xlsxWorkbook());
$zip->addFromString('xl/_rels/workbook.xml.rels', xlsxWorkbookRelationships());
$zip->addFromString('xl/styles.xml', xlsxStyles());
$zip->addFromString('xl/worksheets/sheet1.xml', xlsxWorksheet($rows));
check($zip->close(), 'ZIP ditutup');

$zip = new ZipArchive();
check($zip->open($path) === true && $zip->numFiles === 6, 'XLSX dapat dibuka dan lengkap');
for ($i = 0; $i < $zip->numFiles; $i++) {
    $xml = $zip->getFromIndex($i);
    $document = new DOMDocument();
    check($xml !== false && $document->loadXML($xml), 'XML valid: ' . $zip->getNameIndex($i));
}
$sheet = $zip->getFromName('xl/worksheets/sheet1.xml');
$styles = $zip->getFromName('xl/styles.xml');
check(str_contains($sheet, 'ySplit="1"') && str_contains($sheet, 'autoFilter ref="A1:AH2"'), 'Freeze pane dan filter tersedia');
check(str_contains($sheet, 'r="A2" s="2"><v>46029</v>') && str_contains($sheet, 'r="P2" s="3"><v>-1200.50</v>'), 'Tanggal dan angka bertipe Excel');
check(str_contains($sheet, 's="4" t="inlineStr"'), 'Teks dilindungi dari formula');
check(str_contains($styles, 'rgb="FF17365D"') && str_contains($styles, 'rgb="FFFFFFFF"') && str_contains($styles, '<b/>'), 'Header biru gelap dengan teks putih tebal');
check(str_contains($styles, 'formatCode="yyyy-mm-dd"') && str_contains($styles, 'formatCode="#,##0.00;[Red]-#,##0.00"') && str_contains($styles, 'quotePrefix="1"'), 'Format dan proteksi teks tersedia');
$zip->close();
unlink($path);
echo "XLSX ZIP/XML validation passed.\n";
