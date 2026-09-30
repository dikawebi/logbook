<?php
declare(strict_types=1);

const EDITABLE_COLUMNS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32];
const DATE_COLUMNS = [1, 2, 3, 7, 9, 11, 28, 32];
const NUMBER_COLUMNS = [12, 16, 17, 18, 19, 20, 21, 22, 23, 25, 26];
const COLUMN_NAMES = [
    'Received Date', 'Validation Date', 'MSD Date', 'Vendor Code', 'Vendor Name', 'Invoice No',
    'Invoice Date', 'Tax Invoice No', 'Tax Invoice Date', 'PO/Contract No', 'PO/WO Date',
    'Nominal PO/Contract', 'Description', 'Naration for MSD', 'WHT %', 'DPP Non VAT',
    'DPP VAT', 'VAT', 'Prepaid VAT', 'Pajak Daerah', 'Pajak Bahan Bakar', 'WHT 22',
    'Invoiced Amount', 'Tax Code', 'Withholding Tax Amount', 'Net Payment', 'Payment Term',
    'Due Date', 'Category', 'Remarks', 'Paid/Not Paid', 'Payment Date'
];

function config(): array {
    static $config;
    return $config ??= require dirname(__DIR__) . '/config.php';
}

function logSyncError(string $message): void {
    $directory = dirname(__DIR__) . '/var';
    if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) return;
    $path = $directory . '/sync-errors.log';
    if (is_file($path) && filesize($path) > 524288) file_put_contents($path, '');
    $message = str_replace(["\r", "\n"], ' ', $message);
    file_put_contents($path, '[' . date('Y-m-d H:i:s') . '] ' . mb_substr($message, 0, 2000) . PHP_EOL, FILE_APPEND | LOCK_EX);
}

function syncErrorLog(): array {
    admin();
    $path = dirname(__DIR__) . '/var/sync-errors.log';
    if (!is_file($path)) return [];
    $lines = file($path, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES);
    return array_slice($lines ?: [], -50);
}

function clearSyncErrorLog(): void {
    $path = dirname(__DIR__) . '/var/sync-errors.log';
    if (is_file($path)) file_put_contents($path, '', LOCK_EX);
}

function purgeTransactions(): array {
    $actor = admin();
    $pdo = db();
    $pdo->beginTransaction();
    try {
        $counts = $pdo->query("SELECT currency, COUNT(*) AS total FROM transactions WHERE currency IN ('IDR','USD') GROUP BY currency")
            ->fetchAll(PDO::FETCH_KEY_PAIR);
        $deleted = $pdo->exec("DELETE FROM transactions WHERE currency IN ('IDR','USD')");
        audit($actor['email'], '', '', 'PURGE_TRANSACTIONS', 'IDR/USD', '', (string)$deleted);
        $pdo->commit();
        return ['before' => $counts, 'deleted' => $deleted];
    } catch (Throwable $error) {
        $pdo->rollBack();
        throw $error;
    }
}

function syncSettings(): array {
    admin();
    $settings = config();
    return ['sheetEndpoint' => (string)($settings['sheet_endpoint'] ?? ''), 'hasSyncSecret' => trim((string)($settings['sync_secret'] ?? '')) !== ''];
}

function updateSyncSettings(string $sheetEndpoint, string $syncSecret): array {
    admin();
    $sheetEndpoint = trim($sheetEndpoint);
    if (!filter_var($sheetEndpoint, FILTER_VALIDATE_URL) || !str_starts_with($sheetEndpoint, 'https://')) {
        throw new DomainException('URL Sheet endpoint harus menggunakan HTTPS.');
    }
    if ($syncSecret !== '' && strlen($syncSecret) < 32) throw new DomainException('Sync secret minimal 32 karakter.');
    $path = dirname(__DIR__) . '/config.php';
    $source = file_get_contents($path);
    if ($source === false) throw new DomainException('Config tidak dapat dibaca.');
    $replace = static function (string $content, string $key, string $value): string {
        $count = 0;
        $result = preg_replace_callback("/'" . preg_quote($key, '/') . "'\\s*=>\\s*[^,\\r\\n]+/", static fn (array $match): string => preg_replace('/=>.*/', '=> ' . var_export($value, true), $match[0]), $content, 1, $count);
        if ($result === null || $count !== 1) throw new DomainException('Format config.php untuk ' . $key . ' tidak dikenali.');
        return $result;
    };
    $source = $replace($source, 'sheet_endpoint', $sheetEndpoint);
    if ($syncSecret !== '') $source = $replace($source, 'sync_secret', $syncSecret);
    if (file_put_contents($path, $source, LOCK_EX) === false) throw new DomainException('Config tidak dapat disimpan.');
    return ['sheetEndpoint' => $sheetEndpoint, 'hasSyncSecret' => $syncSecret !== '' || trim((string)(config()['sync_secret'] ?? '')) !== ''];
}

function db(): PDO {
    static $db;
    if (!$db) {
        $c = config();
        $db = new PDO($c['db_dsn'], $c['db_user'], $c['db_password'], [
            PDO::ATTR_ERRMODE => PDO::ERRMODE_EXCEPTION,
            PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
            PDO::ATTR_EMULATE_PREPARES => false,
        ]);
        ensureTransactionSchema($db);
    }
    return $db;
}

function inferVatMultiplier(array $data): float {
    $dpp = formulaNumber((string)($data[16] ?? ''));
    $vat = formulaNumber((string)($data[17] ?? ''));
    // Prefer 1.1% when its rounded workbook result matches historical VAT.
    if ($dpp != 0.0 && formulaInteger($dpp * 0.011) === formulaInteger($vat)) return 0.011;
    return 0.11;
}

