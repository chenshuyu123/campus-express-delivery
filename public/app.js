/**
 * 校园快递代取系统 - 前端主逻辑
 * 学生端 / 骑手端 / 管理后台
 */

// ==================== 全局状态 ====================
const API_BASE = '/api';
let currentUser = null;
let token = localStorage.getItem('token');
let currentPage = 'home';
let pricingConfig = {};
let currentPayOrderId = null;

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
    if (token) {
        await fetchUserInfo();
    }
    loadPricing();
    loadHomeStats();
    setupSizePriceUpdate();

    // 如果已登录且当前hash指向特定页面，自动导航
    const hash = window.location.hash.replace('#', '');
    if (hash && currentUser) {
        navigateTo(hash);
    }
});

// ==================== API请求封装 ====================
async function api(url, options = {}) {
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
        headers['Authorization'] = 'Bearer ' + token;
    }
    
    try {
        const res = await fetch(API_BASE + url, { headers, ...options });
        const data = await res.json();
        if (data.code === 401) {
            localStorage.removeItem('token');
            token = null;
            currentUser = null;
            updateNavUI();
            toast('登录已过期，请重新登录', 'warning');
        }
        return data;
    } catch (err) {
        console.error('API Error:', err);
        return { code: 500, message: '网络错误，请稍后重试' };
    }
}

// ==================== 导航 ====================
function navigateTo(page) {
    currentPage = page;

    // 更新导航链接状态
    document.querySelectorAll('.nav-link').forEach(l => l.classList.remove('active'));
    const targetLink = document.querySelector(`[onclick="navigateTo('${page}')"]`);
    if (targetLink) targetLink.classList.add('active');

    // 切换页面
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const targetPage = document.getElementById('page-' + page);
    if (targetPage) targetPage.classList.add('active');

    // 关闭移动菜单
    document.getElementById('navLinks').classList.remove('open');

    // 切换到首页时刷新统计数据
    if (page === 'home') loadHomeStats();

    // 根据页面加载数据
    if (page === 'student' && currentUser) {
        loadMyOrders();
        loadAllOrders();
        loadPricing();
    }
    if (page === 'rider' && currentUser) {
        loadRiderPage();
    }
    if (page === 'admin') {
        if (currentUser && currentUser.role === 'admin' && currentUser.username === 'admin') {
            loadAdminDashboard();
        } else {
            toast('请使用管理员账号登录', 'warning');
            navigateTo('home');
            showLoginModal();
            return;
        }
    }
    if (page === 'profile' && currentUser) {
        loadProfilePage();
    }
    if (page === 'settings' && currentUser) {
        loadSettingsPage();
    }
}

function toggleMobileMenu() {
    document.getElementById('navLinks').classList.toggle('open');
}

// ==================== 用户认证 ====================
function showLoginModal() {
    document.getElementById('loginModal').classList.add('active');
}

function showRegisterModal() {
    document.getElementById('registerModal').classList.add('active');
}

function closeModal(id) {
    document.getElementById(id).classList.remove('active');
    // 关闭支付弹窗时重置状态
    if (id === 'payModal') {
        currentQRPayType = null;
        setTimeout(() => {
            const stepMethod = document.getElementById('payStepMethod');
            const stepQR = document.getElementById('payStepQR');
            if (stepMethod) stepMethod.style.display = 'block';
            if (stepQR) stepQR.style.display = 'none';
        }, 300);
    }
}

// ==================== 登录 ====================

async function login(e) {
    e.preventDefault();
    const username = document.getElementById('loginUsername').value.trim();
    const password = document.getElementById('loginPassword').value.trim();

    if (!username || !password) {
        toast('请输入用户名/手机号和密码', 'error');
        return;
    }

    const res = await api('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username, password })
    });

    if (res.code === 200) {
        token = res.data.token;
        localStorage.setItem('token', token);
        currentUser = res.data.user;
        closeModal('loginModal');
        updateNavUI();
        toast('登录成功', 'success');

        if (currentUser.role === 'admin' && currentUser.username === 'admin') navigateTo('admin');
        else if (currentUser.role === 'rider') navigateTo('rider');
        else navigateTo('student');
    } else {
        toast(res.message || '登录失败', 'error');
    }
}

// ==================== 注册 ====================

/**
 * 身份证号格式校验（含校验位算法）
 */
function validateIdCard(idCard) {
    if (!/^\d{17}[\dXx]$/.test(idCard)) return false;
    const weights = [7, 9, 10, 5, 8, 4, 2, 1, 6, 3, 7, 9, 10, 5, 8, 4, 2];
    const checkCodes = ['1', '0', 'X', '9', '8', '7', '6', '5', '4', '3', '2'];
    let sum = 0;
    for (let i = 0; i < 17; i++) sum += parseInt(idCard[i]) * weights[i];
    return idCard[17].toUpperCase() === checkCodes[sum % 11];
}

/**
 * 手机号格式校验
 */
function validatePhone(phone) {
    return /^1[3-9]\d{9}$/.test(phone);
}

async function register(e) {
    e.preventDefault();
    const username = document.getElementById('regUsername').value.trim();
    const password = document.getElementById('regPassword').value.trim();
    const phone = document.getElementById('regPhone').value.trim();
    const id_card = document.getElementById('regIdCard').value.trim().toUpperCase();
    const real_name = document.getElementById('regRealName').value.trim();
    const role = document.getElementById('regRole').value;
    const dormitory = document.getElementById('regDormitory').value;

    // 前端校验
    if (!phone || !id_card || !username || !password) {
        toast('手机号、身份证号、用户名和密码为必填项', 'error');
        return;
    }

    if (!validatePhone(phone)) {
        toast('手机号格式不正确，请输入11位手机号', 'error');
        return;
    }

    if (!validateIdCard(id_card)) {
        toast('身份证号格式不正确，请检查后重新输入', 'error');
        return;
    }

    if (password.length < 6) {
        toast('密码至少6位', 'error');
        return;
    }

    const res = await api('/auth/register', {
        method: 'POST',
        body: JSON.stringify({ username, password, phone, id_card, real_name, role, dormitory })
    });

    if (res.code === 200) {
        token = res.data.token;
        localStorage.setItem('token', token);
        currentUser = res.data.user;
        closeModal('registerModal');
        updateNavUI();
        toast('注册成功', 'success');

        if (currentUser.role === 'rider') navigateTo('rider');
        else navigateTo('student');
    } else {
        toast(res.message || '注册失败', 'error');
    }
}

