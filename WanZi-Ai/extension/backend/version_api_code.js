// ============ 版本检测API - 添加到 app.js ============

// 在数据库初始化后添加以下代码来创建settings表
/*
在 initDatabase 函数中添加:

await pool.execute(\`
    CREATE TABLE IF NOT EXISTS settings (
        id INT AUTO_INCREMENT PRIMARY KEY,
        setting_key VARCHAR(64) NOT NULL UNIQUE,
        setting_value TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
\`);

await pool.execute(\`
    INSERT IGNORE INTO settings (setting_key, setting_value) VALUES 
    ('latest_version', '2.0.0'),
    ('force_update', '0'),
    ('update_url', 'https://qcnvg5g6y7fm.feishu.cn/wiki/QD8lwEKcoiiZBVkf2H7chA7SnSh'),
    ('update_message', '')
\`);
*/

// ============ 版本检测接口 ============
app.post('/api/version', async (req, res) => {
    try {
        const { currentVersion } = req.body;
        
        const [rows] = await pool.execute('SELECT setting_key, setting_value FROM settings WHERE setting_key IN (?, ?, ?, ?)', 
            ['latest_version', 'force_update', 'update_url', 'update_message']);
        
        const settings = {};
        rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });
        
        res.json({
            latestVersion: settings.latest_version || currentVersion || '2.0.0',
            forceUpdate: settings.force_update === '1',
            updateUrl: settings.update_url || 'https://qcnvg5g6y7fm.feishu.cn/wiki/QD8lwEKcoiiZBVkf2H7chA7SnSh',
            message: settings.update_message || ''
        });
    } catch (error) {
        res.json({
            latestVersion: req.body.currentVersion || '2.0.0',
            forceUpdate: false,
            updateUrl: '',
            message: ''
        });
    }
});

// ============ 获取设置接口（管理后台用） ============
app.get('/api/admin/settings', async (req, res) => {
    try {
        const [rows] = await pool.execute('SELECT setting_key, setting_value FROM settings');
        const settings = {};
        rows.forEach(row => {
            settings[row.setting_key] = row.setting_value;
        });
        res.json({ success: true, data: settings });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});

// ============ 保存设置接口（管理后台用） ============
app.post('/api/admin/settings', async (req, res) => {
    try {
        const { latest_version, force_update, update_url, update_message } = req.body;
        
        const updates = [
            ['latest_version', latest_version || '2.0.0'],
            ['force_update', force_update ? '1' : '0'],
            ['update_url', update_url || ''],
            ['update_message', update_message || '']
        ];
        
        for (const [key, value] of updates) {
            await pool.execute(
                'INSERT INTO settings (setting_key, setting_value) VALUES (?, ?) ON DUPLICATE KEY UPDATE setting_value = ?',
                [key, value, value]
            );
        }
        
        res.json({ success: true, message: '设置已保存' });
    } catch (error) {
        res.json({ success: false, message: error.message });
    }
});