function validVatMultiplier(mixed $value): float {
    $multiplier = is_numeric($value) ? (float)$value : 0.11;
    if (!in_array($multiplier, [0.011, 0.11], true)) throw new DomainException('VAT in multiplier tidak valid.');
    return $multiplier;
}

function ensureTransactionSchema(PDO $pdo): void {
    static $ready = false;
    if ($ready) return;
    if (!$pdo->query("SHOW COLUMNS FROM transactions LIKE 'vat_multiplier'")->fetch()) {
        $pdo->exec('ALTER TABLE transactions ADD COLUMN vat_multiplier DECIMAL(5,3) NULL AFTER data');
    }
    if (!$pdo->query("SHOW COLUMNS FROM transactions LIKE 'due_date'")->fetch()) {
        $pdo->exec('ALTER TABLE transactions ADD COLUMN due_date DATE NULL AFTER received_date');
    }
    foreach ([
        'payment_due_lookup' => 'ALTER TABLE transactions ADD INDEX payment_due_lookup (currency, cancelled, payment_status, due_date)',
        'vat_multiplier_lookup' => 'ALTER TABLE transactions ADD INDEX vat_multiplier_lookup (currency, vat_multiplier)',
    ] as $index => $sql) {
        $stmt = $pdo->prepare('SHOW INDEX FROM transactions WHERE Key_name = ?');
        $stmt->execute([$index]);
        if (!$stmt->fetch()) $pdo->exec($sql);
    }
    foreach ([
        'invoice_snapshot' => "VARCHAR(255) NOT NULL DEFAULT ''",
        'vendor_snapshot' => "VARCHAR(255) NOT NULL DEFAULT ''",
        'invoice_date_snapshot' => 'DATE NULL',
    ] as $column => $definition) {
        if (!$pdo->query("SHOW COLUMNS FROM audit_logs LIKE '$column'")->fetch()) {
            $pdo->exec("ALTER TABLE audit_logs ADD COLUMN $column $definition");
        }
    }
    $rows = $pdo->query('SELECT id,data FROM transactions WHERE vat_multiplier IS NULL')->fetchAll();
    $update = $pdo->prepare('UPDATE transactions SET vat_multiplier=?,due_date=? WHERE id=?');
    foreach ($rows as $row) {
        $data = json_decode($row['data'], true);
        $data = is_array($data) ? $data : [];
        $update->execute([inferVatMultiplier($data), isoDate((string)($data[27] ?? '')), $row['id']]);
    }
    $pdo->exec("UPDATE transactions SET due_date=STR_TO_DATE(JSON_UNQUOTE(JSON_EXTRACT(data, '$[27]')), '%Y-%m-%d') WHERE due_date IS NULL");
    $ready = true;
}

function startSession(): void {
    if (session_status() !== PHP_SESSION_NONE) return;
    session_name('logbook_session');
    session_set_cookie_params([
        // Built-in PHP server runs over HTTP on localhost; production must use HTTPS.
        'httponly' => true, 'secure' => PHP_SAPI !== 'cli-server',
        'samesite' => 'Lax', 'path' => '/',
    ]);
    session_start();
}