async function fetchUserInfo() {
    const res = await api('/auth/me');
    if (res.code === 200) {
        currentUser = res.data;
        updateNavUI();
    } else {
        localStorage.removeItem('token');
        token = null;
        currentUser = null;
    }
}

function logout() {
    localStorage.removeItem('token');
    token = null;
    currentUser = null;
    updateNavUI();
    navigateTo('home');
    toast('已退出登录', 'info');
}

function updateNavUI() {
    const navUser = document.getElementById('navUser');
    const navUserLogged = document.getElementById('navUserLogged');
    const userInfoDisplay = document.getElementById('userInfoDisplay');

    if (currentUser) {
        navUser.style.display = 'none';
        navUserLogged.style.display = 'flex';
        const roleLabel = { admin: '管理员', rider: '骑手', student: '学生' };
        userInfoDisplay.textContent = `👤 ${roleLabel[currentUser.role] || ''} ${currentUser.real_name || currentUser.username}`;
    } else {
        navUser.style.display = 'flex';
        navUserLogged.style.display = 'none';
    }

    // 更新导航链接可见性
    document.getElementById('navStudent').style.display = 'inline';
    document.getElementById('navRider').style.display = 'inline';
    document.getElementById('navAdmin').style.display = (currentUser?.role === 'admin' && currentUser?.username === 'admin') ? 'inline' : 'none';
    document.getElementById('navProfile').style.display = currentUser ? 'inline' : 'none';
    document.getElementById('navSettings').style.display = currentUser ? 'inline' : 'none';
}

// ==================== Toast ====================
function toast(message, type = 'info') {
    const container = document.getElementById('toastContainer');
    const toastEl = document.createElement('div');
    toastEl.className = `toast toast-${type}`;
    toastEl.textContent = message;
    container.appendChild(toastEl);

    setTimeout(() => {
        toastEl.style.opacity = '0';
        toastEl.style.transition = 'opacity 0.3s';
        setTimeout(() => toastEl.remove(), 300);
    }, 3000);
}

// ==================== 计价配置 ====================
async function loadPricing() {
    const res = await api('/config/pricing');
    if (res.code === 200) {
        pricingConfig = res.data;
        updatePriceDisplay();
    }
}

function updatePriceDisplay() {
    document.getElementById('smallPrice').textContent = pricingConfig.small_price || 2;
    document.getElementById('largePrice').textContent = pricingConfig.large_price || 5;
    updateOrderTotal();
}

function setupSizePriceUpdate() {
    document.querySelectorAll('input[name="orderSize"]').forEach(radio => {
        radio.addEventListener('change', updateOrderTotal);
    });
    const timeInput = document.getElementById('orderScheduledTime');
    if (timeInput) {
        timeInput.addEventListener('change', updateOrderTotal);
    }
}

function selectSize(size) {
    document.querySelector(`input[name="orderSize"][value="${size}"]`).checked = true;
    updateOrderTotal();
}

function updateOrderTotal() {
    const size = document.querySelector('input[name="orderSize"]:checked')?.value || 'small';
    const basePrice = size === 'large' ? (pricingConfig.large_price || 5) : (pricingConfig.small_price || 2);
    
    let totalPrice = basePrice;
    let isUrgent = false;
    
    const scheduledTime = document.getElementById('orderScheduledTime')?.value;
    if (scheduledTime) {
        const scheduled = new Date(scheduledTime);
        const now = new Date();
        const hoursDiff = (scheduled - now) / (1000 * 60 * 60);
        if (hoursDiff <= 2 && hoursDiff > 0) {
            totalPrice += (pricingConfig.urgent_fee || 3);
            isUrgent = true;
        }
    }

    document.getElementById('basePriceDisplay').textContent = '¥' + basePrice.toFixed(2);
    document.getElementById('totalPriceDisplay').textContent = '¥' + totalPrice.toFixed(2);
    
    const urgentRow = document.getElementById('urgentRow');
    if (urgentRow) {
        urgentRow.style.display = isUrgent ? 'flex' : 'none';
        document.getElementById('urgentFeeDisplay').textContent = '¥' + (pricingConfig.urgent_fee || 3).toFixed(2);
    }
}

// ==================== 学生端：下单 ====================
async function submitOrder(e) {
    e.preventDefault();
    
    if (!currentUser) {
        toast('请先登录', 'warning');
        showLoginModal();
        return;
    }

    let dormitory = document.getElementById('orderDormitory').value;
    const building = document.getElementById('orderBuilding').value;
    const cabinet = document.getElementById('orderCabinet').value;
    const pickup_code = document.getElementById('orderPickupCode').value.trim();
    const size = document.querySelector('input[name="orderSize"]:checked')?.value || 'small';
    const scheduled_time = document.getElementById('orderScheduledTime').value;
    let remark = document.getElementById('orderRemark').value.trim();

    // 处理"其他地址请备注"
    if (dormitory === '其他') {
        const otherAddr = document.getElementById('orderOtherAddress').value.trim();
        if (!otherAddr) {
            toast('请填写具体配送地址', 'error');
            return;
        }
        dormitory = otherAddr;
        // 把具体地址也追加到备注
        remark = remark ? '【配送地址：' + otherAddr + '】' + remark : '【配送地址：' + otherAddr + '】';
    }

    if (!dormitory || !cabinet || !pickup_code) {
        toast('请填写必填项', 'error');
        return;
    }

    const res = await api('/orders', {
        method: 'POST',
        body: JSON.stringify({ dormitory, building, cabinet, pickup_code, size, scheduled_time, remark })
    });

    if (res.code === 200) {
        toast('下单成功！请完成支付', 'success');
        currentPayOrderId = res.data.order_id;
        const amount = '¥' + res.data.total_price.toFixed(2);
        document.getElementById('payAmount').textContent = amount;
        // 重置到支付方式选择步骤
        document.getElementById('payStepMethod').style.display = 'block';
        document.getElementById('payStepQR').style.display = 'none';
        document.getElementById('payModal').classList.add('active');
        document.getElementById('orderForm').reset();
        document.querySelector('input[name="orderSize"][value="small"]').checked = true;
        updateOrderTotal();
    } else {
        toast(res.message || '下单失败', 'error');
    }
}

