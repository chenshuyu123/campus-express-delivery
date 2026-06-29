/**
 * 校园快递代取系统 - 后端服务
 * 技术栈: Node.js + Express + sql.js (纯JS SQLite)
 */

const express = require('express');
const cors = require('cors');
const path = require('path');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const rateLimit = require('express-rate-limit');
const { getDatabase, saveDb } = require('./database');
const { initDatabase } = require('./init-db');

const app = express();
const PORT = process.env.PORT || 3000;

// JWT密钥
const JWT_SECRET = process.env.JWT_SECRET || 'campus_express_secret_key_2024';

// 全局数据库引用
let db = null;

// 中间件
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, 'public')));

// API限流
const apiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 200,
    message: { code: 429, message: '请求过于频繁，请稍后再试' }
});
app.use('/api/', apiLimiter);

// ==================== 工具函数 ====================

// JWT认证中间件
function authMiddleware(req, res, next) {
    const token = req.headers['authorization'];
    if (!token) {
        return res.json({ code: 401, message: '请先登录' });
    }
    try {
        const decoded = jwt.verify(token.replace('Bearer ', ''), JWT_SECRET);
        req.user = decoded;
        next();
    } catch (err) {
        return res.json({ code: 401, message: '登录已过期，请重新登录' });
    }
}

// 管理员权限检查（仅限用户名admin的管理员账号）
function adminMiddleware(req, res, next) {
    if (req.user.role !== 'admin' || req.user.username !== 'admin') {
        return res.json({ code: 403, message: '无权限访问，仅限系统管理员' });
    }
    next();
}

// 骑手权限检查
function riderMiddleware(req, res, next) {
    if (req.user.role !== 'rider') {
        return res.json({ code: 403, message: '无权限访问，请使用骑手账号' });
    }
    next();
}

// ==================== 认证接口 ====================

// ==================== 身份证号校验工具函数 ====================

/**
 * 校验身份证号格式与校验位
 * 规则：18位，前17位数字+最后1位数字或X
 * 校验位算法：ISO 7064:1983.MOD 11-2
 */
function isValidIdCard(idCard) {
    if (!idCard || typeof idCard !== 'string') return false;
    
    // 18位格式校验
    if (!/^\d{17}[\dXx]$/.test(idCard)) return false;
    
    // 校验位验证
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
    
    let sum = 0;
    for (let i = 0; i < 17; i++) {
        sum += parseInt(idCard[i]) * weights[i];
    }
    
    const checkChar = checkCodes[sum % 11];
    return idCard[17].toUpperCase() === checkChar;
}

/**
 * 校验手机号格式
 * 中国大陆手机号：1开头，第二位3-9，共11位
 */
function isValidPhone(phone) {
    return /^1[3-9]\d{9}$/.test(phone);
}

// ==================== 注册/登录 ====================

// 注册（身份证号 + 手机号双重认证）
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, phone, id_card, real_name, role, dormitory } = req.body;

        // 基本校验
        if (!username || !password) {
            return res.json({ code: 400, message: '用户名和密码不能为空' });
        }
        if (!phone) {
            return res.json({ code: 400, message: '手机号不能为空' });
        }
        if (!id_card) {
            return res.json({ code: 400, message: '身份证号不能为空' });
        }
        if (password.length < 6) {
            return res.json({ code: 400, message: '密码至少6位' });
        }

        // 手机号格式校验
        if (!isValidPhone(phone)) {
            return res.json({ code: 400, message: '手机号格式不正确，请输入11位中国大陆手机号' });
        }

        // 身份证号格式+校验位验证
        if (!isValidIdCard(id_card)) {
            return res.json({ code: 400, message: '身份证号格式不正确，请检查后重新输入' });
        }

        // 检查用户名是否已存在
        const existingUsername = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
        if (existingUsername) {
            return res.json({ code: 400, message: '该用户名已被注册' });
        }

        // 检查手机号是否已绑定
        const existingPhone = db.prepare('SELECT id FROM users WHERE phone = ?').get(phone);
        if (existingPhone) {
            return res.json({ code: 400, message: '该手机号已被其他账号绑定' });
        }

        // 检查身份证号是否已绑定（一个身份证只能绑定一个账号）
        const existingIdCard = db.prepare("SELECT id, username FROM users WHERE id_card = ? AND id_card != ''").get(id_card);
        if (existingIdCard) {
            return res.json({ code: 400, message: '该身份证号已被绑定到账号: ' + existingIdCard.username });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);
        const userId = uuidv4();
        const userRole = role || 'student';

        db.prepare(`
            INSERT INTO users (id, username, password, phone, id_card, real_name, role, dormitory, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `).run(userId, username, hashedPassword, phone, id_card, real_name || '', userRole, dormitory || '');

        const token = jwt.sign({ id: userId, username, role: userRole }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            code: 200,
            message: '注册成功',
            data: {
                token,
                user: { id: userId, username, phone, id_card, real_name: real_name || '', role: userRole, dormitory: dormitory || '' }
            }
        });
    } catch (err) {
        console.error('注册失败:', err);
        res.json({ code: 500, message: '注册失败: ' + err.message });
    }
});