function me(bool $allowChange = false): array {
    startSession();
    $email = $_SESSION['email'] ?? '';
    if (!$email) throw new DomainException('Silakan login terlebih dahulu.');
    $stmt = db()->prepare('SELECT email, password_hash, role, active, must_change FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();
    if (!$user || !$user['active'] || ($_SESSION['version'] ?? '') !== hash('sha256', $user['password_hash'])) {
        unset($_SESSION['email'], $_SESSION['version']);
        throw new DomainException('Sesi habis. Silakan login kembali.');
    }
    if (!$allowChange && $user['must_change']) throw new DomainException('Ganti password terlebih dahulu.');
    return $user;
}

function admin(): array {
    $user = me();
    if ($user['role'] !== 'ADMIN') throw new DomainException('Hanya admin yang dapat melakukan tindakan ini.');
    return $user;
}

function csrf(): void {
    startSession();
    $provided = $_SERVER['HTTP_X_CSRF_TOKEN'] ?? '';
    if (empty($_SESSION['csrf']) || !hash_equals($_SESSION['csrf'], $provided)) throw new DomainException('Token keamanan tidak valid. Muat ulang halaman.');
}

function legacyVerify(string $password, string $saved): bool {
    if (str_starts_with($saved, 'v2$')) {
        $parts = explode('$', $saved);
        if (count($parts) !== 4 || (int)$parts[1] < 1 || (int)$parts[1] > 10000) return false;
        $hash = $parts[2] . ':' . $password;
        for ($i = 0; $i < (int)$parts[1]; $i++) {
            $hash = base64_encode(hash('sha256', $hash . ':' . $parts[2], true));
            $hash = strtr($hash, '+/', '-_');
        }
        return hash_equals(rtrim($parts[3], '='), rtrim($hash, '='));
    }
    return hash_equals($saved, base64_encode(hash('sha256', $password, true)));
}

function verifyLogin(string $password, string $saved): bool {
    return str_starts_with($saved, '$2') || str_starts_with($saved, '$argon2')
        ? password_verify($password, $saved)
        : legacyVerify($password, $saved);
}

function loginUser(string $email, string $password): array {
    startSession();
    $email = mb_strtolower(trim($email));
    $stmt = db()->prepare('SELECT * FROM users WHERE email = ?');
    $stmt->execute([$email]);
    $user = $stmt->fetch();
    if (!$user || !$user['active'] || !verifyLogin($password, $user['password_hash'])) {
        throw new DomainException('Email atau password salah, atau akun tidak aktif.');
    }
    if (!password_get_info($user['password_hash'])['algo']) {
        $user['password_hash'] = password_hash($password, PASSWORD_DEFAULT);
        db()->prepare('UPDATE users SET password_hash = ?, must_change = 1 WHERE email = ?')->execute([$user['password_hash'], $email]);
        $user['must_change'] = 1;
    }
    session_regenerate_id(true);
    $_SESSION['email'] = $email;
    $_SESSION['version'] = hash('sha256', $user['password_hash']);
    return publicUser($user);
}

function publicUser(array $user): array {
    return ['email' => $user['email'], 'role' => $user['role'], 'mustChange' => (bool)$user['must_change']];
}

function changePassword(string $old, string $new): void {
    $user = me(true);
    if (!verifyLogin($old, $user['password_hash'])) throw new DomainException('Password lama salah.');
    if (mb_strlen($new) < 8) throw new DomainException('Password baru minimal 8 karakter.');
    $hash = password_hash($new, PASSWORD_DEFAULT);
    db()->prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE email = ?')->execute([$hash, $user['email']]);
    $_SESSION['version'] = hash('sha256', $hash);
    audit($user['email'], '', '', 'PASSWORD_CHANGED', '', '', '');
}

function audit(string $email, string $currency, string $id, string $action, string $column, string $old, string $new): void {
    $snapshot = ['', '', null];
    if ($id !== '' && in_array($currency, ['IDR', 'USD'], true)) {
        $stmt = db()->prepare('SELECT invoice,vendor,due_date,data FROM transactions WHERE id=? AND currency=?');
        $stmt->execute([$id, $currency]);
        if ($record = $stmt->fetch()) {
            $data = json_decode($record['data'], true);
            $snapshot = [$record['invoice'], $record['vendor'], isoDate((string)($data[6] ?? ''))];
        }
    }
    db()->prepare('INSERT INTO audit_logs (email,currency,record_id,action,column_name,old_value,new_value,invoice_snapshot,vendor_snapshot,invoice_date_snapshot) VALUES (?,?,?,?,?,?,?,?,?,?)')
        ->execute([$email, $currency, $id, $action, $column, $old, $new, ...$snapshot]);
}

function isoDate(string $text): ?string {
    $text = trim($text);
    if ($text === '') return null;
    foreach (['!Y-m-d', '!j-M-y', '!j M y', '!j-M-Y', '!j M Y'] as $format) {
        $date = DateTimeImmutable::createFromFormat($format, $text);
        if ($date && DateTimeImmutable::getLastErrors() === false) return $date->format('Y-m-d');
    }
    return null;
}

function normalizeImported(array $data): array {
    $result = array_pad(array_slice($data, 0, 32), 32, '');
    foreach ($result as $index => $value) {
        $value = trim((string)$value);
        $col = $index + 1;
        if (in_array($col, DATE_COLUMNS, true)) $value = isoDate($value) ?? $value;
        if (in_array($col, NUMBER_COLUMNS, true)) {
            if ($value === '' || preg_match('/^[-\s.]+$/', $value)) $value = '';
            else {
                $negative = str_starts_with($value, '(') && str_ends_with($value, ')');
                $number = str_replace([',', '(', ')', ' '], '', $value);
                if (is_numeric($number)) $value = ($negative ? '-' : '') . $number;
            }
        }
        $result[$index] = $value;
    }
    return $result;
}

function formulaNumber(string $value): float {
    $value = trim(str_replace(',', '', $value));
    if (str_starts_with($value, '(') && str_ends_with($value, ')')) $value = '-' . substr($value, 1, -1);
    return is_numeric($value) ? (float)$value : 0.0;
}

function formulaPercent(string $value): float {
    $value = trim($value);
    return str_ends_with($value, '%') ? formulaNumber(substr($value, 0, -1)) / 100 : formulaNumber($value);
}

function formulaInteger(float $value): string {
    return (string)round($value, 0, PHP_ROUND_HALF_UP);
}

function formulaDueDate(string $invoiceDate, string $paymentTerm): string {
    $date = isoDate($invoiceDate);
    if (!$date) return '';
    return (new DateTimeImmutable($date))->modify('+' . max(0, (int)formulaNumber($paymentTerm)) . ' days')->format('Y-m-d');
}

function applyRecordFormulas(array $data, string $currency, float $vatMultiplier = 0.11): array {
    // Mirrors the repeated transaction-row formulas in the supplied IDR/USD workbook.
    $data = array_pad(array_slice($data, 0, 32), 32, '');
    $data[13] = $currency === 'IDR'
        ? ($data[5] === '' && $data[12] === '' ? '' : $data[5] . '; ' . $data[12])
        : ($data[5] === '' && $data[4] === '' && $data[12] === '' ? '' : $data[5] . '; ' . $data[4] . '; ' . $data[12]);
    $data[17] = formulaInteger(formulaNumber((string)$data[16]) * $vatMultiplier);
    if ($currency === 'IDR') {
        $data[22] = formulaInteger(array_sum(array_map(static fn (int $index): float => formulaNumber((string)$data[$index]), range(15, 21))));
    } else {
        $data[22] = formulaInteger(formulaNumber((string)$data[15]));
        $data[24] = formulaInteger(-formulaPercent((string)$data[14]) * (formulaNumber((string)$data[15]) + formulaNumber((string)$data[16])));
    }
    $data[25] = formulaInteger(formulaNumber((string)$data[22]) + formulaNumber((string)$data[24]));
    $data[27] = formulaDueDate((string)$data[6], (string)$data[26]);
    return $data;
}

function applyVatPrepaid(array $data, float $vatMultiplier): array {
    $data = array_pad(array_slice($data, 0, 32), 32, '');
    $data[17] = formulaInteger(formulaNumber((string)$data[16]) * $vatMultiplier);
    return $data;
}

function cleanRecord(array $data): array {
    $result = array_fill(0, 32, '');
    foreach (EDITABLE_COLUMNS as $col) {
        $value = trim((string)($data[$col - 1] ?? ''));
        if (mb_strlen($value) > 2000) throw new DomainException(COLUMN_NAMES[$col - 1] . ' terlalu panjang.');
        if (in_array($col, DATE_COLUMNS, true)) {
            if ($value !== '' && !isoDate($value)) throw new DomainException('Tanggal ' . COLUMN_NAMES[$col - 1] . ' tidak valid.');
            $value = $value === '' ? '' : isoDate($value);
        } elseif (in_array($col, NUMBER_COLUMNS, true)) {
            $value = str_replace(',', '', $value);
            if ($value !== '' && !is_numeric($value)) throw new DomainException('Nominal ' . COLUMN_NAMES[$col - 1] . ' tidak valid.');
        }
        $result[$col - 1] = $value;
    }
    if ($result[4] === '' || $result[5] === '') throw new DomainException('Vendor Name dan Invoice No wajib diisi.');
    if ($result[30] !== '' && !in_array(strtolower($result[30]), ['paid', 'not paid'], true)) throw new DomainException('Status pembayaran tidak valid.');
    return $result;
}

function recordColumns(array $data): array {
    return [isoDate((string)$data[0]), isoDate((string)$data[27]), mb_substr((string)$data[4], 0, 255), mb_substr((string)$data[5], 0, 255), (string)$data[12],
        mb_substr((string)$data[28], 0, 190), strtolower((string)$data[30])];
}

function saveRecord(string $currency, string $id, array $incoming, mixed $incomingVatMultiplier = 0.11): string {
    $actor = me();
    if (!in_array($currency, ['IDR', 'USD'], true)) throw new DomainException('Mata uang tidak valid.');
    foreach ([13, 17, 22, 24, 25, 27] as $index) $incoming[$index] = '';
    $vatMultiplier = validVatMultiplier($incomingVatMultiplier);
    $data = applyRecordFormulas(cleanRecord($incoming), $currency, $vatMultiplier);
    $pdo = db(); $pdo->beginTransaction();
    try {
        $before = null;
        if ($id !== '') {
            $stmt = $pdo->prepare('SELECT * FROM transactions WHERE id = ? AND currency = ? FOR UPDATE');
            $stmt->execute([$id, $currency]); $before = $stmt->fetch();
            if (!$before) throw new DomainException('Transaksi tidak ditemukan.');
            if ($before['cancelled']) throw new DomainException('Transaksi yang dibatalkan tidak dapat diedit.');
        } else $id = bin2hex(random_bytes(16));
        [$date, $dueDate, $vendor, $invoice, $description, $category, $status] = recordColumns($data);
        $json = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
        if ($before) {
            $pdo->prepare('UPDATE transactions SET data=?,vat_multiplier=?,received_date=?,due_date=?,vendor=?,invoice=?,description=?,category=?,payment_status=?,edited_at=NOW() WHERE id=?')
                ->execute([$json, $vatMultiplier, $date, $dueDate, $vendor, $invoice, $description, $category, $status, $id]);
            $old = json_decode($before['data'], true, flags: JSON_THROW_ON_ERROR);
            foreach ($data as $i => $value) if ((string)($old[$i] ?? '') !== $value) audit($actor['email'], $currency, $id, 'UPDATE', COLUMN_NAMES[$i], (string)($old[$i] ?? ''), $value);
            if ((float)$before['vat_multiplier'] !== $vatMultiplier) audit($actor['email'], $currency, $id, 'UPDATE', 'VAT in multiplier', (string)$before['vat_multiplier'], (string)$vatMultiplier);
        } else {
            $pdo->prepare('INSERT INTO transactions (id,currency,data,vat_multiplier,received_date,due_date,vendor,invoice,description,category,payment_status,edited_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW())')
                ->execute([$id, $currency, $json, $vatMultiplier, $date, $dueDate, $vendor, $invoice, $description, $category, $status]);
            audit($actor['email'], $currency, $id, 'CREATE', 'App ID', '', $id);
        }
        $pdo->commit(); return $id;
    } catch (Throwable $e) { $pdo->rollBack(); throw $e; }
}

function cancelRecord(string $currency, string $id): void {
    $actor = me();
    if (!in_array($currency, ['IDR', 'USD'], true)) throw new DomainException('Mata uang tidak valid.');
    $pdo = db(); $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT data,cancelled FROM transactions WHERE id=? AND currency=? FOR UPDATE');
        $stmt->execute([$id, $currency]); $row = $stmt->fetch();
        if (!$row || $row['cancelled']) throw new DomainException('Transaksi tidak ditemukan atau sudah dibatalkan.');
        $data = json_decode($row['data'], true, flags: JSON_THROW_ON_ERROR);
        $data[30] = 'Invoice Cancel';
        $pdo->prepare('UPDATE transactions SET data=?,payment_status=?,cancelled=1,edited_at=NOW() WHERE id=?')
            ->execute([json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE), 'invoice cancel', $id]);
        audit($actor['email'], $currency, $id, 'CANCEL', 'App Status', '', 'CANCELLED');
        $pdo->commit();
    } catch (Throwable $e) { $pdo->rollBack(); throw $e; }
}

