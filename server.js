/**
 * 校园快递代取系统 - 后端服务
 * 技术栈: Node.js + Express + sql.js (纯JS SQLite)
 */

// 强制 DNS 使用 IPv4，解决 Railway IPv6 不可达问题
const dns = require('dns');
dns.setDefaultResultOrder('ipv4first');

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

// ==================== 邮箱验证码配置 ====================
const nodemailer = require('nodemailer');

// QQ邮箱配置（也支持163等其他邮箱）
const EMAIL_CONFIG = {
    host: process.env.EMAIL_HOST || 'smtp.qq.com',
    port: parseInt(process.env.EMAIL_PORT) || 465,
    secure: true,
    auth: {
        user: process.env.EMAIL_USER || '',
        pass: process.env.EMAIL_PASS || ''
    }
};

function getTransporter() {
    // 每次都重新创建，确保使用最新的环境变量
    const port = parseInt(process.env.EMAIL_PORT) || 465;
    return nodemailer.createTransport({
        host: process.env.EMAIL_HOST || 'smtp.qq.com',
        port: port,
        secure: true,
        auth: {
            user: process.env.EMAIL_USER || '',
            pass: process.env.EMAIL_PASS || ''
        },
        tls: {
            rejectUnauthorized: false
        },
        // 强制使用 IPv4，避免 Railway 的 IPv6 问题
        connectionTimeout: 10000,
        greetingTimeout: 10000,
        socketTimeout: 10000
    });
}

// 生成6位随机验证码
function generateCode() {
    return Math.floor(100000 + Math.random() * 900000).toString();
}

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

