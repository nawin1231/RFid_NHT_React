const express = require('express');
const router  = express.Router();
const si      = require('systeminformation');
const fs      = require('fs');

const K6_RESULT_PATH = 'D:/RFID_NHT_WASHING/result.json';
const REPORT_PATH    = 'D:/RFID_NHT_WASHING/load_test_report.txt';

// ---- GET /api/monitor/system ----
router.get('/system', async (req, res) => {
    try {
        const [cpu, mem] = await Promise.all([
            si.currentLoad(),
            si.mem(),
        ]);

        res.json({
            cpu: {
                load:  parseFloat(cpu.currentLoad.toFixed(1)),
                cores: 2,           // mock
            },
            ram: {
                total: 16 * 1024 ** 3,  // mock 16 GB
                used:  mem.used,
                free:  mem.free,
            },
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/k6/export', async (req, res) => {
    try {
        if (!fs.existsSync(K6_RESULT_PATH)) {
            return res.json({ error: 'ยังไม่มี result.json — รัน k6 ก่อน' });
        }

        const [cpu, mem] = await Promise.all([
            si.currentLoad(),
            si.mem(),
        ]);

        const raw      = fs.readFileSync(K6_RESULT_PATH, 'utf-8');
        const k6       = JSON.parse(raw);
        const metrics  = k6.metrics;

        const p95val    = metrics?.http_req_duration?.['p(95)'] ?? 0;
        const errorRate = metrics?.http_req_failed?.value ?? 0;
        const failCount = metrics?.failed_requests?.count ?? 0;
        const totalIter = metrics?.iterations?.count ?? 0;
        const avgRes    = metrics?.http_req_duration?.avg ?? 0;

        // checks summary
        const checks      = metrics?.checks;
        const checkPasses = checks?.passes ?? 0;
        const checkFails  = checks?.fails ?? 0;
        const checkTotal  = checkPasses + checkFails;

        const passP95    = p95val < 2000;
        const passError  = errorRate < 0.01;
        const passFailed = failCount < 5;
        const allPass    = passP95 && passError && passFailed;
        const verdict    = allPass
            ? '✅ SERVER รับได้ — ไม่แตก'
            : '❌ SERVER รับไม่ไหว — ควรปรับปรุง';

        const ramUsedGB  = (mem.used / 1024 ** 3).toFixed(1);
        const cpuLoad    = parseFloat(cpu.currentLoad.toFixed(1));

        const now = new Date().toLocaleString('th-TH');
        const report = `
========================================
  NHT Washing — Load Test Report
  ${now}
========================================

📊 RESULT: ${verdict}

--- Server Spec (ขณะ export) ---
CPU               : 2 Core  (Load: ${cpuLoad}%)
RAM               : ${ramUsedGB} GB used / 16 GB total

--- k6 Metrics (400 VUs / Reader) ---
Avg Response Time : ${avgRes.toFixed(2)} ms
p(95) Response    : ${p95val.toFixed(2)} ms     (threshold < 2000ms)
Error Rate        : ${(errorRate * 100).toFixed(2)}%         (threshold < 1%)
Total Iterations  : ${totalIter}
Failed Requests   : ${failCount}              (threshold < 5)
Checks Passed     : ${checkPasses}/${checkTotal} (${((checkPasses/checkTotal)*100).toFixed(1)}%)

--- Thresholds ---
p(95) < 2000ms    : ${passP95    ? '✅ PASS' : '❌ FAIL'}
Error Rate < 1%   : ${passError  ? '✅ PASS' : '❌ FAIL'}
Failed < 5        : ${passFailed ? '✅ PASS' : '❌ FAIL'}

========================================
`.trim();

        fs.writeFileSync(REPORT_PATH, report, 'utf-8');
        res.json({ message: 'Export สำเร็จ', path: REPORT_PATH, report });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
module.exports = router;