// 登录（用户名/手机号 + 密码）
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password } = req.body;

        if (!username) {
            return res.json({ code: 400, message: '请输入用户名或手机号' });
        }
        if (!password) {
            return res.json({ code: 400, message: '请输入密码' });
        }

        // 支持用手机号或用户名登录
        let user;
        if (isValidPhone(username)) {
            user = db.prepare('SELECT * FROM users WHERE phone = ?').get(username);
        } else {
            user = db.prepare('SELECT * FROM users WHERE username = ?').get(username);
        }

        if (!user) {
            return res.json({ code: 400, message: '用户名或密码错误' });
        }

        if (user.status === 'banned') {
            return res.json({ code: 403, message: '账号已被封禁，请联系管理员' });
        }

        if (!bcrypt.compareSync(password, user.password)) {
            return res.json({ code: 400, message: '用户名或密码错误' });
        }

        if (user.role === 'rider' && user.verify_status === 'pending') {
            return res.json({ code: 403, message: '骑手账号审核中，请等待管理员审核' });
        }
        if (user.role === 'rider' && user.verify_status === 'rejected') {
            return res.json({ code: 403, message: '骑手认证未通过，请重新提交认证信息' });
        }

        const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            code: 200,
            message: '登录成功',
            data: {
                token,
                user: {
                    id: user.id,
                    username: user.username,
                    phone: user.phone,
                    id_card: user.id_card,
                    real_name: user.real_name,
                    role: user.role,
                    dormitory: user.dormitory,
                    avatar: user.avatar,
                    verify_status: user.verify_status,
                    balance: user.balance
                }
            }
        });
    } catch (err) {
        console.error('登录失败:', err);
        res.json({ code: 500, message: '登录失败: ' + err.message });
    }
});

