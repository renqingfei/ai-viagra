<?php
header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit;
}

require_once __DIR__ . '/db.php';

$input = json_decode(file_get_contents('php://input'), true);
$currentVersion = $input['currentVersion'] ?? '0.0.0';

try {
    $stmt = $pdo->query("SELECT setting_value FROM settings WHERE setting_key = 'latest_version' LIMIT 1");
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $latestVersion = $row ? $row['setting_value'] : $currentVersion;
    
    $stmt = $pdo->query("SELECT setting_value FROM settings WHERE setting_key = 'force_update' LIMIT 1");
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $forceUpdate = $row && $row['setting_value'] === '1';
    
    $stmt = $pdo->query("SELECT setting_value FROM settings WHERE setting_key = 'update_url' LIMIT 1");
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $updateUrl = $row ? $row['setting_value'] : 'https://qcnvg5g6y7fm.feishu.cn/wiki/QD8lwEKcoiiZBVkf2H7chA7SnSh';
    
    $stmt = $pdo->query("SELECT setting_value FROM settings WHERE setting_key = 'update_message' LIMIT 1");
    $row = $stmt->fetch(PDO::FETCH_ASSOC);
    $message = $row ? $row['setting_value'] : '';
    
    echo json_encode([
        'latestVersion' => $latestVersion,
        'forceUpdate' => $forceUpdate,
        'updateUrl' => $updateUrl,
        'message' => $message
    ]);
} catch (Exception $e) {
    echo json_encode([
        'latestVersion' => $currentVersion,
        'forceUpdate' => false,
        'updateUrl' => '',
        'message' => ''
    ]);
}