function sheetRequest(array $payload): array {
    $c = config();
    if (strlen($c['sync_secret'] ?? '') < 32) throw new RuntimeException('Konfigurasi sync_secret belum siap.');
    $url = $c['sheet_endpoint'];
    if (!str_starts_with($url, 'https://script.google.com/macros/s/') || !str_ends_with($url, '/exec')) throw new RuntimeException('URL sheet_endpoint harus URL deployment /exec tanpa /u/1.');
    for ($attempt = 1; $attempt <= 3; $attempt++) {
        $curl = curl_init($url);
        curl_setopt_array($curl, [CURLOPT_POST => true, CURLOPT_POSTFIELDS => json_encode($payload + ['secret' => $c['sync_secret']], JSON_THROW_ON_ERROR),
            CURLOPT_HTTPHEADER => ['Content-Type: application/json'], CURLOPT_RETURNTRANSFER => true,
            CURLOPT_FOLLOWLOCATION => true, CURLOPT_MAXREDIRS => 5, CURLOPT_CONNECTTIMEOUT => 0, CURLOPT_TIMEOUT => 0]);
        $body = curl_exec($curl);
        $error = $body === false ? curl_error($curl) : '';
        $code = curl_getinfo($curl, CURLINFO_RESPONSE_CODE);
        $responseMs = (int)round(curl_getinfo($curl, CURLINFO_TOTAL_TIME) * 1000);
        curl_close($curl);
        if ($body !== false && $code === 200) {
            $result = json_decode($body, true);
            if (!is_array($result)) throw new RuntimeException('Respons Google bukan JSON. Periksa akses deployment Apps Script.');
            if (isset($result['error'])) throw new RuntimeException('Sinkronisasi Sheet: ' . $result['error']);
            $result['_responseMs'] = $responseMs;
            return $result;
        }
        $retryable = $body === false || in_array($code, [404, 429, 500, 502, 503, 504], true);
        if ($attempt === 3 || !$retryable) {
            throw new RuntimeException(($body === false ? 'Google Sheet tidak dapat dihubungi: ' . $error
                : 'Google Sheet mengembalikan HTTP ' . $code . '. Periksa deployment /exec.') . " (respons {$responseMs} ms)");
        }
        sleep($attempt * 2);
    }
    throw new RuntimeException('Sinkronisasi gagal.');
}

