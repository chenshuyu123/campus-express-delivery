# 校园快递代取系统 - Campus Express Delivery

一个完整的校园快递代取动态网站，包含学生端、骑手端和管理后台。

## 技术栈

- **后端**: Node.js + Express + SQLite (better-sqlite3)
- **前端**: 原生 HTML/CSS/JS（SPA单页应用）
- **认证**: JWT Token + bcryptjs 密码加密
- **导出**: xlsx (Excel)

## 快速开始

### 1. 安装依赖
```bash
cd campus-express-delivery
npm install
```

### 2. 初始化数据库
```bash
npm run init-db
```

### 3. 启动服务
```bash
npm start
```

服务默认运行在 http://localhost:3000

## 测试账号

| 角色 | 用户名 | 密码 | 说明 |
|------|--------|------|------|
| 管理员 | admin | admin123 | 全部管理权限 |
| 学生 | student | 123456 | 需要自行注册或初始化 |
| 骑手 | rider | 123456 | 需要自行注册或初始化 |

> 提示：学生和骑手账号可以通过注册页面自行创建。骑手注册后需要管理员在后台审核通过。

## 功能清单

### 学生端
- [x] 注册/登录
- [x] 快递下单表单（楼栋、宿舍、快递柜、取件码、大小件自动计价、预约时段）
- [x] 微信/支付宝/余额支付
- [x] 我的订单列表（按状态筛选）
- [x] 未接单订单全额退款

### 骑手端
- [x] 骑手实名认证入驻
- [x] 抢单大厅（支付完成的订单可抢，抢单后锁定）
- [x] 标记取件完成
- [x] 标记配送完成
- [x] 佣金明细
- [x] 佣金提现

### 管理后台
- [x] 骑手入驻审核（通过/拒绝）
- [x] 自定义代取收费标准（小件/大件/加急/佣金比例）
- [x] 全部订单筛选搜索
- [x] 订单数据导出Excel
- [x] 今日/本月/每日订单数据统计图表
- [x] 用户管理

## API接口文档

### 认证
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `GET /api/auth/me` - 获取当前用户信息

### 订单
- `POST /api/orders` - 创建订单
- `GET /api/orders/my` - 我的订单
- `GET /api/orders/:id` - 订单详情
- `POST /api/orders/:id/pay` - 支付订单
- `POST /api/orders/:id/alipay` - 支付宝支付
- `POST /api/orders/:id/wechatpay` - 微信支付
- `POST /api/orders/:id/cancel` - 取消订单

### 骑手
- `POST /api/rider/verify` - 提交认证
- `GET /api/rider/orders/available` - 抢单大厅
- `POST /api/rider/orders/:id/grab` - 抢单
- `GET /api/rider/orders/my` - 我的配送
- `POST /api/rider/orders/:id/pickup` - 标记取件
- `POST /api/rider/orders/:id/deliver` - 标记完成
- `GET /api/rider/commission` - 佣金明细
- `POST /api/rider/withdraw` - 提现

### 管理员
- `GET /api/admin/statistics` - 数据统计
- `GET /api/admin/orders` - 订单管理
- `GET /api/admin/orders/export` - 导出Excel
- `GET /api/admin/riders/pending` - 骑手审核列表
- `POST /api/admin/riders/:id/verify` - 审核骑手
- `POST /api/admin/pricing` - 更新收费标准
- `GET /api/admin/users` - 用户列表

## 数据库结构

- `users` - 用户表
- `orders` - 订单表
- `fund_records` - 资金流水表
- `pricing_config` - 计价配置表

## 响应式适配

页面自动适配手机和电脑：
- 手机端：单栏布局，导航折叠
- 平板端：两栏布局
- 电脑端：完整布局

## 部署说明

### 本地部署
直接运行 `npm start` 即可。

### 云服务器部署
1. 上传项目到服务器
2. 安装 Node.js 16+
3. 运行 `npm install && npm start`
4. 使用 Nginx 反向代理或直接暴露端口

### 一键部署脚本
项目包含完整的 package.json，可部署到：
- 腾讯云 CloudBase
- 阿里云 SAE
- Vercel / Railway 等平台

## 安全特性

- JWT Token 身份认证
- bcryptjs 密码加密
- API 请求频率限制
- SQLite WAL 模式防并发
- 乐观锁抢单机制
- 输入验证和参数过滤

## 目录结构

```
campus-express-delivery/
├── package.json          # 项目配置
├── server.js             # 后端服务主文件
├── database.js           # 数据库连接
├── init-db.js            # 数据库初始化
├── data/                 # SQLite数据库文件
│   └── campus_express.db
├── public/               # 前端静态文件
│   ├── index.html        # 主页面
│   ├── styles.css        # 样式文件
│   └── app.js            # 前端逻辑
└── README.md
```