// ==================== 支付 ====================
// 当前扫码支付的类型：'alipay' | 'wechat' | null
let currentQRPayType = null;

// 余额支付：直接扣除
async function payOrder(method) {
    if (!currentPayOrderId) {
        toast('支付信息已过期，请重新下单', 'error');
        closeModal('payModal');
        return;
    }

    // 余额支付需要确认
    if (method === 'balance') {
        if (!confirm('确认使用账户余额支付吗？')) return;
    }

    const endpoint = `/orders/${currentPayOrderId}/pay`;
    const res = await api(endpoint, { method: 'POST' });

    if (res.code === 200) {
        toast('支付成功！等待骑手接单', 'success');
        closeModal('payModal');
        currentPayOrderId = null;
        loadMyOrders();
        loadAllOrders();
    } else {
        toast(res.message || '支付失败', 'error');
    }
}

// 显示扫码支付界面
function showQRPay(method) {
    if (!currentPayOrderId) {
        toast('支付信息已过期', 'error');
        return;
    }
    currentQRPayType = method;

    const amount = document.getElementById('payAmount').textContent;
    document.getElementById('payAmountQR').textContent = amount;
    document.getElementById('qrPrice').textContent = amount;

    if (method === 'alipay') {
        document.getElementById('qrMethodName').textContent = '支付宝';
    } else {
        document.getElementById('qrMethodName').textContent = '微信';
    }

    document.getElementById('payStepMethod').style.display = 'none';
    document.getElementById('payStepQR').style.display = 'block';
}

// 返回支付方式选择
function backToPayMethod() {
    document.getElementById('payStepQR').style.display = 'none';
    document.getElementById('payStepMethod').style.display = 'block';
    currentQRPayType = null;
}

// 确认扫码支付完成
async function confirmQRPay() {
    if (!currentPayOrderId || !currentQRPayType) {
        toast('支付信息已过期', 'error');
        closeModal('payModal');
        return;
    }

    const btn = document.getElementById('btnConfirmPay');
    btn.disabled = true;
    btn.textContent = '处理中...';

    const endpoint = currentQRPayType === 'alipay'
        ? `/orders/${currentPayOrderId}/alipay`
        : `/orders/${currentPayOrderId}/wechatpay`;

    const res = await api(endpoint, { method: 'POST' });

    if (res.code === 200) {
        toast('支付成功！等待骑手接单', 'success');
        closeModal('payModal');
        currentPayOrderId = null;
        currentQRPayType = null;
        loadMyOrders();
        loadAllOrders();
    } else {
        toast(res.message || '支付失败', 'error');
        btn.disabled = false;
        btn.textContent = '已完成支付';
    }
}

function payPendingOrder(orderId) {
    if (!currentUser) {
        toast('请先登录', 'warning');
        showLoginModal();
        return;
    }
    currentPayOrderId = orderId;
    // 获取订单信息显示金额
    api(`/orders/${orderId}`).then(res => {
        if (res.code === 200) {
            const amount = '¥' + res.data.total_price.toFixed(2);
            document.getElementById('payAmount').textContent = amount;
            document.getElementById('payStepMethod').style.display = 'block';
            document.getElementById('payStepQR').style.display = 'none';
            document.getElementById('payModal').classList.add('active');
        } else {
            toast('获取订单信息失败', 'error');
            currentPayOrderId = null;
        }
    });
}

// ==================== 学生端：我的订单 ====================
let myOrdersFilter = '';
let allOrdersFilter = '';
async function loadMyOrders(page = 1) {
    if (!currentUser) return;

    const params = new URLSearchParams({ page, pageSize: 20 });
    if (myOrdersFilter) params.set('status', myOrdersFilter);

    const res = await api(`/orders/my?${params}`);
    const container = document.getElementById('myOrdersList');

    if (res.code === 200) {
        const { orders } = res.data;
        if (orders.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无订单</div>';
            return;
        }
        container.innerHTML = orders.map(order => renderOrderItem(order, 'student')).join('');
    }
}

function filterMyOrders(status) {
    myOrdersFilter = status;
    const container = document.getElementById('myOrdersList').parentElement;
    container.querySelectorAll('.order-tab').forEach(t => t.classList.remove('active'));
    const tab = container.querySelector(`[onclick="filterMyOrders('${status}')"]`);
    if (tab) tab.classList.add('active');
    loadMyOrders();
}

// ==================== 所有订单（学生端公开查看） ====================
async function loadAllOrders(page = 1) {
    if (!currentUser) return;

    const params = new URLSearchParams({ page, pageSize: 20 });
    if (allOrdersFilter) params.set('status', allOrdersFilter);

    const res = await api(`/orders/all?${params}`);
    const container = document.getElementById('allOrdersList');

    if (res.code === 200) {
        const { orders } = res.data;
        if (orders.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无订单</div>';
            return;
        }
        container.innerHTML = orders.map(order => renderOrderItem(order, 'all')).join('');
    }
}

function filterAllOrders(status) {
    allOrdersFilter = status;
    const container = document.getElementById('allOrdersList').parentElement;
    container.querySelectorAll('.order-tab').forEach(t => t.classList.remove('active'));
    const tab = container.querySelector(`[onclick="filterAllOrders('${status}')"]`);
    if (tab) tab.classList.add('active');
    loadAllOrders();
}

async function cancelOrder(orderId) {
    if (!confirm('确定要取消该订单吗？已支付订单将全额退款。')) return;

    const res = await api(`/orders/${orderId}/cancel`, { method: 'POST' });
    if (res.code === 200) {
        toast(res.message, 'success');
        loadMyOrders();
        loadAllOrders();
    } else {
        toast(res.message || '取消失败', 'error');
    }
}

