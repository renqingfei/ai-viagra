-- 创建设置表（如果不存在）
CREATE TABLE IF NOT EXISTS settings (
    id INT AUTO_INCREMENT PRIMARY KEY,
    setting_key VARCHAR(64) NOT NULL UNIQUE,
    setting_value TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- 初始化版本设置
INSERT INTO settings (setting_key, setting_value) VALUES 
('latest_version', '2.0.0'),
('force_update', '0'),
('update_url', 'https://qcnvg5g6y7fm.feishu.cn/wiki/QD8lwEKcoiiZBVkf2H7chA7SnSh'),
('update_message', '')
ON DUPLICATE KEY UPDATE setting_key = setting_key;

-- 修改licenses表的code字段长度
ALTER TABLE licenses MODIFY COLUMN code VARCHAR(128);