function importUsers(): int {
    $response = sheetRequest(['type' => 'users']);
    $count = 0;
    foreach ($response['rows'] ?? [] as $row) {
        $email = mb_strtolower(trim((string)($row[0] ?? '')));
        if (!filter_var($email, FILTER_VALIDATE_EMAIL) || !$row[1]) continue;
        $stmt = db()->prepare('INSERT IGNORE INTO users (email,password_hash,role,active,must_change) VALUES (?,?,?,?,?)');
        $stmt->execute([$email, $row[1], strtoupper((string)$row[3]) === 'ADMIN' ? 'ADMIN' : 'USER', strtolower((string)$row[2]) === 'true' ? 1 : 0, 1]);
        $count += $stmt->rowCount();
    }
    return $count;
}

function sheetColumnNames(string $currency): array {
    if (!in_array($currency, ['IDR', 'USD'], true)) throw new DomainException('Mata uang tidak valid.');
    $stmt = db()->prepare('SELECT labels FROM sheet_headers WHERE currency=?');
    $stmt->execute([$currency]);
    $saved = $stmt->fetchColumn();
    $headers = $saved ? json_decode($saved, true) : [];
    return array_map(static function (int $index) use ($headers): string {
        $name = trim((string)($headers[$index] ?? ''));
        return $name !== '' ? $name : COLUMN_NAMES[$index];
    }, range(0, 31));
}

function sheetFieldSql(int $index): string {
    if ($index < 0 || $index >= 32) throw new DomainException('Kolom tidak valid.');
    return "JSON_UNQUOTE(JSON_EXTRACT(data, '$[" . $index . "]'))";
}

function vendorOptions(string $currency, string $code, string $name, string $query): array {
    if (!in_array($currency, ['IDR', 'USD'], true)) throw new DomainException('Mata uang tidak valid.');
    foreach ([$code, $name, $query] as $value) if (mb_strlen($value) > 200) throw new DomainException('Pencarian vendor terlalu panjang.');
    $codeField = sheetFieldSql(3); $nameField = sheetFieldSql(4);
    $where = ['currency = ?', 'cancelled = 0', "COALESCE($codeField, '') <> ''", "COALESCE($nameField, '') <> ''"];
    $params = [$currency];
    if (trim($code) !== '') { $where[] = "LOWER($codeField) = LOWER(?)"; $params[] = trim($code); }
    if (trim($name) !== '') { $where[] = "LOWER($nameField) = LOWER(?)"; $params[] = trim($name); }
    if (trim($query) !== '') {
        $where[] = "(LOWER($codeField) LIKE LOWER(?) OR LOWER($nameField) LIKE LOWER(?))";
        $term = searchTerm($query); $params[] = $term; $params[] = $term;
    }
    $stmt = db()->prepare("SELECT DISTINCT $codeField AS code, $nameField AS name FROM transactions WHERE " . implode(' AND ', $where) . ' ORDER BY code, name LIMIT 500');
    $stmt->execute($params);
    return ['pairs' => $stmt->fetchAll()];
}

function searchTerm(string $value): string {
    return '%' . addcslashes(mb_substr(trim($value), 0, 100), '%_\\') . '%';
}

function searchWords(string $input): array {
    $input = trim($input);
    if (mb_strlen($input) > 200) throw new DomainException('Pencarian maksimal 200 karakter.');
    preg_match_all('/"([^"]+)"|(\S+)/u', $input, $matches, PREG_SET_ORDER);
    $words = array_values(array_filter(array_map(
        static fn (array $match): string => trim($match[1] !== '' ? $match[1] : $match[2]),
        $matches
    ), static fn (string $word): bool => $word !== ''));
    if (count($words) > 8) throw new DomainException('Gunakan maksimal 8 kata kunci dalam satu pencarian.');
    return $words;
}