// ==================== 订单渲染 ====================
function renderOrderItem(order, viewType) {
    const statusMap = {
        pending_payment: '待支付',
        paid: '待接单',
        accepted: '已接单',
        picked_up: '已取件',
        completed: '已完成',
        cancelled: '已取消'
    };

    const sizeLabel = order.size === 'large' ? '大件' : '小件';
    let actions = '';

    if (viewType === 'student') {
        if (order.status === 'pending_payment') {
            actions = `
                <button class="btn btn-sm btn-primary" onclick="payPendingOrder('${order.id}')">支付</button>
                <button class="btn btn-sm btn-outline" onclick="cancelOrder('${order.id}')">取消</button>
            `;
        } else if (order.status === 'paid') {
            actions = `<button class="btn btn-sm btn-danger" onclick="cancelOrder('${order.id}')">取消并退款</button>`;
        } else {
            actions = '<span class="order-status status-' + order.status + '">' + statusMap[order.status] + '</span>';
        }
    }

    if (viewType === 'rider') {
        if (order.status === 'accepted') {
            actions = `<button class="btn btn-sm btn-primary" onclick="pickupOrder('${order.id}')">标记取件</button>`;
        } else if (order.status === 'picked_up') {
            actions = `<button class="btn btn-sm btn-success" onclick="deliverOrder('${order.id}')">标记完成</button>`;
        }
    }

    return `
        <div class="order-item">
            <div class="order-item-header">
                <span class="order-no">${order.order_no}</span>
                <span class="order-status status-${order.status}">${statusMap[order.status]}</span>
            </div>
            <div class="order-detail">
                <span>📦 快递站点：<strong>${order.cabinet}</strong></span>
                <span>🔑 取件码：<strong>${order.pickup_code}</strong></span>
                <span>🏠 配送至：<strong>${order.dormitory} ${order.building || ''}</strong></span>
                <span>📏 大小：<strong>${sizeLabel}</strong></span>
                <span>💰 金额：<strong>¥${order.total_price.toFixed(2)}</strong></span>
                ${order.is_urgent ? '<span>⚡ <strong style="color:#EF4444;">加急订单</strong></span>' : ''}
                ${order.rider_name ? `<span>🛵 骑手：<strong>${order.rider_name}</strong> ${order.rider_phone ? `<span style="color:#3B82F6;">📞 ${order.rider_phone}</span>` : ''}</span>` : ''}
                ${order.student_name ? `<span>👤 单主：<strong>${order.student_name}</strong> ${order.student_phone ? `<span style="color:#3B82F6;">📞 ${order.student_phone}</span>` : ''}</span>` : ''}
                <span>🕐 ${order.created_at}</span>
            </div>
            ${actions ? `<div class="order-actions">${actions}</div>` : ''}
        </div>
    `;
}

// ==================== 骑手端 ====================
async function loadRiderPage() {
    if (!currentUser) {
        toast('请先登录后再访问骑手端', 'warning');
        showLoginModal();
        return;
    }

    // 总是从服务端获取最新的用户信息
    const riderInfo = await api('/auth/me');
    if (riderInfo.code !== 200) {
        toast('获取用户信息失败，请重新登录', 'error');
        return;
    }

    const user = riderInfo.data;

    // 非骑手角色：显示认证入口
    if (user.role !== 'rider') {
        document.getElementById('riderVerifySection').style.display = 'block';
        document.getElementById('riderWorkSection').style.display = 'none';
        return;
    }

    // 骑手角色：根据认证状态显示不同界面
    if (user.verify_status === 'approved') {
        document.getElementById('riderVerifySection').style.display = 'none';
        document.getElementById('riderWorkSection').style.display = 'block';
        loadAvailableOrders();
        loadRiderMyOrders();
        loadCommission();

        // 启动定时刷新（每30秒自动刷新抢单大厅）
        if (window._riderRefreshTimer) clearInterval(window._riderRefreshTimer);
        window._riderRefreshTimer = setInterval(() => {
            if (currentPage === 'rider' && currentUser?.role === 'rider' && currentUser?.verify_status === 'approved') {
                loadAvailableOrders();
                loadRiderMyOrders();
            } else {
                clearInterval(window._riderRefreshTimer);
            }
        }, 30000);
    } else if (user.verify_status === 'pending') {
        document.getElementById('riderVerifySection').innerHTML = '<div class="card" style="text-align:center;padding:40px;"><div style="font-size:48px;margin-bottom:16px;">⏳</div><h3>审核中</h3><p style="color:#64748B;">您的骑手认证正在审核中，请耐心等待管理员审核...</p></div>';
        document.getElementById('riderVerifySection').style.display = 'block';
        document.getElementById('riderWorkSection').style.display = 'none';
    } else if (user.verify_status === 'rejected') {
        document.getElementById('riderVerifySection').innerHTML = '<div class="card" style="text-align:center;padding:40px;"><div style="font-size:48px;margin-bottom:16px;">❌</div><h3>认证未通过</h3><p style="color:#EF4444;">您的骑手认证未通过审核，请重新提交认证信息</p></div><div class="card"><h3>重新提交认证</h3><form id="riderVerifyForm" onsubmit="submitRiderVerify(event)"><div class="form-group"><label>真实姓名 <span class="required">*</span></label><input type="text" id="riderRealName" required placeholder="请输入真实姓名"></div><div class="form-group"><label>学号 <span class="required">*</span></label><input type="text" id="riderStudentId" required placeholder="请输入学号"></div><div class="form-group"><label>手机号 <span class="required">*</span></label><input type="tel" id="riderPhone" required placeholder="请输入手机号"></div><div class="form-group"><label>身份证号 <span class="required">*</span></label><input type="text" id="riderIdCard" required placeholder="请输入身份证号" maxlength="18"></div><button type="submit" class="btn btn-primary btn-block">重新提交认证</button></form></div>';
        document.getElementById('riderVerifySection').style.display = 'block';
        document.getElementById('riderWorkSection').style.display = 'none';
    } else {
        // verify_status 为 'none' 或其他，显示认证表单
        document.getElementById('riderVerifySection').style.display = 'block';
        document.getElementById('riderWorkSection').style.display = 'none';
    }
}

