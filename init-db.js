/**
 * 数据库表初始化 - 使用 sql.js
 */

const { getDatabase } = require('./database');

async function initDatabase() {
    console.log('正在初始化数据库...');
    const db = await getDatabase();

    // 用户表
    db.exec(`
        CREATE TABLE IF NOT EXISTS users (
            id TEXT PRIMARY KEY,
            username TEXT UNIQUE NOT NULL,
            password TEXT NOT NULL,
            phone TEXT NOT NULL,
            real_name TEXT DEFAULT '',
            student_id TEXT DEFAULT '',
            id_card TEXT DEFAULT '',
            role TEXT DEFAULT 'student' CHECK(role IN ('student', 'rider', 'admin')),
            dormitory TEXT DEFAULT '',
            avatar TEXT DEFAULT '',
            verify_status TEXT DEFAULT 'none' CHECK(verify_status IN ('none', 'pending', 'approved', 'rejected')),
            verify_reason TEXT DEFAULT '',
            balance REAL DEFAULT 0,
            status TEXT DEFAULT 'active' CHECK(status IN ('active', 'banned')),
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `);

    // 订单表
    db.exec(`
        CREATE TABLE IF NOT EXISTS orders (
            id TEXT PRIMARY KEY,
            order_no TEXT UNIQUE NOT NULL,
            student_id TEXT NOT NULL,
            rider_id TEXT DEFAULT NULL,
            dormitory TEXT NOT NULL,
            building TEXT DEFAULT '',
            cabinet TEXT NOT NULL,
            pickup_code TEXT NOT NULL,
            size TEXT DEFAULT 'small' CHECK(size IN ('small', 'large')),
            total_price REAL NOT NULL,
            pay_method TEXT DEFAULT 'balance',
            transaction_id TEXT DEFAULT '',
            scheduled_time TEXT DEFAULT NULL,
            remark TEXT DEFAULT '',
            status TEXT DEFAULT 'pending_payment' CHECK(status IN ('pending_payment', 'paid', 'accepted', 'picked_up', 'completed', 'cancelled')),
            is_urgent INTEGER DEFAULT 0,
            commission REAL DEFAULT 0,
            pay_time TEXT DEFAULT NULL,
            accept_time TEXT DEFAULT NULL,
            pickup_time TEXT DEFAULT NULL,
            complete_time TEXT DEFAULT NULL,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            updated_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (student_id) REFERENCES users(id),
            FOREIGN KEY (rider_id) REFERENCES users(id)
        )
    `);

    // 索引
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_orders_student ON orders(student_id);
        CREATE INDEX IF NOT EXISTS idx_orders_rider ON orders(rider_id);
        CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
        CREATE INDEX IF NOT EXISTS idx_orders_created ON orders(created_at);
        CREATE INDEX IF NOT EXISTS idx_orders_order_no ON orders(order_no);
    `);

    // 资金流水表
    db.exec(`
        CREATE TABLE IF NOT EXISTS fund_records (
            id TEXT PRIMARY KEY,
            order_id TEXT DEFAULT NULL,
            user_id TEXT NOT NULL,
            amount REAL NOT NULL,
            type TEXT NOT NULL CHECK(type IN ('payment', 'refund', 'commission', 'withdraw')),
            description TEXT DEFAULT '',
            balance_after REAL DEFAULT 0,
            created_at TEXT DEFAULT (datetime('now', 'localtime')),
            FOREIGN KEY (user_id) REFERENCES users(id)
        )
    `);

    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_fund_user ON fund_records(user_id);
        CREATE INDEX IF NOT EXISTS idx_fund_type ON fund_records(type);
        CREATE INDEX IF NOT EXISTS idx_fund_created ON fund_records(created_at);
    `);

    // 计价配置表
    db.exec(`
        CREATE TABLE IF NOT EXISTS pricing_config (
            config_key TEXT PRIMARY KEY,
            config_value TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now', 'localtime'))
        )
    `);

    // 插入默认配置
    const insertConfig = (key, value) => {
        const existing = db.prepare("SELECT config_key FROM pricing_config WHERE config_key = ?").get(key);
        if (!existing) {
            db.prepare("INSERT INTO pricing_config (config_key, config_value) VALUES (?, ?)").run(key, value);
        }
    };

    insertConfig('small_price', '2');
    insertConfig('large_price', '5');
    insertConfig('urgent_fee', '3');
    insertConfig('commission_rate', '0.8');

    console.log('数据库初始化完成');
}

// 如果直接运行此文件则初始化
if (require.main === module) {
    initDatabase().then(() => {
        console.log('数据库表已创建');
        process.exit(0);
    }).catch(err => {
        console.error('初始化失败:', err);
        process.exit(1);
    });
}

module.exports = { initDatabase };