function fieldSearchSql(int $index, string $value, array &$params): string {
    $column = sheetFieldSql($index);
    $value = trim($value);
    if (in_array($index + 1, NUMBER_COLUMNS, true)) $value = str_replace(',', '', $value);
    $term = searchTerm($value);
    $params[] = $term;
    $match = 'LOWER(' . $column . ') LIKE LOWER(?)';
    if (in_array($index + 1, DATE_COLUMNS, true)) {
        $params[] = $term;
        $match = '(' . $match . " OR LOWER(DATE_FORMAT(STR_TO_DATE(" . $column . ", '%Y-%m-%d'), '%e-%b-%y')) LIKE LOWER(?))";
    }
    return $match;
}

function chosenValues(array $filters, string $key): array {
    $raw = $filters[$key] ?? '';
    if (!is_string($raw) || $raw === '') return [];
    $values = json_decode($raw, true);
    if (!is_array($values) || count($values) > 30) throw new DomainException('Pilihan dropdown tidak valid atau melebihi 30 nilai.');
    foreach ($values as $value) {
        if (!is_string($value) || mb_strlen($value) > 2000) throw new DomainException('Nilai dropdown tidak valid.');
    }
    return array_values(array_unique($values));
}

function chosenSql(string $field, array $values, array &$params): string {
    foreach ($values as $value) $params[] = $value;
    return '(' . implode(' OR ', array_fill(0, count($values), 'COALESCE(' . $field . ", '') = ?")) . ')';
}

function recordSearch(array $filters): array {
    $currency = (string)($filters['currency'] ?? 'IDR');
    if (!in_array($currency, ['IDR', 'USD'], true)) throw new DomainException('Mata uang tidak valid.');
    $where = ['currency = ?']; $params = [$currency];
    foreach (['from' => 'received_date >= ?', 'to' => 'received_date <= ?'] as $key => $sql) {
        if (!empty($filters[$key])) {
            $date = (string)$filters[$key];
            if (!isoDate($date) || isoDate($date) !== $date) throw new DomainException('Filter tanggal tidak valid.');
            $where[] = $sql; $params[] = $date;
        }
    }
    $dueField = sheetFieldSql(27);
    foreach (['dueFrom' => '>=', 'dueTo' => '<='] as $key => $operator) {
        if (!empty($filters[$key])) {
            $date = (string)$filters[$key];
            if (!isoDate($date) || isoDate($date) !== $date) throw new DomainException('Filter jatuh tempo tidak valid.');
            $where[] = "STR_TO_DATE($dueField, '%Y-%m-%d') $operator ?"; $params[] = $date;
        }
    }
    if (isset($filters['category']) && $filters['category'] !== '') {
        $where[] = 'category = ?'; $params[] = (string)$filters['category'];
    }
    $status = (string)($filters['status'] ?? '');
    if (!in_array($status, ['', 'paid', 'unpaid', 'blank', 'cancelled', 'overdue'], true)) throw new DomainException('Status tidak valid.');
    if ($status === 'cancelled') $where[] = 'cancelled = 1';
    elseif ($status === 'overdue') {
        $where[] = 'cancelled = 0';
        $where[] = "payment_status <> 'paid'";
        $where[] = 'due_date < CURDATE()';
    }
    elseif ($status !== '') {
        $where[] = 'cancelled = 0'; $where[] = 'payment_status = ?';
        $params[] = $status === 'unpaid' ? 'not paid' : ($status === 'blank' ? '' : 'paid');
    }
    for ($i = 0; $i < 32; $i++) {
        $input = $filters['c' . $i] ?? '';
        if (is_string($input) && trim($input) !== '') {
            foreach (searchWords($input) as $word) $where[] = fieldSearchSql($i, $word, $params);
        }
        $selected = chosenValues($filters, 's' . $i);
        if ($selected) $where[] = chosenSql(sheetFieldSql($i), $selected, $params);
    }
    if (isset($filters['cVatMultiplier']) && trim((string)$filters['cVatMultiplier']) !== '') {
        foreach (searchWords((string)$filters['cVatMultiplier']) as $word) {
            $where[] = "LOWER(CASE vat_multiplier WHEN 0.011 THEN '1.1%' ELSE '11%' END) LIKE LOWER(?)";
            $params[] = searchTerm($word);
        }
    }
    $selectedVatMultiplier = chosenValues($filters, 'sVatMultiplier');
    if ($selectedVatMultiplier) {
        $multipliers = [];
        foreach ($selectedVatMultiplier as $value) {
            $percent = rtrim($value, '%');
            if (!is_numeric($percent)) throw new DomainException('VAT in multiplier tidak valid.');
            $multipliers[] = validVatMultiplier((float)$percent / (str_ends_with($value, '%') ? 100 : 1));
        }
        $where[] = chosenSql('vat_multiplier', array_map('strval', $multipliers), $params);
    }
    $statusField = "CASE WHEN cancelled=1 THEN 'Dibatalkan' ELSE 'Aktif' END";
    if (isset($filters['cStatus']) && trim((string)$filters['cStatus']) !== '') {
        foreach (searchWords((string)$filters['cStatus']) as $word) {
            $where[] = 'LOWER(' . $statusField . ') LIKE LOWER(?)';
            $params[] = searchTerm($word);
        }
    }
    $selectedStatus = chosenValues($filters, 'sStatus');
    if ($selectedStatus) $where[] = chosenSql($statusField, $selectedStatus, $params);
    if (isset($filters['keyword']) && trim((string)$filters['keyword']) !== '') {
        foreach (searchWords((string)$filters['keyword']) as $word) {
            $matches = [];
            for ($i = 0; $i < 32; $i++) $matches[] = fieldSearchSql($i, $word, $params);
            $matches[] = 'LOWER(' . $statusField . ') LIKE LOWER(?)';
            $params[] = searchTerm($word);
            $where[] = '(' . implode(' OR ', $matches) . ')';
        }
    }
    return [implode(' AND ', $where), $params];
}

