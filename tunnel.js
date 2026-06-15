/**
 * 公网隧道脚本 - 使用 localtunnel 并自动重连
 * 独立于 server.js 运行，更稳定
 */
const localtunnel = require('localtunnel');
const fs = require('fs');
const path = require('path');

const PORT = 3000;
const MAX_RETRY = 10;
const URL_FILE = path.join(__dirname, 'tunnel-url.txt');

let retryCount = 0;

async function createTunnel() {
    try {
        console.log(`[${new Date().toLocaleTimeString()}] 正在创建公网隧道...`);

        const tunnel = await localtunnel({ port: PORT });

        const url = tunnel.url;
        console.log('');
        console.log('═══════════════════════════════════════════════════');
        console.log('  ★ 公网访问链接: ' + url);
        console.log('  ★ 把这个链接发给任何人即可访问');
        console.log('═══════════════════════════════════════════════════');
        console.log('');

        // 保存URL到文件
        fs.writeFileSync(URL_FILE, url);
        retryCount = 0;

        tunnel.on('close', () => {
            console.log(`[${new Date().toLocaleTimeString()}] 隧道断开，准备重连...`);
            setTimeout(createTunnel, 5000);
        });

        tunnel.on('error', (err) => {
            console.log(`[${new Date().toLocaleTimeString()}] 隧道错误:`, err.message);
        });

    } catch (err) {
        console.log(`[${new Date().toLocaleTimeString()}] 创建失败:`, err.message);
        retryCount++;
        if (retryCount <= MAX_RETRY) {
            const wait = Math.min(retryCount * 5, 30);
            console.log(`  将在 ${wait} 秒后重试 (${retryCount}/${MAX_RETRY})...`);
            setTimeout(createTunnel, wait * 1000);
        } else {
            console.log('  已达最大重试次数，请检查网络后重新运行此脚本。');
            console.log('  按 Ctrl+C 退出后重新运行: node tunnel.js');
        }
    }
}

console.log('校园快递 - 公网隧道服务');
console.log('按 Ctrl+C 停止');
console.log('');
createTunnel();
