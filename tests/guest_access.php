<?php
declare(strict_types=1);
require dirname(__DIR__) . '/app/bootstrap.php';

function assertGuestCheck(bool $ok, string $message): void {
    if (!$ok) throw new RuntimeException($message);
}
function requestGuestTest(CurlHandle $handle, string $action = '', ?array $payload = null, array $params = [], string $csrf = ''): array {
    $url = 'http://localhost:8000/index.php' . ($action === '' ? '' : '?' . http_build_query(['api' => $action, ...$params]));
    curl_setopt_array($handle, [CURLOPT_URL => $url, CURLOPT_RETURNTRANSFER => true, CURLOPT_TIMEOUT => 30,
        CURLOPT_HTTPHEADER => $payload === null ? [] : ['Content-Type: application/json', 'X-CSRF-Token: ' . $csrf]]);
    if ($payload !== null) { curl_setopt($handle, CURLOPT_POST, true); curl_setopt($handle, CURLOPT_POSTFIELDS, json_encode($payload, JSON_THROW_ON_ERROR)); }
    else curl_setopt($handle, CURLOPT_HTTPGET, true);
    $body = curl_exec($handle);
    if ($body === false) throw new RuntimeException(curl_error($handle));
    return ['status' => curl_getinfo($handle, CURLINFO_RESPONSE_CODE), 'body' => $body, 'json' => json_decode($body, true)];
}
function clientGuestTest(): array {
    $handle = curl_init(); curl_setopt($handle, CURLOPT_COOKIEFILE, '');
    $response = requestGuestTest($handle);
    preg_match('/name="csrf-token" content="([^"]+)"/', $response['body'], $match);
    assertGuestCheck(isset($match[1]), 'CSRF token unavailable; start localhost first.');
    return [$handle, $match[1]];
}