function distinctOptions(string $currency, string $column, string $search = '', array $appliedFilters = []): array {
    if (!in_array($currency, ['IDR', 'USD'], true)) throw new DomainException('Mata uang tidak valid.');
    $appliedFilters['currency'] = $currency;
    if ($column === 'vatMultiplier') {
        unset($appliedFilters['cVatMultiplier'], $appliedFilters['sVatMultiplier']);
        [$where, $params] = recordSearch($appliedFilters);
        $stmt = db()->prepare("SELECT DISTINCT CASE vat_multiplier WHEN 0.011 THEN '1.1%' ELSE '11%' END AS option_value FROM transactions WHERE " . $where . ' ORDER BY vat_multiplier');
        $stmt->execute($params);
        $words = searchWords($search);
        return ['values' => array_values(array_filter($stmt->fetchAll(PDO::FETCH_COLUMN), static function (string $value) use ($words): bool {
            foreach ($words as $word) if (mb_stripos($value, $word) === false) return false;
            return true;
        }))];
    }
    if ($column === 'status') {
        unset($appliedFilters['cStatus'], $appliedFilters['sStatus']);
        [$where, $params] = recordSearch($appliedFilters);
        $stmt = db()->prepare("SELECT DISTINCT CASE WHEN cancelled=1 THEN 'Dibatalkan' ELSE 'Aktif' END AS option_value FROM transactions WHERE "
            . $where . ' ORDER BY option_value');
        $stmt->execute($params);
        $words = searchWords($search);
        return ['values' => array_values(array_filter($stmt->fetchAll(PDO::FETCH_COLUMN), static function (string $value) use ($words): bool {
            foreach ($words as $word) if (mb_stripos($value, $word) === false) return false;
            return true;
        }))];
    }
    if (!ctype_digit($column) || (int)$column >= 32) throw new DomainException('Kolom tidak valid.');
    $index = (int)$column;
    $field = sheetFieldSql($index);
    unset($appliedFilters['c' . $index], $appliedFilters['s' . $index]);
    [$where, $params] = recordSearch($appliedFilters);
    $conditions = [$where];
    foreach (searchWords($search) as $word) $conditions[] = fieldSearchSql($index, $word, $params);
    $stmt = db()->prepare('SELECT DISTINCT COALESCE(' . $field . ", '') AS option_value FROM transactions WHERE "
        . implode(' AND ', $conditions) . ' ORDER BY option_value');
    $stmt->execute($params);
    $values = array_map('strval', $stmt->fetchAll(PDO::FETCH_COLUMN));
    return ['values' => $values];
}

function recordOrder(array $filters): string {
    $sort = (string)($filters['sort'] ?? '');
    if ($sort === '') return 'received_date DESC, id DESC';
    $direction = strtoupper((string)($filters['direction'] ?? 'ASC'));
    if (!in_array($direction, ['ASC', 'DESC'], true)) throw new DomainException('Arah sort tidak valid.');
    if ($sort === 'status') return 'cancelled ' . $direction . ', id DESC';
    if ($sort === 'vatMultiplier') return 'vat_multiplier ' . $direction . ', id DESC';
    if (!ctype_digit($sort) || (int)$sort < 0 || (int)$sort > 31) throw new DomainException('Kolom sort tidak valid.');
    $index = (int)$sort;
    $field = sheetFieldSql($index);
    $sortField = in_array($index + 1, NUMBER_COLUMNS, true)
        ? 'CAST(NULLIF(' . $field . ", '') AS DECIMAL(30,2))"
        : (in_array($index + 1, DATE_COLUMNS, true) ? "STR_TO_DATE(" . $field . ", '%Y-%m-%d')" : 'LOWER(' . $field . ')');
    return "NULLIF(TRIM(" . $field . "), '') IS NULL ASC, " . $sortField . ' ' . $direction . ', id DESC';
}

function refreshSheetHeaders(string $currency): array {
    if (!in_array($currency, ['IDR', 'USD'], true)) throw new DomainException('Mata uang tidak valid.');
    $response = sheetRequest(['type' => 'headers', 'currency' => $currency]);
    if (!isset($response['headers']) || !is_array($response['headers']) || count($response['headers']) !== 32) {
        throw new RuntimeException('Header Sheet tidak lengkap. Deploy ulang Sync.gs versi terbaru.');
    }
    $headers = array_map('strval', array_values($response['headers']));
    db()->prepare('INSERT INTO sheet_headers (currency,labels) VALUES (?,?) ON DUPLICATE KEY UPDATE labels=VALUES(labels)')
        ->execute([$currency, json_encode($headers, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE)]);
    return sheetColumnNames($currency);
}

function importAuditBatch(int $offset): array {
    $response = sheetRequest(['type' => 'audit', 'offset' => max(0, $offset)]);
    $stmt = db()->prepare('INSERT IGNORE INTO audit_logs (source_key,happened_at,email,currency,record_id,action,column_name,old_value,new_value) VALUES (?,?,?,?,?,?,?,?,?)');
    $count = 0;
    foreach ($response['rows'] as $row) {
        $r = array_pad((array)$row['data'], 8, '');
        $time = strtotime((string)$r[0]);
        $stmt->execute(['gas:' . $row['sourceRow'], $time ? date('Y-m-d H:i:s', $time) : date('Y-m-d H:i:s'),
            mb_substr((string)$r[1], 0, 190), mb_substr((string)$r[2], 0, 3), mb_substr((string)$r[3], 0, 64),
            mb_substr((string)$r[4], 0, 40), mb_substr((string)$r[5], 0, 100), (string)$r[6], (string)$r[7]]);
        $count += $stmt->rowCount();
    }
    return ['next' => (int)$response['next'], 'total' => (int)$response['total'], 'imported' => $count];
}