async function submitRiderVerify(e) {
    e.preventDefault();
    const real_name = document.getElementById('riderRealName').value.trim();
    const student_id = document.getElementById('riderStudentId').value.trim();
    const phone = document.getElementById('riderPhone').value.trim();
    const id_card = document.getElementById('riderIdCard').value.trim();

    if (!real_name || !student_id || !phone || !id_card) {
        toast('请填写所有认证信息', 'error');
        return;
    }

    const res = await api('/rider/verify', {
        method: 'POST',
        body: JSON.stringify({ real_name, student_id, phone, id_card })
    });

    if (res.code === 200) {
        toast('认证信息已提交，请等待审核', 'success');
        await fetchUserInfo();
        loadRiderPage();
    } else {
        toast(res.message || '提交失败', 'error');
    }
}

// 抢单大厅
async function loadAvailableOrders(page = 1) {
    const res = await api(`/rider/orders/available?page=${page}&pageSize=20`);
    const container = document.getElementById('availableOrdersList');

    if (res.code === 200) {
        const { orders } = res.data;
        if (orders.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无待接订单，休息一下~</div>';
            return;
        }
        container.innerHTML = orders.map(order => `
            <div class="available-order-card ${order.is_urgent ? 'urgent' : ''}">
                <div class="available-order-header">
                    <span style="font-weight:600;">${order.order_no}</span>
                    ${order.is_urgent ? '<span class="urgent-badge">⚡ 加急</span>' : ''}
                    <span style="color:var(--primary);font-weight:700;">¥${order.total_price.toFixed(2)}</span>
                </div>
                <div class="order-detail">
                    <span>📦 ${order.cabinet}</span>
                    <span>🔑 ${order.pickup_code}</span>
                    <span>🏠 ${order.dormitory} ${order.building || ''}</span>
                    <span>📏 ${order.size === 'large' ? '大件' : '小件'}</span>
                    ${order.student_name ? `<span>👤 ${order.student_name} <span style="color:#3B82F6;">📞 ${order.student_phone || '未留'}</span></span>` : ''}
                    <span>🕐 ${order.created_at}</span>
                </div>
                <div class="order-actions">
                    <button class="btn btn-sm btn-success" onclick="grabOrder('${order.id}')">抢单</button>
                </div>
            </div>
        `).join('');
    }
}

async function grabOrder(orderId) {
    if (!confirm('确定要抢这个订单吗？抢单后请尽快完成配送。')) return;

    const res = await api(`/rider/orders/${orderId}/grab`, { method: 'POST' });
    if (res.code === 200) {
        toast('抢单成功！', 'success');
        loadAvailableOrders();
        loadRiderMyOrders();
    } else {
        toast(res.message || '抢单失败', 'error');
    }
}

// 骑手我的订单
let riderOrderFilter = 'active';
async function loadRiderMyOrders() {
    const params = new URLSearchParams({ pageSize: 20 });
    if (riderOrderFilter) params.set('status', riderOrderFilter);

    const res = await api(`/rider/orders/my?${params}`);
    const container = document.getElementById('riderMyOrdersList');

    if (res.code === 200) {
        const { orders } = res.data;
        if (orders.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无配送订单</div>';
            return;
        }
        container.innerHTML = orders.map(order => renderOrderItem(order, 'rider')).join('');
    }
}

function filterRiderOrders(status) {
    riderOrderFilter = status;
    document.querySelectorAll('#page-rider .order-tab').forEach(t => t.classList.remove('active'));
    const tab = document.querySelector(`#page-rider [onclick="filterRiderOrders('${status}')"]`);
    if (tab) tab.classList.add('active');
    loadRiderMyOrders();
}

async function pickupOrder(orderId) {
    const res = await api(`/rider/orders/${orderId}/pickup`, { method: 'POST' });
    if (res.code === 200) {
        toast('已标记取件完成', 'success');
        loadRiderMyOrders();
    } else {
        toast(res.message || '操作失败', 'error');
    }
}

async function deliverOrder(orderId) {
    const res = await api(`/rider/orders/${orderId}/deliver`, { method: 'POST' });
    if (res.code === 200) {
        toast('配送完成！佣金已到账', 'success');
        loadRiderMyOrders();
        loadCommission();
        fetchUserInfo();
    } else {
        toast(res.message || '操作失败', 'error');
    }
}

// 佣金
async function loadCommission() {
    const res = await api('/rider/commission');
    if (res.code === 200) {
        document.getElementById('riderBalance').textContent = '¥' + (res.data.balance || 0).toFixed(2);
        document.getElementById('riderTotalCommission').textContent = '¥' + (res.data.total_commission || 0).toFixed(2);

        const container = document.getElementById('commissionList');
        if (res.data.records.length === 0) {
            container.innerHTML = '<div class="empty-state">暂无佣金记录</div>';
            return;
        }
        container.innerHTML = res.data.records.map(r => `
            <div class="order-item">
                <div class="order-item-header">
                    <span>佣金收入</span>
                    <span style="color:var(--success);font-weight:700;">+¥${r.amount.toFixed(2)}</span>
                </div>
                <div class="order-detail">
                    <span>${r.description}</span>
                    <span>${r.created_at}</span>
                </div>
            </div>
        `).join('');
    }
}

function showWithdrawModal() {
    api('/rider/commission').then(res => {
        if (res.code === 200) {
            document.getElementById('withdrawBalance').textContent = '¥' + (res.data.balance || 0).toFixed(2);
            document.getElementById('withdrawModal').classList.add('active');
        }
    });
}

async function submitWithdraw(e) {
    e.preventDefault();
    const amount = parseFloat(document.getElementById('withdrawAmount').value);
    const account_type = document.getElementById('withdrawType').value;
    const account = document.getElementById('withdrawAccount').value.trim();

    if (!amount || amount <= 0) {
        toast('请输入有效的提现金额', 'error');
        return;
    }

    const res = await api('/rider/withdraw', {
        method: 'POST',
        body: JSON.stringify({ amount, account_type, account })
    });

    if (res.code === 200) {
        toast('提现申请已提交！', 'success');
        closeModal('withdrawModal');
        loadCommission();
        fetchUserInfo();
    } else {
        toast(res.message || '提现失败', 'error');
    }
}

