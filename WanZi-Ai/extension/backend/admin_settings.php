<?php
session_start();
require_once __DIR__ . '/db.php';

if (!isset($_SESSION['admin_logged_in']) || !$_SESSION['admin_logged_in']) {
    header('Location: admin.php');
    exit;
}

$message = '';
$messageType = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $latestVersion = $_POST['latest_version'] ?? '2.0.0';
    $forceUpdate = isset($_POST['force_update']) ? '1' : '0';
    $updateUrl = $_POST['update_url'] ?? '';
    $updateMessage = $_POST['update_message'] ?? '';
    
    try {
        $stmt = $pdo->prepare("INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?");
        $stmt->execute(['latest_version', $latestVersion, $latestVersion]);
        $stmt->execute(['force_update', $forceUpdate, $forceUpdate]);
        $stmt->execute(['update_url', $updateUrl, $updateUrl]);
        $stmt->execute(['update_message', $updateMessage, $updateMessage]);
        
        $message = '设置已保存';
        $messageType = 'success';
    } catch (Exception $e) {
        $message = '保存失败: ' . $e->getMessage();
        $messageType = 'error';
    }
}

$settings = [];
try {
    $stmt = $pdo->query("SELECT setting_key, setting_value FROM settings");
    while ($row = $stmt->fetch(PDO::FETCH_ASSOC)) {
        $settings[$row['setting_key']] = $row['setting_value'];
    }
} catch (Exception $e) {}

$latestVersion = $settings['latest_version'] ?? '2.0.0';
$forceUpdate = ($settings['force_update'] ?? '0') === '1';
$updateUrl = $settings['update_url'] ?? 'https://qcnvg5g6y7fm.feishu.cn/wiki/QD8lwEKcoiiZBVkf2H7chA7SnSh';
$updateMessage = $settings['update_message'] ?? '';
?>
<!DOCTYPE html>
<html lang="zh-CN">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>版本设置 - 丸子Ai 管理后台</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: 'Segoe UI', sans-serif; background: linear-gradient(135deg, #1a1a2e, #16213e); min-height: 100vh; color: #fff; }
        .container { max-width: 600px; margin: 0 auto; padding: 40px 20px; }
        .card { background: rgba(255,255,255,0.05); border-radius: 16px; padding: 30px; border: 1px solid rgba(255,255,255,0.1); }
        h1 { font-size: 24px; margin-bottom: 30px; display: flex; align-items: center; gap: 10px; }
        .form-group { margin-bottom: 20px; }
        label { display: block; font-size: 14px; color: rgba(255,255,255,0.7); margin-bottom: 8px; }
        input[type="text"], textarea { width: 100%; padding: 12px 16px; background: rgba(0,0,0,0.3); border: 1px solid rgba(255,255,255,0.1); border-radius: 8px; color: #fff; font-size: 14px; }
        input[type="text"]:focus, textarea:focus { outline: none; border-color: #4da3ff; }
        textarea { resize: vertical; min-height: 80px; }
        .checkbox-group { display: flex; align-items: center; gap: 10px; }
        input[type="checkbox"] { width: 20px; height: 20px; accent-color: #4da3ff; }
        .btn { display: inline-block; padding: 12px 24px; background: linear-gradient(135deg, #4da3ff, #7c5cff); border: none; border-radius: 8px; color: #fff; font-size: 14px; font-weight: 600; cursor: pointer; transition: transform 0.2s, box-shadow 0.2s; }
        .btn:hover { transform: translateY(-2px); box-shadow: 0 4px 20px rgba(77,163,255,0.4); }
        .message { padding: 12px 16px; border-radius: 8px; margin-bottom: 20px; font-size: 14px; }
        .message.success { background: rgba(34,197,94,0.2); border: 1px solid rgba(34,197,94,0.4); color: #22c55e; }
        .message.error { background: rgba(239,68,68,0.2); border: 1px solid rgba(239,68,68,0.4); color: #ef4444; }
        .back-link { display: inline-block; margin-bottom: 20px; color: rgba(255,255,255,0.6); text-decoration: none; font-size: 14px; }
        .back-link:hover { color: #4da3ff; }
        .hint { font-size: 12px; color: rgba(255,255,255,0.4); margin-top: 4px; }
    </style>
</head>
<body>
    <div class="container">
        <a href="admin.php" class="back-link">← 返回管理后台</a>
        <div class="card">
            <h1>🔄 版本设置</h1>
            
            <?php if ($message): ?>
            <div class="message <?php echo $messageType; ?>"><?php echo htmlspecialchars($message); ?></div>
            <?php endif; ?>
            
            <form method="POST">
                <div class="form-group">
                    <label>最新版本号</label>
                    <input type="text" name="latest_version" value="<?php echo htmlspecialchars($latestVersion); ?>" placeholder="例如: 2.0.0">
                    <div class="hint">用户插件版本低于此版本时会提示更新</div>
                </div>
                
                <div class="form-group">
                    <div class="checkbox-group">
                        <input type="checkbox" name="force_update" id="force_update" <?php echo $forceUpdate ? 'checked' : ''; ?>>
                        <label for="force_update" style="margin-bottom: 0;">强制更新</label>
                    </div>
                    <div class="hint">开启后用户必须更新才能激活卡密</div>
                </div>
                
                <div class="form-group">
                    <label>更新链接</label>
                    <input type="text" name="update_url" value="<?php echo htmlspecialchars($updateUrl); ?>" placeholder="https://...">
                    <div class="hint">点击"立即更新"后跳转的链接</div>
                </div>
                
                <div class="form-group">
                    <label>更新说明</label>
                    <textarea name="update_message" placeholder="本次更新内容..."><?php echo htmlspecialchars($updateMessage); ?></textarea>
                    <div class="hint">可选，显示在更新提示中</div>
                </div>
                
                <button type="submit" class="btn">💾 保存设置</button>
            </form>
        </div>
    </div>
</body>
</html>