function importTransactionRows(string $currency, array $rows): array {
    if (!in_array($currency, ['IDR', 'USD'], true)) throw new DomainException('Mata uang tidak valid.');
    $pdo = db(); $pdo->beginTransaction(); $imported = 0; $skipped = 0; $entries = [];
    try {
        foreach ($rows as $row) {
            $id = (string)($row['id'] ?? '');
            $sourceRow = (int)($row['sourceRow'] ?? 0);
            $responseMs = (int)($row['_responseMs'] ?? 0);
            if (!preg_match('/^[a-zA-Z0-9-]{16,64}$/', $id)) { $skipped++; $entries[] = "Baris $sourceRow: dilewati (App ID tidak valid, respons {$responseMs} ms)."; continue; }
            $data = normalizeImported((array)$row['data']);
            if (preg_match('/^[\s;]+$/u', (string)$data[13])) { $skipped++; $entries[] = "Baris $sourceRow: dilewati (Naration for MSD kosong, respons {$responseMs} ms)."; continue; }
            if (!empty($row['cancelled'])) $data[30] = 'Invoice Cancel';
            [$date, $dueDate, $vendor, $invoice, $description, $category, $status] = recordColumns($data);
            $json = json_encode($data, JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
            $stmt = $pdo->prepare('SELECT currency,edited_at,vat_multiplier FROM transactions WHERE id=? FOR UPDATE');
            $stmt->execute([$id]); $existing = $stmt->fetch();
            if ($existing && ($existing['currency'] !== $currency || $existing['edited_at'] !== null)) { $skipped++; $entries[] = "Baris $sourceRow: $invoice dilewati (pernah diedit, respons {$responseMs} ms)."; continue; }
            $vatMultiplier = $existing ? validVatMultiplier($existing['vat_multiplier']) : inferVatMultiplier($data);
            if ($existing) {
                $pdo->prepare('UPDATE transactions SET source_row=?,data=?,vat_multiplier=?,received_date=?,due_date=?,vendor=?,invoice=?,description=?,category=?,payment_status=?,cancelled=?,imported_at=NOW() WHERE id=?')
                    ->execute([$row['sourceRow'], $json, $vatMultiplier, $date, $dueDate, $vendor, $invoice, $description, $category, $status, (int)$row['cancelled'], $id]);
            } else {
                $pdo->prepare('INSERT INTO transactions (id,currency,source_row,data,vat_multiplier,received_date,due_date,vendor,invoice,description,category,payment_status,cancelled,imported_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,NOW())')
                    ->execute([$id, $currency, $row['sourceRow'], $json, $vatMultiplier, $date, $dueDate, $vendor, $invoice, $description, $category, $status, (int)$row['cancelled']]);
            }
            $imported++; $entries[] = "Baris $sourceRow: $invoice disinkronkan (respons {$responseMs} ms).";
        }
        $pdo->commit();
    } catch (Throwable $e) { $pdo->rollBack(); throw $e; }
    return ['imported' => $imported, 'skipped' => $skipped, 'entries' => $entries];
}

function syncBatch(string $currency, int $offset, int $limit = 25): array {
    if (!in_array($currency, ['IDR', 'USD'], true)) throw new DomainException('Mata uang tidak valid.');
    $offset = max(0, $offset);
    $response = sheetRequest(['type' => 'transactions', 'currency' => $currency, 'offset' => $offset, 'limit' => min(100, max(1, $limit))]);
    $rows = array_map(static function (array $row) use ($response): array { $row['_responseMs'] = (int)($response['_responseMs'] ?? 0); return $row; }, $response['rows']);
    return importTransactionRows($currency, $rows) + ['next' => (int)$response['next'], 'total' => (int)$response['total']];
}

function syncSnapshot(string $currency): array {
    if (!in_array($currency, ['IDR', 'USD'], true)) throw new DomainException('Mata uang tidak valid.');
    refreshSheetHeaders($currency);
    $response = sheetRequest(['type' => 'snapshot', 'currency' => $currency]);
    $sourceTotal = (int)($response['total'] ?? 0);
    $rows = array_map(static function (array $row) use ($response): array { $row['_responseMs'] = (int)($response['_responseMs'] ?? 0); return $row; }, $response['rows'] ?? []);
    if (!$rows && $sourceTotal > 0) throw new RuntimeException('Snapshot tidak memiliki baris dengan App ID. Jalankan setupSystem() di Apps Script.');
    $directory = dirname(__DIR__) . '/var/snapshots';
    if (!is_dir($directory) && !mkdir($directory, 0770, true) && !is_dir($directory)) throw new RuntimeException('Folder snapshot tidak dapat dibuat.');
    $path = $directory . '/' . $currency . '-latest.json';
    $snapshot = json_encode(['currency' => $currency, 'downloadedAt' => date(DATE_ATOM), 'sourceTotal' => $sourceTotal, 'eligibleTotal' => count($rows), 'rows' => $rows], JSON_THROW_ON_ERROR | JSON_UNESCAPED_UNICODE);
    if (file_put_contents($path, $snapshot, LOCK_EX) === false) throw new RuntimeException('Snapshot JSON tidak dapat disimpan.');
    return importTransactionRows($currency, $rows) + ['total' => count($rows), 'sourceTotal' => $sourceTotal, 'missingAppIds' => max(0, $sourceTotal - count($rows)), 'snapshot' => basename($path)];
}
