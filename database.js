/**
 * 数据库初始化和管理 - 使用 sql.js (纯JavaScript SQLite)
 * 无需任何原生编译，跨平台兼容
 * Railway 上使用内存模式（文件系统不持久化）
 */

const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');

// Railway 使用 /tmp 目录，但重启会丢失；本地使用 data 目录
const IS_RAILWAY = !!process.env.RAILWAY_ENVIRONMENT || !!process.env.RAILWAY_SERVICE_ID;
const DATA_DIR = IS_RAILWAY ? '/tmp' : path.join(__dirname, 'data');
const DB_PATH = path.join(DATA_DIR, 'campus_express.db');

let db = null;

// 确保目录存在
if (!IS_RAILWAY && !fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

// 初始化数据库
async function getDb() {
    if (db) return db;

    const SQL = await initSqlJs();

    // 如果数据库文件存在则加载，否则创建新的
    if (fs.existsSync(DB_PATH)) {
        const buffer = fs.readFileSync(DB_PATH);
        db = new SQL.Database(buffer);
    } else {
        db = new SQL.Database();
    }

    db.run('PRAGMA journal_mode = MEMORY');
    db.run('PRAGMA synchronous = OFF');
    db.run('PRAGMA foreign_keys = ON');

    return db;
}

// 保存数据库到文件（Railway上跳过，因为文件系统不持久化）
function saveDb() {
    if (db && !IS_RAILWAY) {
        const data = db.export();
        const buffer = Buffer.from(data);
        fs.writeFileSync(DB_PATH, buffer);
    }
}

// 包装数据库操作，提供类似 better-sqlite3 的接口
class DatabaseWrapper {
    constructor() {
        this._db = null;
        this._initialized = false;
    }

    async init() {
        if (this._initialized) return;
        this._db = await getDb();
        this._initialized = true;
    }

    // 执行查询并返回所有结果
    _query(sql, params = []) {
        const stmt = this._db.prepare(sql);
        if (params.length > 0) {
            stmt.bind(params);
        }
        const results = [];
        while (stmt.step()) {
            results.push(stmt.getAsObject());
        }
        stmt.free();
        return results;
    }

    // 执行写操作
    _run(sql, params = []) {
        this._db.run(sql, params);
        const changes = this._db.getRowsModified();
        saveDb();
        return { changes };
    }

    // 执行SQL
    exec(sql) {
        this._db.run(sql);
        saveDb();
    }

    // 预编译语句风格的查询
    prepare(sql) {
        const self = this;
        return {
            get(...params) {
                const results = self._query(sql, params);
                return results.length > 0 ? results[0] : null;
            },
            all(...params) {
                return self._query(sql, params);
            },
            run(...params) {
                return self._run(sql, params);
            }
        };
    }

    close() {
        if (this._db) {
            saveDb();
            this._db.close();
            this._db = null;
            this._initialized = false;
        }
    }
}

const dbWrapper = new DatabaseWrapper();

// 进程退出时保存数据库
process.on('exit', () => saveDb());
process.on('SIGINT', () => { saveDb(); process.exit(); });
process.on('SIGTERM', () => { saveDb(); process.exit(); });

// 导出数据库实例（异步初始化）
async function getDatabase() {
    await dbWrapper.init();
    return dbWrapper;
}

module.exports = { getDatabase, saveDb };