// 管理员权限检查
function adminMiddleware(req, res, next) {
    if (req.user.role !== 'admin') {
        return res.json({ code: 403, message: '无权限访问' });
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

// ==================== 邮箱验证码 ====================

// 发送邮箱验证码
const sendCodeLimiter = rateLimit({
    windowMs: 60 * 1000, // 1分钟内
    max: 1, // 最多1次
    message: { code: 429, message: '发送过于频繁，请60秒后再试' }
});

app.post('/api/auth/send-code', sendCodeLimiter, async (req, res) => {
    try {
        const { email, type } = req.body;

        if (!email) {
            return res.json({ code: 400, message: '请输入邮箱地址' });
        }

        // 检查邮箱格式
        const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
        if (!emailRegex.test(email)) {
            return res.json({ code: 400, message: '邮箱格式不正确' });
        }

        // 注册时检查邮箱是否已注册
        if (type === 'register') {
            const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
            if (existing) {
                return res.json({ code: 400, message: '该邮箱已被注册' });
            }
        }

        // 登录时检查邮箱是否存在
        if (type === 'login') {
            const existing = db.prepare('SELECT id FROM users WHERE email = ?').get(email);
            if (!existing) {
                return res.json({ code: 400, message: '该邮箱未注册' });
            }
        }

        // 生成验证码
        const code = generateCode();

        // 存入数据库（5分钟有效）
        const expiresAt = new Date(Date.now() + 5 * 60 * 1000).toISOString();
        db.prepare(`
            INSERT INTO email_codes (email, code, type, expires_at)
            VALUES (?, ?, ?, ?)
        `).run(email, code, type || 'register', expiresAt);

        // 发送邮件
        const mailer = getTransporter();
        
        // 调试日志
        console.log('邮件配置检查:', {
            host: process.env.EMAIL_HOST || 'smtp.qq.com',
            user: process.env.EMAIL_USER ? process.env.EMAIL_USER.substring(0, 5) + '***' : '未设置',
            passExist: !!process.env.EMAIL_PASS
        });
        
        const typeNames = { register: '注册', login: '登录', reset_password: '重置密码' };
        const typeName = typeNames[type] || '验证';

        const mailResult = await mailer.sendMail({
            from: `"校园快递系统" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: `校园快递系统 - ${typeName}验证码`,
            html: `
                <div style="max-width:500px;margin:0 auto;padding:20px;font-family:Arial,sans-serif;">
                    <h2 style="color:#1a73e8;">校园快递代取系统</h2>
                    <p>您的${typeName}验证码是：</p>
                    <div style="background:#f0f4ff;padding:15px;text-align:center;border-radius:8px;margin:20px 0;">
                        <span style="font-size:32px;font-weight:bold;color:#1a73e8;letter-spacing:5px;">${code}</span>
                    </div>
                    <p style="color:#666;">验证码5分钟内有效，请勿泄露给他人。</p>
                    <hr style="border:none;border-top:1px solid #eee;">
                    <p style="color:#999;font-size:12px;">如非本人操作，请忽略此邮件。</p>
                </div>
            `
        });

        console.log('邮件发送成功:', mailResult.messageId);
        res.json({ code: 200, message: '验证码已发送到您的邮箱' });

    } catch (err) {
        console.error('发送验证码失败:', err.message, err.code, err.command);
        res.json({ code: 500, message: '发送失败: ' + err.message });
    }
});

// 验证邮箱验证码
app.post('/api/auth/verify-code', async (req, res) => {
    try {
        const { email, code, type } = req.body;

        if (!email || !code) {
            return res.json({ code: 400, message: '邮箱和验证码不能为空' });
        }

        // 查找有效的验证码
        const record = db.prepare(`
            SELECT * FROM email_codes 
            WHERE email = ? AND code = ? AND type = ? AND used = 0 AND expires_at > datetime('now')
            ORDER BY created_at DESC LIMIT 1
        `).get(email, code, type || 'register');

        if (!record) {
            return res.json({ code: 400, message: '验证码错误或已过期' });
        }

        // 标记验证码已使用
        db.prepare('UPDATE email_codes SET used = 1 WHERE id = ?').run(record.id);

        res.json({ code: 200, message: '验证成功' });

    } catch (err) {
        console.error('验证失败:', err);
        res.json({ code: 500, message: '验证失败: ' + err.message });
    }
});

// ==================== 注册/登录 ====================

// 注册（增加邮箱+验证码）
app.post('/api/auth/register', async (req, res) => {
    try {
        const { username, password, phone, email, code, real_name, role, dormitory } = req.body;

        if (!username || !password || !email || !code) {
            return res.json({ code: 400, message: '用户名、密码、邮箱和验证码不能为空' });
        }

        // 验证邮箱验证码
        const codeRecord = db.prepare(`
            SELECT * FROM email_codes 
            WHERE email = ? AND code = ? AND type = 'register' AND used = 0 AND expires_at > datetime('now')
            ORDER BY created_at DESC LIMIT 1
        `).get(email, code);

        if (!codeRecord) {
            return res.json({ code: 400, message: '验证码错误或已过期，请重新获取' });
        }

        // 标记验证码已使用
        db.prepare('UPDATE email_codes SET used = 1 WHERE id = ?').run(codeRecord.id);

        // 检查用户名/邮箱是否重复
        const existingUser = db.prepare('SELECT id FROM users WHERE username = ? OR email = ?').get(username, email);
        if (existingUser) {
            return res.json({ code: 400, message: '用户名或邮箱已被注册' });
        }

        const hashedPassword = bcrypt.hashSync(password, 10);
        const userId = uuidv4();
        const userRole = role || 'student';

        db.prepare(`
            INSERT INTO users (id, username, password, phone, email, real_name, role, dormitory, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active')
        `).run(userId, username, hashedPassword, phone || '', email, real_name || '', userRole, dormitory || '');

        const token = jwt.sign({ id: userId, username, role: userRole }, JWT_SECRET, { expiresIn: '7d' });

        res.json({
            code: 200,
            message: '注册成功',
            data: {
                token,
                user: { id: userId, username, phone, email, real_name: real_name || '', role: userRole, dormitory: dormitory || '' }
            }
        });
    } catch (err) {
        console.error('注册失败:', err);
        res.json({ code: 500, message: '注册失败: ' + err.message });
    }
});

// 登录（支持用户名/邮箱 + 密码，或邮箱 + 验证码）
app.post('/api/auth/login', async (req, res) => {
    try {
        const { username, password, email, code, loginType } = req.body;

        // 方式1：邮箱+验证码登录
        if (loginType === 'code' && email && code) {
            const codeRecord = db.prepare(`
                SELECT * FROM email_codes 
                WHERE email = ? AND code = ? AND type = 'login' AND used = 0 AND expires_at > datetime('now')
                ORDER BY created_at DESC LIMIT 1
            `).get(email, code);

            if (!codeRecord) {
                return res.json({ code: 400, message: '验证码错误或已过期，请重新获取' });
            }

            db.prepare('UPDATE email_codes SET used = 1 WHERE id = ?').run(codeRecord.id);

            const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
            if (!user) {
                return res.json({ code: 400, message: '该邮箱未注册' });
            }

            if (user.status === 'banned') {
                return res.json({ code: 403, message: '账号已被封禁' });
            }

            const token = jwt.sign({ id: user.id, username: user.username, role: user.role }, JWT_SECRET, { expiresIn: '7d' });

            return res.json({
                code: 200, message: '登录成功',
                data: {
                    token,
                    user: {
                        id: user.id, username: user.username, phone: user.phone, email: user.email,
                        real_name: user.real_name, role: user.role, dormitory: user.dormitory,
                        avatar: user.avatar, verify_status: user.verify_status, balance: user.balance
                    }
                }
            });
        }

        // 方式2：用户名/邮箱 + 密码登录
        if (!username && !email) {
            return res.json({ code: 400, message: '请输入用户名或邮箱' });
        }
        if (!password) {
            return res.json({ code: 400, message: '请输入密码' });
        }

        // 支持用邮箱或用户名登录
        let user;
        if (email) {
            user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
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
        const user = db.prepare('SELECT id, username, phone, real_name, role, dormitory, avatar, verify_status, balance, status, created_at FROM users WHERE id = ?').get(req.user.id);
        if (!user) {
            return res.json({ code: 404, message: '用户不存在' });
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
        let sql = 'SELECT * FROM orders WHERE student_id = ?';
        const params = [req.user.id];

        if (status) { sql += ' AND status = ?'; params.push(status); }

        const countSql = sql.replace('SELECT *', 'SELECT COUNT(*) as total');
        const total = db.prepare(countSql).get(...params)?.total || 0;

        sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
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
            SELECT o.*, s.real_name as student_name, s.dormitory as student_dormitory
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