$prefix = 'guest-test-' . bin2hex(random_bytes(8));
$adminEmail = $prefix . '-admin@example.test';
$guestEmail = $prefix . '-guest@example.test';
$password = bin2hex(random_bytes(16));
$pdo = db();
$handles = [];
try {
    $pdo->prepare("INSERT INTO users (email,password_hash,role,active,must_change) VALUES (?,?,'ADMIN',1,0)")
        ->execute([$adminEmail, password_hash($password, PASSWORD_DEFAULT)]);
    [$adminHandle, $adminCsrf] = clientGuestTest(); $handles[] = $adminHandle;
    assertGuestCheck(requestGuestTest($adminHandle, 'login', ['email'=>$adminEmail,'password'=>$password], [], $adminCsrf)['json']['ok'], 'Admin fixture login failed.');
    $created = requestGuestTest($adminHandle, 'add-user', ['email'=>$guestEmail,'role'=>'GUEST'], [], $adminCsrf);
    assertGuestCheck($created['json']['ok'], 'Admin cannot create guest.');
    [$guestHandle, $guestCsrf] = clientGuestTest(); $handles[] = $guestHandle;
    $login = requestGuestTest($guestHandle, 'login', ['email'=>$guestEmail,'password'=>'password'], [], $guestCsrf);
    assertGuestCheck($login['json']['data']['role'] === 'GUEST' && $login['json']['data']['mustChange'], 'Guest role or initial password state wrong.');
    assertGuestCheck(!requestGuestTest($guestHandle, 'list', null, ['currency'=>'IDR','perPage'=>10])['json']['ok'], 'Guest bypassed mandatory password change.');
    $changed = requestGuestTest($guestHandle, 'password', ['old'=>'password','new'=>$password], [], $guestCsrf);
    assertGuestCheck($changed['json']['ok'], 'Guest cannot change own initial password.');
    foreach (['IDR','USD'] as $currency) {
        $list = requestGuestTest($guestHandle, 'list', null, ['currency'=>$currency,'perPage'=>10]);
        assertGuestCheck($list['json']['ok'] && count($list['json']['data']['rows']) <= 10, 'Guest listing failed: ' . $currency);
    }
    assertGuestCheck(requestGuestTest($guestHandle, 'options', null, ['currency'=>'IDR','column'=>'4'])['json']['ok'], 'Guest cannot use listing filters.');
    $empty = requestGuestTest($guestHandle, 'list', null, ['currency'=>'IDR','keyword'=>$prefix,'perPage'=>10]);
    assertGuestCheck($empty['json']['data']['total'] === 0, 'Guest filters not applied.');
    $export = requestGuestTest($guestHandle, 'export', null, ['currency'=>'IDR','keyword'=>$prefix,'perPage'=>10]);
    assertGuestCheck($export['status'] === 200 && str_starts_with($export['body'], "PK"), 'Guest cannot download filtered XLSX export.');
    $exportPath = tempnam(sys_get_temp_dir(), 'guest-export-');
    try {
        file_put_contents($exportPath, $export['body']);
        $zip = new ZipArchive();
        assertGuestCheck($zip->open($exportPath) === true, 'Guest export is not a valid workbook.');
        $sheet = simplexml_load_string($zip->getFromName('xl/worksheets/sheet1.xml'));
        $sheet->registerXPathNamespace('s', 'http://schemas.openxmlformats.org/spreadsheetml/2006/main');
        assertGuestCheck(count($sheet->xpath('//s:sheetData/s:row')) === 1, 'Guest export ignored empty-result filter.');
        $zip->close();
    } finally { if (is_file($exportPath)) unlink($exportPath); }
    foreach (['dashboard','audit','users','vendors','sync-settings','sync-errors'] as $action) {
        $response = requestGuestTest($guestHandle, $action, null, ['currency'=>'IDR','perPage'=>10]);
        assertGuestCheck($response['status'] === 400, 'Guest unexpectedly accessed ' . $action);
    }
    $sample = $pdo->query("SELECT id,data FROM transactions WHERE currency='IDR' LIMIT 1")->fetch();
    $before = $sample ? $pdo->query('SELECT COUNT(*) FROM transactions')->fetchColumn() : null;
    foreach (['save','cancel','add-user','user-role','user-status','reset-user','sync','sync-snapshot','save-sync-settings','clear-sync-errors','purge-transactions'] as $action) {
        $response = requestGuestTest($guestHandle, $action, ['currency'=>'IDR','id'=>$sample['id'] ?? '', 'data'=>$sample ? json_decode($sample['data'], true) : [],'email'=>$guestEmail,'value'=>'ADMIN'], [], $guestCsrf);
        assertGuestCheck($response['status'] === 400 && str_contains($response['json']['error'], 'Guest'), 'Guest unexpectedly allowed ' . $action);
    }
    if ($sample) {
        $stmt = $pdo->prepare('SELECT data FROM transactions WHERE id=?'); $stmt->execute([$sample['id']]);
        assertGuestCheck($stmt->fetchColumn() === $sample['data'] && $pdo->query('SELECT COUNT(*) FROM transactions')->fetchColumn() === $before, 'Guest altered transaction data.');
    }
    assertGuestCheck(!requestGuestTest($adminHandle, 'user-role', ['email'=>$adminEmail,'value'=>'GUEST'], [], $adminCsrf)['json']['ok'], 'Admin can demote self.');
    assertGuestCheck(requestGuestTest($adminHandle, 'user-role', ['email'=>$guestEmail,'value'=>'USER'], [], $adminCsrf)['json']['ok'], 'Guest promotion failed.');
    assertGuestCheck(requestGuestTest($guestHandle, 'dashboard')['json']['ok'], 'Updated USER role not applied.');
    assertGuestCheck(requestGuestTest($adminHandle, 'user-role', ['email'=>$guestEmail,'value'=>'GUEST'], [], $adminCsrf)['json']['ok'], 'Guest assignment failed.');
    assertGuestCheck(requestGuestTest($guestHandle, 'dashboard')['status'] === 400, 'Existing session bypasses demotion.');
    assertGuestCheck(requestGuestTest($guestHandle, 'logout', [], [], $guestCsrf)['json']['ok'], 'Guest logout failed.');
    echo "Passed: guest creation, first-login password change, filtered listing/XLSX export, denied writes/admin APIs, role changes, and fixture cleanup.\n";
} finally {
    $pdo->prepare('DELETE FROM audit_logs WHERE email IN (?,?)')->execute([$adminEmail,$guestEmail]);
    $pdo->prepare('DELETE FROM users WHERE email IN (?,?)')->execute([$adminEmail,$guestEmail]);
    foreach ($handles as $handle) curl_close($handle);
}
