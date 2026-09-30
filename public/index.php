<?php
declare(strict_types=1);
require dirname(__DIR__) . '/app/bootstrap.php';

$logDirectory = dirname(__DIR__) . '/var';
if (!is_dir($logDirectory)) @mkdir($logDirectory, 0770, true);
ini_set('display_errors', '0');
ini_set('error_log', $logDirectory . '/php-errors.log');
startSession();
$_SESSION['csrf'] ??= bin2hex(random_bytes(32));
header('X-Content-Type-Options: nosniff');
header('Referrer-Policy: same-origin');
header('Cache-Control: no-store');

if (($_GET['api'] ?? '') === '') {
    header('Content-Type: text/html; charset=UTF-8');
    $csrf = htmlspecialchars($_SESSION['csrf'], ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    $styleVersion = (string)filemtime(__DIR__ . '/style.css');
    $scriptVersion = (string)filemtime(__DIR__ . '/app.js');
    echo '<!doctype html><html lang="id"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        . '<meta name="csrf-token" content="' . $csrf . '"><link rel="icon" type="image/svg+xml" href="/images/logo-bp.svg"><title>Logbook Accounting</title>'
        . '<script>try{document.documentElement.dataset.theme=localStorage.getItem("logbook-theme")==="dark"?"dark":"light"}catch(e){document.documentElement.dataset.theme="light"}</script>'
        . '<link rel="stylesheet" href="/style.css?v=' . $styleVersion . '"></head>'
        . '<body><div id="app">Memuat...</div><div id="toast" role="alert"></div><dialog id="dialog"><div id="dialog-body"></div></dialog><script src="/app.js?v=' . $scriptVersion . '" defer></script></body></html>';
    exit;
}

if (($_GET['api'] ?? '') === 'export') {
    try {
        exportRecords();
    } catch (Throwable $error) {
        http_response_code(400);
        header('Content-Type: text/plain; charset=UTF-8');
        echo 'Export gagal.';
    }
    exit;
}

header('Content-Type: application/json; charset=UTF-8');
try {
    $action = (string)$_GET['api'];
    $post = $_SERVER['REQUEST_METHOD'] === 'POST';
    if ($post) csrf();
    $body = $post ? json_decode(file_get_contents('php://input'), true, flags: JSON_THROW_ON_ERROR) : [];
    if ($post && !is_array($body)) throw new DomainException('Data permintaan tidak valid.');
    $result = match ($action) {
        'session' => publicUser(me(true)),
        'login' => $post ? loginUser((string)($body['email'] ?? ''), (string)($body['password'] ?? '')) : throw new DomainException('Metode tidak valid.'),
        'logout' => $post ? (function (): bool { me(true); $_SESSION = []; session_destroy(); return true; })() : throw new DomainException('Metode tidak valid.'),
        'password' => $post ? (function () use ($body): bool { changePassword((string)($body['old'] ?? ''), (string)($body['new'] ?? '')); return true; })() : throw new DomainException('Metode tidak valid.'),
        'list' => listRecords(),
        'dashboard' => dashboardData(),
        'options' => (function (): array {
            me();
            $raw = (string)($_GET['filters'] ?? '{}');
            if (strlen($raw) > 65536) throw new DomainException('Filter terlalu panjang.');
            $filters = json_decode($raw, true);
            if (!is_array($filters)) throw new DomainException('Filter dropdown tidak valid.');
            return distinctOptions((string)($_GET['currency'] ?? ''), (string)($_GET['column'] ?? ''), (string)($_GET['q'] ?? ''), $filters);
        })(),
        'vendors' => (function (): array {
            me();
            return vendorOptions((string)($_GET['currency'] ?? ''), (string)($_GET['code'] ?? ''), (string)($_GET['name'] ?? ''), (string)($_GET['q'] ?? ''));
        })(),
        'save' => $post ? ['id' => saveRecord((string)($body['currency'] ?? ''), (string)($body['id'] ?? ''), (array)($body['data'] ?? []), $body['vatMultiplier'] ?? 0.11)] : throw new DomainException('Metode tidak valid.'),
        'cancel' => $post ? (function () use ($body): bool { cancelRecord((string)($body['currency'] ?? ''), (string)($body['id'] ?? '')); return true; })() : throw new DomainException('Metode tidak valid.'),
        'audit' => auditList(),
        'users' => usersList(),
        'add-user' => $post ? addUser((string)($body['email'] ?? '')) : throw new DomainException('Metode tidak valid.'),
        'user-status' => $post ? updateUser((string)($body['email'] ?? ''), 'status', (string)($body['value'] ?? '')) : throw new DomainException('Metode tidak valid.'),
        'user-role' => $post ? updateUser((string)($body['email'] ?? ''), 'role', (string)($body['value'] ?? '')) : throw new DomainException('Metode tidak valid.'),
        'reset-user' => $post ? resetUser((string)($body['email'] ?? '')) : throw new DomainException('Metode tidak valid.'),
        'sync' => $post ? (function () use ($body): array {
            $actor = admin();
            try {
                set_time_limit(0);
                $currency = (string)($body['currency'] ?? '');
                $offset = (int)($body['offset'] ?? 0);
                $result = syncBatch($currency, $offset);
                audit($actor['email'], $currency, '', 'SYNC_BATCH', 'imported/skipped', '', $result['imported'] . '/' . $result['skipped']);
                return $result;
            } catch (Throwable $error) {
                logSyncError((string)($body['currency'] ?? '') . ' offset ' . (string)($body['offset'] ?? 0) . ': ' . $error->getMessage());
                throw new DomainException('Sinkronisasi gagal. Periksa log sinkronisasi.');
            }
        })() : throw new DomainException('Metode tidak valid.'),
        'sync-settings' => syncSettings(),
        'save-sync-settings' => $post ? updateSyncSettings((string)($body['sheetEndpoint'] ?? ''), (string)($body['syncSecret'] ?? '')) : throw new DomainException('Metode tidak valid.'),
        'sync-errors' => syncErrorLog(),
        'clear-sync-errors' => $post ? (function (): bool { admin(); clearSyncErrorLog(); return true; })() : throw new DomainException('Metode tidak valid.'),
        'purge-transactions' => $post ? purgeTransactions() : throw new DomainException('Metode tidak valid.'),
        'sync-snapshot' => $post ? (function () use ($body): array {
            $actor = admin();
            $currency = (string)($body['currency'] ?? '');
            try {
                set_time_limit(0);
                $result = syncSnapshot($currency);
                audit($actor['email'], $currency, '', 'SYNC_SNAPSHOT', 'imported/skipped', '', $result['imported'] . '/' . $result['skipped']);
                return $result;
            } catch (Throwable $error) {
                logSyncError($currency . ' snapshot: ' . $error->getMessage());
                throw new DomainException('Download snapshot atau impor lokal gagal. Periksa log sinkronisasi.');
            }
        })() : throw new DomainException('Metode tidak valid.'),
        default => throw new DomainException('Endpoint tidak dikenal.'),
    };
    echo json_encode(['ok' => true, 'data' => $result], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
} catch (Throwable $error) {
    $expected = $error instanceof DomainException;
    http_response_code($expected ? 400 : 500);
    echo json_encode(['ok' => false, 'error' => $expected ? $error->getMessage() : 'Kesalahan server. Periksa log PHP.'], JSON_UNESCAPED_UNICODE);
    if (!$expected) error_log((string)$error);
}

function listRecords(): array {
    me();
    $currency = (string)($_GET['currency'] ?? 'IDR');
    $page = min(100000, max(1, (int)($_GET['page'] ?? 1)));
    $requestedPerPage = (string)($_GET['perPage'] ?? 'all');
    if ($requestedPerPage !== 'all' && !in_array((int)$requestedPerPage, [10, 25, 50, 100, 200, 300, 400, 500, 1000], true)) throw new DomainException('Jumlah baris per halaman tidak valid.');
    [$clause, $params] = recordSearch($_GET);
    $order = recordOrder($_GET);
    $stmt = db()->prepare('SELECT COUNT(*) FROM transactions WHERE ' . $clause);
    $stmt->execute($params); $total = (int)$stmt->fetchColumn();
    $perPage = $requestedPerPage === 'all' ? max(1, $total) : (int)$requestedPerPage;
    $pages = max(1, (int)ceil($total / $perPage));
    $page = $requestedPerPage === 'all' ? 1 : min($page, $pages);
    $stmt = db()->prepare("SELECT id,currency,data,vat_multiplier,received_date,due_date,vendor,invoice,description,category,payment_status,cancelled,\n        (cancelled=0 AND payment_status<>'paid' AND due_date<CURDATE()) AS overdue,\n        CASE WHEN cancelled=0 AND payment_status<>'paid' AND due_date<CURDATE() THEN DATEDIFF(CURDATE(), due_date) ELSE 0 END AS overdue_days\n        FROM transactions WHERE "
        . $clause . ' ORDER BY ' . $order . ' LIMIT ' . $perPage . ' OFFSET ' . (($page - 1) * $perPage));
    $stmt->execute($params);
    $rows = array_map(static function (array $row): array {
        $row['data'] = json_decode($row['data'], true);
        $row['vatMultiplier'] = validVatMultiplier($row['vat_multiplier']);
        $row['data'] = applyVatPrepaid($row['data'], $row['vatMultiplier']);
        $row['cancelled'] = (bool)$row['cancelled'];
        $row['overdue'] = (bool)$row['overdue'];
        $row['overdueDays'] = (int)$row['overdue_days'];
        return $row;
    }, $stmt->fetchAll());
    $categories = db()->prepare("SELECT DISTINCT category FROM transactions WHERE currency=? AND category<>'' ORDER BY category LIMIT 500");
    $categories->execute([$currency]);
    return ['rows' => $rows, 'total' => $total, 'page' => $page, 'pages' => $pages, 'perPage' => $requestedPerPage,
        'categories' => $categories->fetchAll(PDO::FETCH_COLUMN), 'names' => sheetColumnNames($currency)];
}

function exportRecords(): void {
    $currency = (string)($_GET['currency'] ?? 'IDR');
    // Reuse the listing query so exported rows exactly match the visible table page.
    $records = listRecords();
    $filename = 'logbook-' . $currency . '-' . date('Ymd-His') . '.xlsx';
    header('Content-Type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    header('Content-Disposition: attachment; filename="' . $filename . '"');
    $names = $records['names']; array_splice($names, 17, 0, 'VAT in multiplier');
    $rows = [[...$names, 'App Status']];
    foreach ($records['rows'] as $row) {
        $data = array_pad((array)$row['data'], 32, '');
        if ($row['cancelled']) $data[30] = 'Invoice Cancel';
        array_splice($data, 17, 0, $row['vatMultiplier'] === 0.011 ? '1.1%' : '11%');
        $rows[] = [...$data, $row['cancelled'] ? 'Dibatalkan' : 'Aktif'];
    }
    xlsxExport($rows, $filename);
}

function xlsxExport(array $rows, string $filename): void {
    if (!class_exists(ZipArchive::class)) throw new RuntimeException('Ekstensi PHP ZipArchive tidak tersedia.');
    $path = tempnam(sys_get_temp_dir(), 'logbook-xlsx-');
    if ($path === false) throw new RuntimeException('File ekspor tidak dapat dibuat.');
    try {
        $zip = new ZipArchive();
        if ($zip->open($path, ZipArchive::OVERWRITE) !== true) throw new RuntimeException('Workbook tidak dapat dibuat.');
        $zip->addFromString('[Content_Types].xml', xlsxContentTypes());
        $zip->addFromString('_rels/.rels', xlsxRootRelationships());
        $zip->addFromString('xl/workbook.xml', xlsxWorkbook());
        $zip->addFromString('xl/_rels/workbook.xml.rels', xlsxWorkbookRelationships());
        $zip->addFromString('xl/styles.xml', xlsxStyles());
        $zip->addFromString('xl/worksheets/sheet1.xml', xlsxWorksheet($rows));
        if (!$zip->close()) throw new RuntimeException('Workbook tidak dapat diselesaikan.');
        readfile($path);
    } finally {
        if (is_file($path)) unlink($path);
    }
}

function xlsxContentTypes(): string {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>';
}

function xlsxRootRelationships(): string {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>';
}

function xlsxWorkbook(): string {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Logbook" sheetId="1" r:id="rId1"/></sheets></workbook>';
}

function xlsxWorkbookRelationships(): string {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>';
}

function xlsxStyles(): string {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="yyyy-mm-dd"/><numFmt numFmtId="165" formatCode="#,##0.00;[Red]-#,##0.00"/></numFmts><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><color rgb="FFFFFFFF"/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF17365D"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellStyleXfs><cellXfs count="5"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0" quotePrefix="1"/></cellXfs></styleSheet>';
}

function xlsxWorksheet(array $rows): string {
    $columnCount = count($rows[0] ?? []);
    $lastColumn = xlsxColumnName($columnCount);
    $xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft" activeCell="A2" sqref="A2"/></sheetView></sheetViews><cols>';
    foreach ($rows[0] ?? [] as $index => $header) {
        $sheetColumn = $index < 17 ? $index + 1 : ($index === 17 ? 0 : ($index === 33 ? 0 : $index));
        $width = $sheetColumn > 0 && in_array($sheetColumn, DATE_COLUMNS, true) ? 13 : ($sheetColumn > 0 && in_array($sheetColumn, NUMBER_COLUMNS, true) ? 16 : min(36, max(12, mb_strlen((string)$header) + 3)));
        $number = $index + 1;
        $xml .= '<col min="' . $number . '" max="' . $number . '" width="' . $width . '" customWidth="1"/>';
    }
    $xml .= '</cols><sheetData>';
    foreach ($rows as $rowIndex => $row) {
        $xml .= '<row r="' . ($rowIndex + 1) . '">';
        foreach ($row as $columnIndex => $value) {
            $ref = xlsxColumnName($columnIndex + 1) . ($rowIndex + 1);
            if ($rowIndex === 0) $xml .= xlsxTextCell($ref, (string)$value, 1);
            else {
                $sheetColumn = $columnIndex < 17 ? $columnIndex + 1 : ($columnIndex === 17 || $columnIndex === 33 ? 0 : $columnIndex);
                if ($sheetColumn > 0 && in_array($sheetColumn, DATE_COLUMNS, true) && isoDate((string)$value)) $xml .= '<c r="' . $ref . '" s="2"><v>' . xlsxDateSerial((string)$value) . '</v></c>';
                elseif ($sheetColumn > 0 && in_array($sheetColumn, NUMBER_COLUMNS, true) && is_numeric(str_replace(',', '', (string)$value))) $xml .= '<c r="' . $ref . '" s="3"><v>' . htmlspecialchars(str_replace(',', '', (string)$value), ENT_XML1, 'UTF-8') . '</v></c>';
                else $xml .= xlsxTextCell($ref, (string)$value, 4);
            }
        }
        $xml .= '</row>';
    }
    return $xml . '</sheetData><autoFilter ref="A1:' . $lastColumn . max(1, count($rows)) . '"/></worksheet>';
}

function xlsxTextCell(string $reference, string $value, int $style): string {
    return '<c r="' . $reference . '" s="' . $style . '" t="inlineStr"><is><t' . (preg_match('/^\s|\s$/u', $value) ? ' xml:space="preserve"' : '') . '>' . htmlspecialchars($value, ENT_XML1 | ENT_SUBSTITUTE, 'UTF-8') . '</t></is></c>';
}

function xlsxDateSerial(string $date): int {
    return (int)((strtotime($date . ' UTC') - strtotime('1899-12-30 UTC')) / 86400);
}

function xlsxColumnName(int $number): string {
    $name = '';
    while ($number > 0) { $number--; $name = chr(65 + ($number % 26)) . $name; $number = intdiv($number, 26); }
    return $name;
}

function dashboardData(): array {
    me();
    $rows = db()->query("SELECT currency, COUNT(*) AS total,
        SUM(cancelled=0 AND payment_status='paid') AS paid,
        SUM(cancelled=0 AND payment_status<>'paid') AS unpaid,
        SUM(cancelled=0 AND payment_status='') AS blank,
        SUM(cancelled=1) AS cancelled,
        SUM(cancelled=0 AND payment_status<>'paid' AND due_date<CURDATE()) AS overdue
        FROM transactions GROUP BY currency")->fetchAll();
    $result = [
        'IDR' => ['total' => 0, 'paid' => 0, 'unpaid' => 0, 'blank' => 0, 'cancelled' => 0, 'overdue' => 0],
        'USD' => ['total' => 0, 'paid' => 0, 'unpaid' => 0, 'blank' => 0, 'cancelled' => 0, 'overdue' => 0],
    ];
    foreach ($rows as $row) {
        foreach (['total', 'paid', 'unpaid', 'blank', 'cancelled', 'overdue'] as $key) $result[$row['currency']][$key] = (int)$row[$key];
    }
    return $result;
}

function auditList(): array {
    me(); $page = min(100000, max(1, (int)($_GET['page'] ?? 1)));
    $total = (int)db()->query('SELECT COUNT(*) FROM audit_logs')->fetchColumn();
    $rows = db()->query("SELECT happened_at,email,currency,record_id,action,column_name,old_value,new_value,
        invoice_snapshot AS invoice, vendor_snapshot AS vendor, invoice_date_snapshot AS invoice_date
        FROM audit_logs
        ORDER BY id DESC LIMIT 50 OFFSET " . (($page - 1) * 50))->fetchAll();
    return ['rows' => $rows, 'total' => $total, 'page' => $page, 'pages' => max(1, (int)ceil($total / 50))];
}

function usersList(): array {
    admin();
    return array_map(static function (array $user): array {
        $user['active'] = (bool)$user['active'];
        $user['must_change'] = (bool)$user['must_change'];
        return $user;
    }, db()->query('SELECT email,role,active,must_change FROM users ORDER BY email')->fetchAll());
}

function addUser(string $email): array {
    $actor = admin(); $email = mb_strtolower(trim($email));
    if (!filter_var($email, FILTER_VALIDATE_EMAIL)) throw new DomainException('Email tidak valid.');
    $password = 'password';
    try {
        db()->prepare("INSERT INTO users (email,password_hash,role,active,must_change) VALUES (?,?,'USER',1,1)")->execute([$email, password_hash($password, PASSWORD_DEFAULT)]);
    } catch (PDOException $e) {
        if ($e->getCode() === '23000') throw new DomainException('Email sudah terdaftar.');
        throw $e;
    }
    audit($actor['email'], '', $email, 'USER_CREATED', 'email', '', $email);
    return ['email' => $email, 'temporaryPassword' => $password];
}

function updateUser(string $email, string $field, string $value): bool {
    $actor = admin(); $email = mb_strtolower(trim($email));
    if ($field === 'status') {
        if (!in_array($value, ['0', '1'], true) || ($email === $actor['email'] && $value === '0')) throw new DomainException('Status pengguna tidak valid.');
        $column = 'active'; $new = $value;
    } else {
        if (!in_array($value, ['ADMIN', 'USER'], true) || ($email === $actor['email'] && $value !== 'ADMIN')) throw new DomainException('Role pengguna tidak valid.');
        $column = 'role'; $new = $value;
    }
    $stmt = db()->prepare('SELECT ' . $column . ' FROM users WHERE email=?'); $stmt->execute([$email]);
    $old = $stmt->fetchColumn();
    if ($old === false) throw new DomainException('Pengguna tidak ditemukan.');
    db()->prepare('UPDATE users SET ' . $column . '=? WHERE email=?')->execute([$new, $email]);
    audit($actor['email'], '', $email, 'USER_' . strtoupper($field), $column, (string)$old, $new);
    return true;
}

function resetUser(string $email): array {
    $actor = admin(); $email = mb_strtolower(trim($email));
    if ($email === $actor['email']) throw new DomainException('Gunakan Ganti password untuk akun sendiri.');
    $password = 'password';
    $stmt = db()->prepare('UPDATE users SET password_hash=?,must_change=1 WHERE email=?');
    $stmt->execute([password_hash($password, PASSWORD_DEFAULT), $email]);
    if ($stmt->rowCount() === 0) throw new DomainException('Pengguna tidak ditemukan.');
    audit($actor['email'], '', $email, 'PASSWORD_RESET', 'password_hash', '[redacted]', '[redacted]');
    return ['email' => $email, 'temporaryPassword' => $password];
}