// 获取当前用户信息
app.get('/api/auth/me', authMiddleware, (req, res) => {
    try {
        const user = db.prepare('SELECT id, username, phone, id_card, real_name, role, dormitory, avatar, verify_status, balance, status, created_at FROM users WHERE id = ?').get(req.user.id);
        if (!user) {
            return res.json({ code: 404, message: '用户不存在' });
        }
        // 脱敏处理：身份证号仅显示前6位和后4位
        if (user.id_card && user.id_card.length >= 10) {
            user.id_card_masked = user.id_card.slice(0, 6) + '********' + user.id_card.slice(-4);
        }
        res.json({ code: 200, data: user });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// 修改个人信息
app.post('/api/auth/update-profile', authMiddleware, async (req, res) => {
    try {
        const { real_name, phone, dormitory } = req.body;

        if (!phone) {
            return res.json({ code: 400, message: '手机号不能为空' });
        }

        // 检查手机号是否被其他用户占用
        const existing = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(phone, req.user.id);
        if (existing) {
            return res.json({ code: 400, message: '该手机号已被其他用户使用' });
        }

        db.prepare(`
            UPDATE users SET real_name = ?, phone = ?, dormitory = ?, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(real_name || '', phone, dormitory || '', req.user.id);

        res.json({ code: 200, message: '个人信息已更新' });
    } catch (err) {
        res.json({ code: 500, message: '更新失败: ' + err.message });
    }
});

// 修改密码
app.post('/api/auth/change-password', authMiddleware, async (req, res) => {
    try {
        const { old_password, new_password } = req.body;

        if (!old_password || !new_password) {
            return res.json({ code: 400, message: '请填写旧密码和新密码' });
        }

        if (new_password.length < 6) {
            return res.json({ code: 400, message: '新密码至少6位' });
        }

        const user = db.prepare('SELECT password FROM users WHERE id = ?').get(req.user.id);
        if (!user) {
            return res.json({ code: 404, message: '用户不存在' });
        }

        if (!bcrypt.compareSync(old_password, user.password)) {
            return res.json({ code: 400, message: '当前密码错误' });
        }

        const hashedPassword = bcrypt.hashSync(new_password, 10);
        db.prepare("UPDATE users SET password = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
            .run(hashedPassword, req.user.id);

        res.json({ code: 200, message: '密码修改成功，请重新登录' });
    } catch (err) {
        res.json({ code: 500, message: '修改失败: ' + err.message });
    }
});

// ==================== 骑手认证接口 ====================

app.post('/api/rider/verify', authMiddleware, async (req, res) => {
    try {
        const { real_name, student_id, phone, id_card } = req.body;

        if (!real_name || !student_id || !phone || !id_card) {
            return res.json({ code: 400, message: '请填写完整的认证信息' });
        }

        // 校验手机号格式
        if (!isValidPhone(phone)) {
            return res.json({ code: 400, message: '手机号格式不正确' });
        }

        // 校验身份证号格式
        if (!isValidIdCard(id_card)) {
            return res.json({ code: 400, message: '身份证号格式不正确' });
        }

        // 检查身份证号是否已被其他用户绑定
        const existingIdCard = db.prepare("SELECT id, username FROM users WHERE id_card = ? AND id != ? AND id_card != ''").get(id_card, req.user.id);
        if (existingIdCard) {
            return res.json({ code: 400, message: '该身份证号已被绑定到账号: ' + existingIdCard.username });
        }

        // 检查手机号是否已被其他用户使用
        const existingPhone = db.prepare('SELECT id FROM users WHERE phone = ? AND id != ?').get(phone, req.user.id);
        if (existingPhone) {
            return res.json({ code: 400, message: '该手机号已被其他用户使用' });
        }

        db.prepare(`
            UPDATE users SET 
                real_name = ?, 
                phone = ?, 
                student_id = ?,
                id_card = ?,
                role = 'rider',
                verify_status = 'pending',
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(real_name, phone, student_id, id_card, req.user.id);

        res.json({ code: 200, message: '认证信息已提交，请等待管理员审核' });
    } catch (err) {
        res.json({ code: 500, message: '提交失败: ' + err.message });
    }
});

// ==================== 计价配置接口 ====================

app.get('/api/config/pricing', (req, res) => {
    try {
        const configs = db.prepare('SELECT * FROM pricing_config').all();
        const pricing = {};
        configs.forEach(c => {
            pricing[c.config_key] = parseFloat(c.config_value);
        });
        res.json({ code: 200, data: pricing });
    } catch (err) {
        res.json({ code: 200, data: { small_price: 2, large_price: 5, urgent_fee: 3 } });
    }
});

// 首页公开统计
app.get('/api/home/stats', (req, res) => {
    try {
        const totalOrders = db.prepare('SELECT COUNT(*) as count FROM orders').get().count;
        const totalRiders = db.prepare("SELECT COUNT(*) as count FROM users WHERE role = 'rider' AND rider_status = 'approved'").get().count;
        const totalUsers = db.prepare('SELECT COUNT(*) as count FROM users').get().count;
        res.json({ code: 200, data: { totalOrders, totalRiders, totalUsers } });
    } catch (err) {
        res.json({ code: 200, data: { totalOrders: 0, totalRiders: 0, totalUsers: 0 } });
    }
});

// ==================== 订单接口 ====================

// 创建订单
app.post('/api/orders', authMiddleware, async (req, res) => {
    try {
        if (req.user.role !== 'student' && req.user.role !== 'admin') {
            return res.json({ code: 403, message: '仅学生用户可以下单' });
        }

        const { dormitory, building, cabinet, pickup_code, size, scheduled_time, remark } = req.body;

        if (!dormitory || !cabinet || !pickup_code) {
            return res.json({ code: 400, message: '请填写完整的快递信息' });
        }

        const smallPrice = db.prepare("SELECT config_value FROM pricing_config WHERE config_key = 'small_price'").get();
        const largePrice = db.prepare("SELECT config_value FROM pricing_config WHERE config_key = 'large_price'").get();
        const urgentFee = db.prepare("SELECT config_value FROM pricing_config WHERE config_key = 'urgent_fee'").get();

        const basePrice = size === 'large' ? parseFloat(largePrice?.config_value || 5) : parseFloat(smallPrice?.config_value || 2);

        let totalPrice = basePrice;
        let isUrgent = false;
        if (scheduled_time) {
            const scheduledDate = new Date(scheduled_time);
            const now = new Date();
            const hoursDiff = (scheduledDate - now) / (1000 * 60 * 60);
            if (hoursDiff <= 2 && hoursDiff > 0) {
                totalPrice += parseFloat(urgentFee?.config_value || 3);
                isUrgent = true;
            }
        }

        const orderId = uuidv4();
        const orderNo = 'EX' + Date.now().toString(36).toUpperCase();

        db.prepare(`
            INSERT INTO orders (id, order_no, student_id, dormitory, building, cabinet, pickup_code, size, total_price, scheduled_time, remark, status, is_urgent, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_payment', ?, datetime('now', 'localtime'), datetime('now', 'localtime'))
        `).run(orderId, orderNo, req.user.id, dormitory, building || '', cabinet, pickup_code, size, totalPrice, scheduled_time || null, remark || '', isUrgent ? 1 : 0);

        res.json({
            code: 200,
            message: '下单成功，请完成支付',
            data: { order_id: orderId, order_no: orderNo, total_price: totalPrice, is_urgent: isUrgent }
        });
    } catch (err) {
        console.error('下单失败:', err);
        res.json({ code: 500, message: '下单失败: ' + err.message });
    }
});

// 支付订单（余额支付）
app.post('/api/orders/:id/pay', authMiddleware, async (req, res) => {
    try {
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
        if (!order) return res.json({ code: 404, message: '订单不存在' });
        if (order.student_id !== req.user.id) return res.json({ code: 403, message: '无权操作此订单' });
        if (order.status !== 'pending_payment') return res.json({ code: 400, message: '订单状态不允许支付' });

        // 余额支付需要检查余额
        const student = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
        if (!student || student.balance < order.total_price) {
            return res.json({ code: 400, message: '账户余额不足，当前余额: ¥' + ((student?.balance || 0).toFixed(2)) });
        }

        // 扣减余额
        db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(order.total_price, req.user.id);

        const transactionId = 'TXN' + Date.now();

        db.prepare(`
            UPDATE orders SET 
                status = 'paid', 
                pay_time = datetime('now', 'localtime'),
                pay_method = 'balance',
                transaction_id = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(transactionId, order.id);

        const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id)?.balance || 0;

        db.prepare(`
            INSERT INTO fund_records (id, order_id, user_id, amount, type, description, balance_after, created_at)
            VALUES (?, ?, ?, ?, 'payment', ?, ?, datetime('now', 'localtime'))
        `).run(uuidv4(), order.id, req.user.id, order.total_price, '余额支付快递代取费用', newBalance);

        res.json({ code: 200, message: '支付成功' });
    } catch (err) {
        res.json({ code: 500, message: '支付失败: ' + err.message });
    }
});

// 支付宝支付
app.post('/api/orders/:id/alipay', authMiddleware, async (req, res) => {
    try {
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
        if (!order) return res.json({ code: 404, message: '订单不存在' });
        if (order.student_id !== req.user.id) return res.json({ code: 403, message: '无权操作此订单' });
        if (order.status !== 'pending_payment') return res.json({ code: 400, message: '订单状态不允许支付' });

        const transactionId = 'ALI' + Date.now();
        db.prepare(`
            UPDATE orders SET 
                status = 'paid', pay_time = datetime('now', 'localtime'),
                pay_method = 'alipay', transaction_id = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(transactionId, order.id);

        db.prepare(`
            INSERT INTO fund_records (id, order_id, user_id, amount, type, description, balance_after, created_at)
            VALUES (?, ?, ?, ?, 'payment', ?, 0, datetime('now', 'localtime'))
        `).run(uuidv4(), order.id, req.user.id, order.total_price, '支付宝支付快递代取费用');

        res.json({ code: 200, message: '支付宝支付成功' });
    } catch (err) {
        res.json({ code: 500, message: '支付失败: ' + err.message });
    }
});

// 微信支付
app.post('/api/orders/:id/wechatpay', authMiddleware, async (req, res) => {
    try {
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
        if (!order) return res.json({ code: 404, message: '订单不存在' });
        if (order.student_id !== req.user.id) return res.json({ code: 403, message: '无权操作此订单' });
        if (order.status !== 'pending_payment') return res.json({ code: 400, message: '订单状态不允许支付' });

        const transactionId = 'WX' + Date.now();
        db.prepare(`
            UPDATE orders SET 
                status = 'paid', pay_time = datetime('now', 'localtime'),
                pay_method = 'wechat', transaction_id = ?,
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(transactionId, order.id);

        db.prepare(`
            INSERT INTO fund_records (id, order_id, user_id, amount, type, description, balance_after, created_at)
            VALUES (?, ?, ?, ?, 'payment', ?, 0, datetime('now', 'localtime'))
        `).run(uuidv4(), order.id, req.user.id, order.total_price, '微信支付快递代取费用');

        res.json({ code: 200, message: '微信支付成功' });
    } catch (err) {
        res.json({ code: 500, message: '支付失败: ' + err.message });
    }
});

// 我的订单
app.get('/api/orders/my', authMiddleware, (req, res) => {
    try {
        const { status, page = 1, pageSize = 20 } = req.query;
        let sql = `SELECT o.*, r.real_name as rider_name, r.phone as rider_phone
                   FROM orders o LEFT JOIN users r ON o.rider_id = r.id
                   WHERE o.student_id = ?`;
        const params = [req.user.id];

        if (status) { sql += ' AND o.status = ?'; params.push(status); }

        const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
        const total = db.prepare(countSql).get(...params)?.total || 0;

        sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
        params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

        const orders = db.prepare(sql).all(...params);
        res.json({ code: 200, data: { orders, total, page: Number(page), pageSize: Number(pageSize) } });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// 所有订单（公开查看，需登录）
app.get('/api/orders/all', authMiddleware, (req, res) => {
    try {
        const { status, page = 1, pageSize = 20 } = req.query;
        let sql = `SELECT o.*, s.real_name as student_name, r.real_name as rider_name, r.phone as rider_phone
                   FROM orders o 
                   LEFT JOIN users s ON o.student_id = s.id
                   LEFT JOIN users r ON o.rider_id = r.id`;
        const params = [];

        if (status) { sql += ' WHERE o.status = ?'; params.push(status); }

        const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
        const total = db.prepare(countSql).get(...params)?.total || 0;

        sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
        params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

        const orders = db.prepare(sql).all(...params);
        res.json({ code: 200, data: { orders, total, page: Number(page), pageSize: Number(pageSize) } });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// 订单详情
app.get('/api/orders/:id', authMiddleware, (req, res) => {
    try {
        const order = db.prepare(`
            SELECT o.*, 
                   s.real_name as student_name, s.phone as student_phone,
                   r.real_name as rider_name, r.phone as rider_phone
            FROM orders o
            LEFT JOIN users s ON o.student_id = s.id
            LEFT JOIN users r ON o.rider_id = r.id
            WHERE o.id = ?
        `).get(req.params.id);

        if (!order) return res.json({ code: 404, message: '订单不存在' });
        res.json({ code: 200, data: order });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// 取消订单（全额退款）
app.post('/api/orders/:id/cancel', authMiddleware, async (req, res) => {
    try {
        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
        if (!order) return res.json({ code: 404, message: '订单不存在' });
        if (order.student_id !== req.user.id && req.user.role !== 'admin') {
            return res.json({ code: 403, message: '无权操作此订单' });
        }
        if (!['pending_payment', 'paid'].includes(order.status)) {
            return res.json({ code: 400, message: '当前订单状态不允许取消' });
        }

        if (order.status === 'paid') {
            db.prepare(`
                INSERT INTO fund_records (id, order_id, user_id, amount, type, description, created_at)
                VALUES (?, ?, ?, ?, 'refund', ?, datetime('now', 'localtime'))
            `).run(uuidv4(), order.id, order.student_id, order.total_price, '订单取消，全额退款');
        }

        db.prepare("UPDATE orders SET status = 'cancelled', updated_at = datetime('now', 'localtime') WHERE id = ?").run(order.id);
        res.json({ code: 200, message: '订单已取消' + (order.status === 'paid' ? '，费用已全额退款' : '') });
    } catch (err) {
        res.json({ code: 500, message: '取消失败: ' + err.message });
    }
});

// ==================== 骑手接口 ====================

// 抢单大厅
app.get('/api/rider/orders/available', authMiddleware, riderMiddleware, (req, res) => {
    try {
        const { page = 1, pageSize = 20 } = req.query;
        const orders = db.prepare(`
            SELECT o.*, s.real_name as student_name, s.dormitory as student_dormitory, s.phone as student_phone
            FROM orders o LEFT JOIN users s ON o.student_id = s.id
            WHERE o.status = 'paid'
            ORDER BY o.is_urgent DESC, o.created_at ASC
            LIMIT ? OFFSET ?
        `).all(Number(pageSize), (Number(page) - 1) * Number(pageSize));

        const total = db.prepare("SELECT COUNT(*) as total FROM orders WHERE status = 'paid'").get()?.total || 0;
        res.json({ code: 200, data: { orders, total, page: Number(page), pageSize: Number(pageSize) } });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// 抢单
app.post('/api/rider/orders/:id/grab', authMiddleware, riderMiddleware, async (req, res) => {
    try {
        const rider = db.prepare('SELECT verify_status FROM users WHERE id = ?').get(req.user.id);
        if (rider.verify_status !== 'approved') {
            return res.json({ code: 403, message: '您的骑手认证尚未通过审核' });
        }

        const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
        if (!order) return res.json({ code: 404, message: '订单不存在' });
        if (order.status !== 'paid') return res.json({ code: 400, message: '该订单已被抢走或状态不正确' });

        // 乐观锁：检查订单状态并更新
        const currentOrder = db.prepare("SELECT status FROM orders WHERE id = ? AND status = 'paid'").get(order.id);
        if (!currentOrder) {
            return res.json({ code: 400, message: '抢单失败，该订单已被其他骑手抢走' });
        }

        db.prepare(`
            UPDATE orders SET 
                status = 'accepted', rider_id = ?,
                accept_time = datetime('now', 'localtime'),
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(req.user.id, order.id);

        res.json({ code: 200, message: '抢单成功！请尽快完成取件和配送' });
    } catch (err) {
        res.json({ code: 500, message: '抢单失败: ' + err.message });
    }
});

// 骑手我的订单
app.get('/api/rider/orders/my', authMiddleware, riderMiddleware, (req, res) => {
    try {
        const { status, page = 1, pageSize = 20 } = req.query;
        let sql = 'SELECT o.*, s.real_name as student_name, s.phone as student_phone, s.dormitory as student_dormitory FROM orders o LEFT JOIN users s ON o.student_id = s.id WHERE o.rider_id = ?';
        const params = [req.user.id];

        if (status) {
            if (status === 'active') {
                sql += " AND o.status IN ('accepted', 'picked_up')";
            } else {
                sql += ' AND o.status = ?';
                params.push(status);
            }
        }

        sql += ' ORDER BY o.accept_time DESC LIMIT ? OFFSET ?';
        params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

        const orders = db.prepare(sql).all(...params);
        res.json({ code: 200, data: { orders, page: Number(page), pageSize: Number(pageSize) } });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// 标记取件
app.post('/api/rider/orders/:id/pickup', authMiddleware, riderMiddleware, async (req, res) => {
    try {
        const order = db.prepare('SELECT * FROM orders WHERE id = ? AND rider_id = ?').get(req.params.id, req.user.id);
        if (!order) return res.json({ code: 404, message: '订单不存在或不属于您' });
        if (order.status !== 'accepted') return res.json({ code: 400, message: '订单状态不正确' });

        db.prepare(`
            UPDATE orders SET 
                status = 'picked_up', pickup_time = datetime('now', 'localtime'),
                updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(order.id);

        res.json({ code: 200, message: '已标记取件完成' });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// 标记配送完成（佣金结算）
app.post('/api/rider/orders/:id/deliver', authMiddleware, riderMiddleware, async (req, res) => {
    try {
        const order = db.prepare('SELECT * FROM orders WHERE id = ? AND rider_id = ?').get(req.params.id, req.user.id);
        if (!order) return res.json({ code: 404, message: '订单不存在或不属于您' });
        if (order.status !== 'picked_up') return res.json({ code: 400, message: '请先标记取件完成' });

        const commissionRate = db.prepare("SELECT config_value FROM pricing_config WHERE config_key = 'commission_rate'").get();
        const rate = parseFloat(commissionRate?.config_value || 0.8);
        const commission = Math.round(order.total_price * rate * 100) / 100;

        db.prepare(`
            UPDATE orders SET 
                status = 'completed', complete_time = datetime('now', 'localtime'),
                commission = ?, updated_at = datetime('now', 'localtime')
            WHERE id = ?
        `).run(commission, order.id);

        db.prepare('UPDATE users SET balance = balance + ? WHERE id = ?').run(commission, req.user.id);

        const riderBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id)?.balance || 0;

        db.prepare(`
            INSERT INTO fund_records (id, order_id, user_id, amount, type, description, balance_after, created_at)
            VALUES (?, ?, ?, ?, 'commission', ?, ?, datetime('now', 'localtime'))
        `).run(uuidv4(), order.id, req.user.id, commission, '配送完成佣金', riderBalance);

        res.json({ code: 200, message: '配送完成！佣金 ' + commission + ' 元已到账', data: { commission } });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// 佣金明细
app.get('/api/rider/commission', authMiddleware, riderMiddleware, (req, res) => {
    try {
        const { page = 1, pageSize = 20 } = req.query;
        const records = db.prepare(`
            SELECT * FROM fund_records 
            WHERE user_id = ? AND type = 'commission'
            ORDER BY created_at DESC LIMIT ? OFFSET ?
        `).all(req.user.id, Number(pageSize), (Number(page) - 1) * Number(pageSize));

        const totalRow = db.prepare(
            "SELECT COALESCE(SUM(amount), 0) as total FROM fund_records WHERE user_id = ? AND type = 'commission'"
        ).get(req.user.id);
        const totalCommission = totalRow?.total || 0;

        const rider = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);

        res.json({
            code: 200,
            data: { records, total_commission: totalCommission, balance: rider?.balance || 0, page: Number(page) }
        });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// 提现
app.post('/api/rider/withdraw', authMiddleware, riderMiddleware, async (req, res) => {
    try {
        const { amount, account_type, account } = req.body;

        if (!amount || amount <= 0) {
            return res.json({ code: 400, message: '请输入有效的提现金额' });
        }

        const rider = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id);
        if (!rider || rider.balance < amount) {
            return res.json({ code: 400, message: '余额不足，当前余额: ' + (rider?.balance || 0) + ' 元' });
        }

        db.prepare('UPDATE users SET balance = balance - ? WHERE id = ?').run(amount, req.user.id);

        const newBalance = db.prepare('SELECT balance FROM users WHERE id = ?').get(req.user.id)?.balance || 0;

        db.prepare(`
            INSERT INTO fund_records (id, user_id, amount, type, description, balance_after, created_at)
            VALUES (?, ?, ?, 'withdraw', ?, ?, datetime('now', 'localtime'))
        `).run(uuidv4(), req.user.id, amount, '提现到' + (account_type || '微信') + '(' + (account || '') + ')', newBalance);

        res.json({ code: 200, message: '提现申请已提交，预计1-3个工作日到账', data: { amount, balance: newBalance } });
    } catch (err) {
        res.json({ code: 500, message: '提现失败: ' + err.message });
    }
});

// ==================== 管理员接口 ====================

// 骑手审核列表
app.get('/api/admin/riders/pending', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const riders = db.prepare(
            "SELECT id, username, phone, real_name, student_id, id_card, verify_status, created_at FROM users WHERE role = 'rider' AND verify_status IN ('pending', 'approved', 'rejected') ORDER BY created_at DESC"
        ).all();
        res.json({ code: 200, data: riders });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// 审核骑手
app.post('/api/admin/riders/:id/verify', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { action, reason } = req.body;
        if (!['approve', 'reject'].includes(action)) {
            return res.json({ code: 400, message: '操作无效' });
        }

        const status = action === 'approve' ? 'approved' : 'rejected';
        db.prepare("UPDATE users SET verify_status = ?, verify_reason = ?, updated_at = datetime('now', 'localtime') WHERE id = ?")
            .run(status, reason || '', req.params.id);

        res.json({ code: 200, message: action === 'approve' ? '已通过审核' : '已拒绝审核' });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// 全部订单
app.get('/api/admin/orders', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { status, keyword, page = 1, pageSize = 15, startDate, endDate } = req.query;
        let sql = `
            SELECT o.*, s.real_name as student_name, r.real_name as rider_name
            FROM orders o LEFT JOIN users s ON o.student_id = s.id LEFT JOIN users r ON o.rider_id = r.id
            WHERE 1=1
        `;
        const params = [];

        if (status) { sql += ' AND o.status = ?'; params.push(status); }
        if (keyword) {
            sql += ' AND (o.order_no LIKE ? OR o.cabinet LIKE ? OR s.real_name LIKE ? OR r.real_name LIKE ?)';
            const kw = '%' + keyword + '%';
            params.push(kw, kw, kw, kw);
        }
        if (startDate) { sql += ' AND o.created_at >= ?'; params.push(startDate); }
        if (endDate) { sql += ' AND o.created_at <= ?'; params.push(endDate + ' 23:59:59'); }

        const countSql = sql.replace(/SELECT[\s\S]*?FROM/, 'SELECT COUNT(*) as total FROM');
        const total = db.prepare(countSql).get(...params)?.total || 0;

        sql += ' ORDER BY o.created_at DESC LIMIT ? OFFSET ?';
        params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

        const orders = db.prepare(sql).all(...params);
        res.json({ code: 200, data: { orders, total, page: Number(page), pageSize: Number(pageSize) } });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// 导出Excel
app.get('/api/admin/orders/export', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const XLSX = require('xlsx');

        const orders = db.prepare(`
            SELECT o.order_no as '订单编号',
                   s.real_name as '学生姓名', s.phone as '学生电话',
                   o.dormitory as '宿舍楼', o.building as '楼栋号',
                   o.cabinet as '快递站点', o.pickup_code as '取件码',
                   CASE o.size WHEN 'small' THEN '小件' WHEN 'large' THEN '大件' ELSE o.size END as '包裹大小',
                   o.total_price as '金额(元)',
                   CASE o.status 
                       WHEN 'pending_payment' THEN '待支付' WHEN 'paid' THEN '待接单'
                       WHEN 'accepted' THEN '已接单' WHEN 'picked_up' THEN '已取件'
                       WHEN 'completed' THEN '已完成' WHEN 'cancelled' THEN '已取消'
                       ELSE o.status END as '订单状态',
                   r.real_name as '骑手姓名', o.commission as '佣金(元)',
                   o.created_at as '下单时间', o.pay_time as '支付时间',
                   o.accept_time as '接单时间', o.complete_time as '完成时间'
            FROM orders o
            LEFT JOIN users s ON o.student_id = s.id
            LEFT JOIN users r ON o.rider_id = r.id
            ORDER BY o.created_at DESC
        `).all();

        const ws = XLSX.utils.json_to_sheet(orders);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, '订单数据');

        const buffer = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });

        res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
        res.setHeader('Content-Disposition', 'attachment; filename=orders_' + new Date().toISOString().slice(0, 10) + '.xlsx');
        res.send(buffer);
    } catch (err) {
        res.json({ code: 500, message: '导出失败: ' + err.message });
    }
});

// 数据统计
app.get('/api/admin/statistics', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const todayStats = db.prepare(`
            SELECT 
                COUNT(*) as total_orders,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed_orders,
                COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) as cancelled_orders,
                COALESCE(SUM(CASE WHEN status = 'paid' THEN 1 ELSE 0 END), 0) as pending_orders,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END), 0) as total_revenue,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN commission ELSE 0 END), 0) as total_commission
            FROM orders WHERE date(created_at) = date('now', 'localtime')
        `).get() || {};

        const monthStats = db.prepare(`
            SELECT 
                COUNT(*) as total_orders,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed_orders,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END), 0) as total_revenue,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN commission ELSE 0 END), 0) as total_commission
            FROM orders WHERE strftime('%Y-%m', created_at) = strftime('%Y-%m', 'now', 'localtime')
        `).get() || {};

        const dailyStats = db.prepare(`
            SELECT 
                date(created_at) as date,
                COUNT(*) as total,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END), 0) as completed,
                COALESCE(SUM(CASE WHEN status = 'completed' THEN total_price ELSE 0 END), 0) as revenue
            FROM orders
            WHERE created_at >= date('now', '-30 days', 'localtime')
            GROUP BY date(created_at) ORDER BY date ASC
        `).all();

        const totalUsers = db.prepare("SELECT COUNT(*) as total FROM users WHERE role = 'student'").get()?.total || 0;
        const totalRiders = db.prepare("SELECT COUNT(*) as total FROM users WHERE role = 'rider' AND verify_status = 'approved'").get()?.total || 0;
        const totalOrders = db.prepare('SELECT COUNT(*) as total FROM orders').get()?.total || 0;
        const totalRevenue = db.prepare("SELECT COALESCE(SUM(total_price), 0) as total FROM orders WHERE status = 'completed'").get()?.total || 0;

        res.json({
            code: 200,
            data: {
                today: todayStats,
                month: monthStats,
                daily: dailyStats,
                overview: { total_users: totalUsers, total_riders: totalRiders, total_orders: totalOrders, total_revenue: totalRevenue }
            }
        });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// 更新收费标准
app.post('/api/admin/pricing', authMiddleware, adminMiddleware, async (req, res) => {
    try {
        const { small_price, large_price, urgent_fee, commission_rate } = req.body;

        const updates = [
            { key: 'small_price', value: small_price },
            { key: 'large_price', value: large_price },
            { key: 'urgent_fee', value: urgent_fee },
            { key: 'commission_rate', value: commission_rate }
        ];

        for (const u of updates) {
            if (u.value !== undefined && u.value !== null) {
                const existing = db.prepare('SELECT config_key FROM pricing_config WHERE config_key = ?').get(u.key);
                if (existing) {
                    db.prepare("UPDATE pricing_config SET config_value = ?, updated_at = datetime('now', 'localtime') WHERE config_key = ?")
                        .run(String(u.value), u.key);
                } else {
                    db.prepare("INSERT INTO pricing_config (config_key, config_value) VALUES (?, ?)")
                        .run(u.key, String(u.value));
                }
            }
        }

        res.json({ code: 200, message: '收费标准已更新' });
    } catch (err) {
        res.json({ code: 500, message: '更新失败: ' + err.message });
    }
});

// 用户列表
app.get('/api/admin/users', authMiddleware, adminMiddleware, (req, res) => {
    try {
        const { role, page = 1, pageSize = 50 } = req.query;
        let sql = 'SELECT id, username, phone, real_name, role, dormitory, verify_status, status, balance, created_at FROM users WHERE 1=1';
        const params = [];

        if (role) { sql += ' AND role = ?'; params.push(role); }

        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
        params.push(Number(pageSize), (Number(page) - 1) * Number(pageSize));

        const users = db.prepare(sql).all(...params);
        res.json({ code: 200, data: users });
    } catch (err) {
        res.json({ code: 500, message: err.message });
    }
});

// ==================== 通用接口 ====================

app.get('/api/health', (req, res) => {
    res.json({ code: 200, message: '服务运行正常', time: new Date().toISOString() });
});

// 前端页面路由
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/student', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/rider', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));

// ==================== 启动 ====================
async function startServer() {
    // 初始化数据库
    db = await getDatabase();
    await initDatabase();

    // 创建默认管理员
    const adminUser = db.prepare("SELECT id FROM users WHERE username = 'admin'").get();
    if (!adminUser) {
        const hashedPassword = bcrypt.hashSync('admin123', 10);
        db.prepare(`
            INSERT INTO users (id, username, password, phone, real_name, role, verify_status, status, balance)
            VALUES (?, ?, ?, ?, ?, 'admin', 'approved', 'active', 0)
        `).run(uuidv4(), 'admin', hashedPassword, '13800000000', '系统管理员');
        console.log('默认管理员已创建: admin / admin123');
    }

    // 创建测试学生账号
    const testStudent = db.prepare("SELECT id FROM users WHERE username = 'student'").get();
    if (!testStudent) {
        const hashedPassword = bcrypt.hashSync('123456', 10);
        db.prepare(`
            INSERT INTO users (id, username, password, phone, real_name, role, dormitory, verify_status, status)
            VALUES (?, ?, ?, ?, ?, 'student', '东1楼', 'none', 'active')
        `).run(uuidv4(), 'student', hashedPassword, '13900000001', '测试学生');
        console.log('测试学生账号已创建: student / 123456');
    }

    // 创建测试骑手账号
    const testRider = db.prepare("SELECT id FROM users WHERE username = 'rider'").get();
    if (!testRider) {
        const hashedPassword = bcrypt.hashSync('123456', 10);
        db.prepare(`
            INSERT INTO users (id, username, password, phone, real_name, role, student_id, verify_status, status)
            VALUES (?, ?, ?, ?, ?, 'rider', '2024001', 'approved', 'active')
        `).run(uuidv4(), 'rider', hashedPassword, '13900000002', '测试骑手');
        console.log('测试骑手账号已创建: rider / 123456');
    }

    // 启动HTTP服务
    app.listen(PORT, '0.0.0.0', () => {
        console.log('');
        console.log('═══════════════════════════════════════════════════════');
        console.log('  校园快递代取系统 - Campus Express Delivery');
        console.log('═══════════════════════════════════════════════════════');
        console.log('  服务地址: http://localhost:' + PORT);
        console.log('  管理员账号: admin / admin123');
        console.log('  学生账号:   student / 123456');
        console.log('  骑手账号:   rider / 123456');
        console.log('═══════════════════════════════════════════════════════');
        console.log('  公网隧道由 tunnel.js 独立管理');
        console.log('');
    });
}

startServer().catch(err => {
    console.error('启动失败:', err);
    process.exit(1);
});

module.exports = app;