// ==================== 管理后台 ====================
let adminTab = 'dashboard';
function switchAdminTab(tab) {
    adminTab = tab;
    document.querySelectorAll('.admin-menu-item').forEach(m => m.classList.remove('active'));
    document.querySelector(`[onclick="switchAdminTab('${tab}')"]`)?.classList.add('active');
    document.querySelectorAll('.admin-tab').forEach(t => t.classList.remove('active'));
    document.getElementById('admin-tab-' + tab)?.classList.add('active');

    if (tab === 'dashboard') loadAdminDashboard();
    if (tab === 'orders') loadAdminOrders();
    if (tab === 'riders') loadAdminRiders();
    if (tab === 'pricing') loadAdminPricing();
    if (tab === 'users') loadAdminUsers();
}

async function loadAdminDashboard() {
    const res = await api('/admin/statistics');
    if (res.code === 200) {
        const { today, month, daily, overview } = res.data;

        document.getElementById('adminTotalUsers').textContent = overview.total_users || 0;
        document.getElementById('adminTotalRiders').textContent = overview.total_riders || 0;
        document.getElementById('adminTotalOrders').textContent = overview.total_orders || 0;
        document.getElementById('adminTotalRevenue').textContent = '¥' + ((overview.total_revenue || 0).toFixed(2));

        document.getElementById('todayStats').innerHTML = `
            <div class="summary-row"><span>今日订单</span><span>${today.total_orders || 0}</span></div>
            <div class="summary-row"><span>已完成</span><span>${today.completed_orders || 0}</span></div>
            <div class="summary-row"><span>已取消</span><span>${today.cancelled_orders || 0}</span></div>
            <div class="summary-row"><span>待接单</span><span>${today.pending_orders || 0}</span></div>
            <div class="summary-row total-row"><span>今日营收</span><span>¥${(today.total_revenue || 0).toFixed(2)}</span></div>
        `;

        document.getElementById('monthStats').innerHTML = `
            <div class="summary-row"><span>本月订单</span><span>${month.total_orders || 0}</span></div>
            <div class="summary-row"><span>已完成</span><span>${month.completed_orders || 0}</span></div>
            <div class="summary-row total-row"><span>本月营收</span><span>¥${(month.total_revenue || 0).toFixed(2)}</span></div>
            <div class="summary-row"><span>骑手佣金</span><span>¥${(month.total_commission || 0).toFixed(2)}</span></div>
        `;

        // 绘制图表
        drawChart(daily || []);
    }
}

function drawChart(dailyData) {
    const canvas = document.getElementById('orderChart');
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    const width = canvas.width;
    const height = canvas.height;
    const padding = { top: 30, right: 30, bottom: 50, left: 60 };
    const chartWidth = width - padding.left - padding.right;
    const chartHeight = height - padding.top - padding.bottom;

    ctx.clearRect(0, 0, width, height);

    if (dailyData.length === 0) {
        ctx.fillStyle = '#64748B';
        ctx.font = '14px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('暂无数据', width / 2, height / 2);
        return;
    }

    const maxVal = Math.max(...dailyData.map(d => d.total), 1);
    const barWidth = Math.max(chartWidth / dailyData.length - 4, 8);

    // Y轴
    ctx.strokeStyle = '#E2E8F0';
    ctx.lineWidth = 1;
    for (let i = 0; i <= 4; i++) {
        const y = padding.top + (chartHeight / 4) * i;
        ctx.beginPath();
        ctx.moveTo(padding.left, y);
        ctx.lineTo(width - padding.right, y);
        ctx.stroke();

        ctx.fillStyle = '#64748B';
        ctx.font = '11px sans-serif';
        ctx.textAlign = 'right';
        ctx.fillText(Math.round(maxVal * (4 - i) / 4), padding.left - 8, y + 4);
    }

    // X轴标签和柱状图
    dailyData.forEach((d, i) => {
        const x = padding.left + (chartWidth / dailyData.length) * i + barWidth / 2;
        const barH = (d.total / maxVal) * chartHeight;
        const y = padding.top + chartHeight - barH;

        // 柱状图
        const gradient = ctx.createLinearGradient(x, y, x, padding.top + chartHeight);
        gradient.addColorStop(0, '#818CF8');
        gradient.addColorStop(1, '#4F46E5');
        ctx.fillStyle = gradient;
        ctx.beginPath();
        ctx.roundRect(x - barWidth / 2, y, barWidth, barH, [4, 4, 0, 0]);
        ctx.fill();

        // 数值
        if (d.total > 0) {
            ctx.fillStyle = '#1E293B';
            ctx.font = '10px sans-serif';
            ctx.textAlign = 'center';
            ctx.fillText(d.total, x, y - 4);
        }

        // 日期标签
        ctx.fillStyle = '#64748B';
        ctx.font = '10px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(d.date.slice(5), x, padding.top + chartHeight + 16);
    });
}

// 管理后台订单
let adminOrderPage = 1;
async function loadAdminOrders(page = 1) {
    adminOrderPage = page;
    const keyword = document.getElementById('orderSearchKeyword')?.value || '';
    const status = document.getElementById('orderSearchStatus')?.value || '';

    const params = new URLSearchParams({ page, pageSize: 15, keyword, status });
    const res = await api(`/admin/orders?${params}`);

    if (res.code === 200) {
        const { orders, total } = res.data;
        document.getElementById('adminOrdersTableBody').innerHTML = orders.map(o => `
            <tr>
                <td>${o.order_no}</td>
                <td>${o.student_name || '-'}</td>
                <td>${o.cabinet}</td>
                <td>${o.pickup_code}</td>
                <td>${o.size === 'large' ? '大件' : '小件'}</td>
                <td>¥${o.total_price.toFixed(2)}</td>
                <td><span class="order-status status-${o.status}">${statusMapAdmin(o.status)}</span></td>
                <td>${o.rider_name || '-'}</td>
                <td>${o.created_at}</td>
                <td>${o.status === 'paid' ? `<button class="btn btn-sm btn-danger" onclick="adminCancelOrder('${o.id}')">取消</button>` : '-'}</td>
            </tr>
        `).join('');

        renderPagination('adminOrdersPagination', page, Math.ceil(total / 15), loadAdminOrders);
    }
}

