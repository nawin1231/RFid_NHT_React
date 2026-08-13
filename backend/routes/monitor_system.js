const si      = require('systeminformation');
const fs      = require('fs');
const path    = 'D:/RFID_NHT_WASHING/system_monitor.log';

const INTERVAL_SEC = 2; // บันทึกทุก 2 วินาที

console.log('🟢 System Monitor เริ่มทำงาน...');
console.log(`📄 บันทึกที่: ${path}`);
console.log('กด Ctrl+C เพื่อหยุด\n');

// เขียน header
fs.writeFileSync(path, `NHT Washing — System Monitor Log\n${'='.repeat(50)}\n\n`, 'utf-8');

setInterval(async () => {
    try {
        const [cpu, mem] = await Promise.all([
            si.currentLoad(),
            si.mem(),
        ]);

        const now        = new Date().toLocaleString('th-TH');
        const cpuLoad    = cpu.currentLoad.toFixed(1);
        const ramUsedGB  = (mem.used  / 1024 ** 3).toFixed(2);
        const ramTotalGB = 16; // mock
        const ramPct     = ((mem.used / (ramTotalGB * 1024 ** 3)) * 100).toFixed(1);

        const line = `[${now}] CPU: ${cpuLoad}%  |  RAM: ${ramUsedGB}/${ramTotalGB} GB (${ramPct}%)\n`;

        // แสดงใน terminal ด้วย
        process.stdout.write(line);

        // บันทึกลงไฟล์
        fs.appendFileSync(path, line, 'utf-8');

    } catch (err) {
        console.error('Error:', err.message);
    }

}, INTERVAL_SEC * 1000);