function statusMapAdmin(status) {
    const map = { pending_payment: '待支付', paid: '待接单', accepted: '已接单', picked_up: '已取件', completed: '已完成', cancelled: '已取消' };
    return map[status] || status;
}

function searchAdminOrders() {
    loadAdminOrders(1);
}

async function adminCancelOrder(orderId) {
    if (!confirm('确定取消该订单吗？')) return;
    const res = await api(`/orders/${orderId}/cancel`, { method: 'POST' });
    if (res.code === 200) {
        toast('订单已取消', 'success');
        loadAdminOrders(adminOrderPage);
    }
}

function exportOrders() {
    window.open(API_BASE + '/admin/orders/export?token=' + token, '_blank');
}

// 管理后台骑手审核
async function loadAdminRiders() {
    const res = await api('/admin/riders/pending');
    if (res.code === 200) {
        document.getElementById('adminRidersTableBody').innerHTML = res.data.map(r => `
            <tr>
                <td>${r.username}</td>
                <td>${r.real_name}</td>
                <td>${r.student_id}</td>
                <td>${r.phone}</td>
                <td>${r.id_card ? r.id_card.slice(0, 6) + '****' + r.id_card.slice(-4) : '-'}</td>
                <td><span class="order-status status-${r.verify_status === 'approved' ? 'completed' : r.verify_status === 'rejected' ? 'cancelled' : 'pending_payment'}">${r.verify_status === 'approved' ? '已通过' : r.verify_status === 'rejected' ? '已拒绝' : '待审核'}</span></td>
                <td>${r.created_at}</td>
                <td>
                    ${r.verify_status === 'pending' ? `
                        <button class="btn btn-sm btn-success" onclick="verifyRider('${r.id}', 'approve')">通过</button>
                        <button class="btn btn-sm btn-danger" onclick="verifyRider('${r.id}', 'reject')">拒绝</button>
                    ` : '-'}
                </td>
            </tr>
        `).join('');
    }
}

async function verifyRider(riderId, action) {
    const reason = action === 'reject' ? prompt('请输入拒绝原因（可选）：') : '';
    const res = await api(`/admin/riders/${riderId}/verify`, {
        method: 'POST',
        body: JSON.stringify({ action, reason })
    });

    if (res.code === 200) {
        toast(res.message, 'success');
        loadAdminRiders();
    } else {
        toast(res.message || '操作失败', 'error');
    }
}

// 管理后台收费标准
async function loadAdminPricing() {
    const res = await api('/config/pricing');
    if (res.code === 200) {
        document.getElementById('pricingSmall').value = res.data.small_price || 2;
        document.getElementById('pricingLarge').value = res.data.large_price || 5;
        document.getElementById('pricingUrgent').value = res.data.urgent_fee || 3;
        document.getElementById('pricingCommission').value = res.data.commission_rate || 0.8;
    }
}

async function updatePricing(e) {
    e.preventDefault();
    const res = await api('/admin/pricing', {
        method: 'POST',
        body: JSON.stringify({
            small_price: document.getElementById('pricingSmall').value,
            large_price: document.getElementById('pricingLarge').value,
            urgent_fee: document.getElementById('pricingUrgent').value,
            commission_rate: document.getElementById('pricingCommission').value
        })
    });

    if (res.code === 200) {
        toast('收费标准已更新', 'success');
        loadPricing();
    } else {
        toast(res.message || '更新失败', 'error');
    }
}

// 管理后台用户列表
async function loadAdminUsers() {
    const res = await api('/admin/users');
    if (res.code === 200) {
        document.getElementById('adminUsersTableBody').innerHTML = res.data.map(u => `
            <tr>
                <td>${u.username}</td>
                <td>${u.real_name || '-'}</td>
                <td>${u.phone}</td>
                <td>${u.role === 'admin' ? '管理员' : u.role === 'rider' ? '骑手' : '学生'}</td>
                <td>${u.dormitory || '-'}</td>
                <td>¥${(u.balance || 0).toFixed(2)}</td>
                <td>${u.status === 'active' ? '正常' : '已封禁'}</td>
                <td>${u.created_at}</td>
            </tr>
        `).join('');
    }
}

// 分页组件
function renderPagination(containerId, currentPage, totalPages, callback) {
    const container = document.getElementById(containerId);
    if (totalPages <= 1) { container.innerHTML = ''; return; }

    let html = '';
    html += `<button ${currentPage === 1 ? 'disabled' : ''} onclick="${callback.name}(${currentPage - 1})">上一页</button>`;
    for (let i = 1; i <= totalPages; i++) {
        html += `<button class="${i === currentPage ? 'active' : ''}" onclick="${callback.name}(${i})">${i}</button>`;
    }
    html += `<button ${currentPage === totalPages ? 'disabled' : ''} onclick="${callback.name}(${currentPage + 1})">下一页</button>`;
    container.innerHTML = html;
}

// ==================== 个人中心 ====================
function loadProfilePage() {
    if (!currentUser) {
        document.getElementById('profileContent').innerHTML = '<div class="empty-state">请先登录查看个人信息</div>';
        return;
    }

    api('/auth/me').then(res => {
        if (res.code === 200) {
            const user = res.data;
            const roleLabel = { admin: '管理员', rider: '骑手', student: '学生' };
            const verifyLabel = { none: '未认证', pending: '审核中', approved: '已通过', rejected: '未通过' };
            document.getElementById('profileContent').innerHTML = `
                <div class="profile-info">
                    <div class="profile-header-card">
                        <div class="profile-avatar">${(user.real_name || user.username).charAt(0).toUpperCase()}</div>
                        <div>
                            <h3>${user.real_name || user.username}</h3>
                            <p style="color:#64748B;">${roleLabel[user.role] || '用户'} · ${user.username}</p>
                        </div>
                    </div>
                    <div class="profile-details">
                        <div class="profile-row">
                            <span class="profile-label">用户名</span>
                            <span class="profile-value">${user.username}</span>
                        </div>
                        <div class="profile-row">
                            <span class="profile-label">角色</span>
                            <span class="profile-value"><span class="badge badge-${user.role}">${roleLabel[user.role] || '用户'}</span></span>
                        </div>
                        <div class="profile-row">
                            <span class="profile-label">真实姓名</span>
                            <span class="profile-value">${user.real_name || '未设置'}</span>
                        </div>
                        <div class="profile-row">
                            <span class="profile-label">手机号</span>
                            <span class="profile-value">${user.phone || '未设置'}</span>
                        </div>
                        <div class="profile-row">
                            <span class="profile-label">宿舍楼</span>
                            <span class="profile-value">${user.dormitory || '未设置'}</span>
                        </div>
                        ${user.role === 'rider' ? `
                        <div class="profile-row">
                            <span class="profile-label">认证状态</span>
                            <span class="profile-value">${verifyLabel[user.verify_status] || '未认证'}</span>
                        </div>
                        <div class="profile-row">
                            <span class="profile-label">账户余额</span>
                            <span class="profile-value" style="color:var(--success);font-weight:700;">¥${(user.balance || 0).toFixed(2)}</span>
                        </div>` : ''}
                        <div class="profile-row">
                            <span class="profile-label">注册时间</span>
                            <span class="profile-value">${user.created_at || '-'}</span>
                        </div>
                    </div>
                    <div style="margin-top:20px;text-align:center;">
                        <button class="btn btn-primary" onclick="navigateTo('settings')">⚙️ 修改个人信息</button>
                    </div>
                </div>
            `;
        }
    });
}

// ==================== 设置页面 ====================
function loadSettingsPage() {
    if (!currentUser) return;

    api('/auth/me').then(res => {
        if (res.code === 200) {
            const user = res.data;
            document.getElementById('settingsRealName').value = user.real_name || '';
            document.getElementById('settingsPhone').value = user.phone || '';
            document.getElementById('settingsDormitory').value = user.dormitory || '';
        }
    });
}

async function updateProfile(e) {
    e.preventDefault();
    const real_name = document.getElementById('settingsRealName').value.trim();
    const phone = document.getElementById('settingsPhone').value.trim();
    const dormitory = document.getElementById('settingsDormitory').value;

    if (!phone) {
        toast('手机号不能为空', 'error');
        return;
    }

    const res = await api('/auth/update-profile', {
        method: 'POST',
        body: JSON.stringify({ real_name, phone, dormitory })
    });

    if (res.code === 200) {
        toast('个人信息已更新', 'success');
        await fetchUserInfo();
        loadSettingsPage();
    } else {
        toast(res.message || '更新失败', 'error');
    }
}

async function changePassword(e) {
    e.preventDefault();
    const oldPassword = document.getElementById('oldPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmPassword = document.getElementById('confirmPassword').value;

    if (!oldPassword || !newPassword || !confirmPassword) {
        toast('请填写所有密码字段', 'error');
        return;
    }
    if (newPassword.length < 6) {
        toast('新密码至少6位', 'error');
        return;
    }
    if (newPassword !== confirmPassword) {
        toast('两次输入的新密码不一致', 'error');
        return;
    }

    const res = await api('/auth/change-password', {
        method: 'POST',
        body: JSON.stringify({ old_password: oldPassword, new_password: newPassword })
    });

    if (res.code === 200) {
        toast('密码修改成功，请重新登录', 'success');
        document.getElementById('changePasswordForm').reset();
        setTimeout(() => logout(), 1500);
    } else {
        toast(res.message || '修改失败', 'error');
    }
}

// ==================== 首页统计 ====================
async function loadHomeStats() {
    // 首页公开统计 + 定价
    try {
        const [statsRes, pricingRes] = await Promise.all([
            api('/home/stats'),
            api('/config/pricing')
        ]);
        if (statsRes.code === 200) {
            const d = statsRes.data;
            document.getElementById('statOrders').textContent = d.totalOrders || 0;
            document.getElementById('statRiders').textContent = d.totalRiders || 0;
            document.getElementById('statUsers').textContent = d.totalUsers || 0;
        }
        if (pricingRes.code === 200) {
            pricingConfig = pricingRes.data;
            updatePriceDisplay();
        }
    } catch (e) { console.error('loadHomeStats error:', e); }
}

// ==================== 点击弹窗外部关闭 ====================
document.addEventListener('click', function(e) {
    if (e.target.classList.contains('modal-overlay')) {
        e.target.parentElement.classList.remove('active');
    }
});

// ==================== 注册角色切换 ====================
document.getElementById('regRole')?.addEventListener('change', function() {
    const dormitoryGroup = document.getElementById('regDormitoryGroup');
    if (this.value === 'rider') {
        dormitoryGroup.style.display = 'none';
    } else {
        dormitoryGroup.style.display = 'block';
    }
});

// ==================== 宿舍楼"其他"选项切换 ====================
document.getElementById('orderDormitory')?.addEventListener('change', function() {
    const otherGroup = document.getElementById('orderOtherAddressGroup');
    if (this.value === '其他') {
        otherGroup.style.display = 'block';
    } else {
        otherGroup.style.display = 'none';
    }
});

// ==================== Polyfill: canvas roundRect ====================
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, radii) {
        let r = radii;
        if (typeof r === 'number') r = { tl: r, tr: r, br: r, bl: r };
        this.beginPath();
        this.moveTo(x + r.tl, y);
        this.lineTo(x + w - r.tr, y);
        this.quadraticCurveTo(x + w, y, x + w, y + r.tr);
        this.lineTo(x + w, y + h - r.br);
        this.quadraticCurveTo(x + w, y + h, x + w - r.br, y + h);
        this.lineTo(x + r.bl, y + h);
        this.quadraticCurveTo(x, y + h, x, y + h - r.bl);
        this.lineTo(x, y + r.tl);
        this.quadraticCurveTo(x, y, x + r.tl, y);
        this.closePath();
        return this;
    };
}

console.log('校园快递代取系统已就绪 🚀');
