const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../database');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

// ===== ENV =====
const AS400_INTERNAL_URL = process.env.AS400_INTERNAL_URL || 'http://localhost:5000/api/as400';
const JOB_TICKET_URL = process.env.JOB_TICKET_URL;
const MACHINE_URL = process.env.MACHINE_URL;
const PART_CONVERT_URL = process.env.PART_CONVERT_URL;
const API_TOKEN = process.env.API_TOKEN;

// ===== CACHE =====
const apiCache = new Map();
const TTL_5MIN = 5 * 60 * 1000;
const TTL_30MIN = 30 * 60 * 1000;

const withCache = async (key, ttlMs, fetchFn) => {
    const cached = apiCache.get(key);
    if (cached && Date.now() - cached.timestamp < ttlMs) return cached.data;
    const data = await fetchFn();
    apiCache.set(key, { data, timestamp: Date.now() });
    return data;
};

const getMachineList = () =>
    withCache('machine-list', TTL_30MIN, () =>
        axios.get(`${MACHINE_URL}/N?processes=1520,1512`, { headers: { Authorization: API_TOKEN } })
            .then(r => r.data)
    );


// =========================================================
// IT API PROXY
// =========================================================

// Job Ticket API
// ดึงข้อมูล lot จาก barcode ผ่าน IT API — cache 5 นาที
router.get('/job-ticket/:barcode', async (req, res) => {
    try {
        const data = await withCache(
            `job-ticket:${req.params.barcode}`,
            TTL_5MIN,
            async () => {
                const result = await axios.get(`${JOB_TICKET_URL}/${req.params.barcode}`, {
                    headers: { Authorization: API_TOKEN }
                });
                return result.data;
            }
        );
        res.json(data);
    } catch (err) {
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});
// Mock Job Ticket API
// router.get('/job-ticket/:barcode', async (req, res) => {
//     try {
//         const pool = await poolPromise;
//         const result = await pool.request()
//             .input('barcode', sql.VarChar, req.params.barcode)
//             .execute('Stored_tb_mock_job_ticket_select');
//         res.json(result.recordset[0] || null);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// Machine API
// ดึง machine list ทั้งหมด — cache 30 นาที
router.get('/machine-list', async (req, res) => {
    try {
        res.json(await getMachineList());
    } catch (err) {
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});
// Mock Machine API
// router.get('/machine-list', async (req, res) => {
//     try {
//         const pool = await poolPromise;
//         const result = await pool.request()
//             .execute('Stored_tb_mock_machine_select');
//         res.json(result.recordset);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// Part Convert API
// แปลง part_no เป็น converted parts — cache 30 นาที
router.get('/part-convert/:partNo', async (req, res) => {
    try {
        const data = await withCache(
            `part-convert:${req.params.partNo}`,
            TTL_30MIN,
            async () => {
                const result = await axios.get(
                    `${PART_CONVERT_URL}&PartConvertFrom=${req.params.partNo}`,
                    { headers: { Authorization: API_TOKEN } }
                );
                return result.data;
            }
        );
        res.json(data);
    } catch (err) {
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});
// Mock Part Convert API
// router.get('/part-convert/:partNo', async (req, res) => {
//     try {
//         const pool = await poolPromise;
//         const result = await pool.request()
//             .input('part_no_from', sql.VarChar, req.params.partNo)
//             .execute('Stored_tb_mock_part_convert_select');
//         res.json(result.recordset);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });


// =========================================================
// READER STATUS
// =========================================================
// ดึงสถานะ reader ทุกตัวจาก Python process
router.get('/status', async (req, res) => {
    try {
        const readers = JSON.parse(
            fs.readFileSync(path.join(__dirname, '../../service/readers_config.json'), 'utf-8')
        );

        const results = await Promise.allSettled(
            readers.map(r => axios.get(`http://localhost:${r.port}/status`, { timeout: 2000 }))
        );

        let machineList = [];
        try {
            machineList = await getMachineList();
        } catch {
            machineList = apiCache.get('machine-list')?.data || [];
        }

        const statuses = results.map((r, i) => {
            const reader = readers[i];
            const machineRow = (machineList || []).find(m => m.machineNoProd === reader.location);
            return {
                type: reader.type,
                port: reader.port,
                location: reader.location,
                ip: reader.ip,
                connected: r.status === 'fulfilled' && r.value.data.connected,
                current_qty: r.status === 'fulfilled' ? (r.value.data.current_qty ?? 0) : 0,
                min_qty: r.status === 'fulfilled' ? (r.value.data.min_qty ?? 0) : 0,
                low_qty: r.status === 'fulfilled' ? (r.value.data.low_qty ?? false) : false,
                alarm: r.status === 'fulfilled' ? (r.value.data.alarm ?? false) : false,
                alarm_barcode: r.status === 'fulfilled' ? (r.value.data.alarm_barcode ?? '') : '',
                alarm_part: r.status === 'fulfilled' ? (r.value.data.alarm_part ?? '') : '',
            };
        });

        res.json({ connected: statuses.some(s => s.connected), readers: statuses });
    } catch (err) {
        res.json({ connected: false, readers: [] });
    }
});


// =========================================================
// REGISTER
// =========================================================
// ลงทะเบียน lot ใหม่จาก barcode scan
router.post('/register-lot', async (req, res) => {
    try {
        const {
            barcode, lot_no, material_no, part_no,
            machine_no, process_code, process, coil,
            ir_diameter, rw_diameter, process_date, quantity,
        } = req.body;

        const pool = await poolPromise;
        const result = await pool.request()
            .input('barcode', sql.VarChar, barcode)
            .input('lot_no', sql.VarChar, lot_no)
            .input('material_no', sql.VarChar, material_no)
            .input('part_no', sql.VarChar, part_no)
            .input('machine_no', sql.VarChar, machine_no)
            .input('process_code', sql.VarChar, process_code)
            .input('process', sql.VarChar, process)
            .input('coil', sql.VarChar, coil)
            .input('ir_diameter', sql.VarChar, ir_diameter)
            .input('rw_diameter', sql.VarChar, rw_diameter)
            .input('process_date', sql.DateTime, process_date ? new Date(process_date) : null)
            .input('quantity', sql.Int, quantity)
            .execute('Stored_tb_rfid_lot_insert');

        const data = result.recordset[0];
        res.json({
            result: data.result,
            tray_counter: data.tray_counter,
            tray_done: data.tray_done,
            tray_qty: data.tray_qty,
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ลงทะเบียน tray จาก tag scan
router.post('/register-tray', async (req, res) => {
    try {
        const { tag_id, barcode } = req.body;
        const pool = await poolPromise;
        const result = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
            .input('barcode', sql.VarChar, barcode)
            .execute('Stored_tb_rfid_tray_insert');

        res.json({ result: result.recordset[0]?.result ?? 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// =========================================================
// PALLET
// =========================================================
// update location ของ tag + ส่ง A1 pallet-in ไป AS400
router.post('/pallet', async (req, res) => {
    try {
        const { tag_id, location } = req.body;
        const pool = await poolPromise;
        const result = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
            .input('location', sql.VarChar, location)
            .execute('Stored_tb_rfid_lot_update_location');

        const status = result.recordset[0]?.result ?? 'OK';
        if (status === 'OK') {
            const lotResult = await pool.request()
                .input('tag_id', sql.VarChar, tag_id)
                .execute('Stored_tb_rfid_lot_select_by_tagid');
            const lotData = lotResult.recordset[0];
            axios.post(`${AS400_INTERNAL_URL}/pallet-in`, {
                tag_id, barcode: lotData?.barcode, location, lot_data: lotData,
            }).catch(err => console.error('[AS400] pallet-in error:', err.message));
        }
        res.json({ result: status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ส่ง A2 pallet-out ไป AS400 เมื่อ tag ออกหมด lot
router.post('/pallet-lot-out', async (req, res) => {
    try {
        const { barcode, location } = req.body;
        const pool = await poolPromise;

        const lotResult = await pool.request()
            .input('barcode', sql.VarChar, barcode)
            .execute('Stored_tb_rfid_dashboard_movement');
        const lotData = lotResult.recordsets[0][0];

        axios.post(`${AS400_INTERNAL_URL}/pallet-out`, {
            barcode, location, lot_data: lotData,
        }).catch(err => console.error('[AS400] pallet-out error:', err.message));

        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ดึง log location ล่าสุด 50 รายการ
// router.get('/pallet-log', async (req, res) => {
//     try {
//         const pool   = await poolPromise;
//         const result = await pool.request()
//             .execute('Stored_tb_rfid_lot_query_top50_location');
//         res.json(result.recordset);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });


// =========================================================
// WASHING
// =========================================================
// ดึงข้อมูล lot+tray จาก tag_id (ใช้ใน Python และ MachineValidation)
router.post('/washing', async (req, res) => {
    try {
        const { tag_id, location, machine_no, process_code } = req.body;
        const pool = await poolPromise;
        const result = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
            .input('machine_no', sql.VarChar, location || null)
            .input('process_code', sql.VarChar, process_code || null)
            .execute('Stored_tb_rfid_tray_after_washing');

        const status = result.recordset[0]?.result ?? 'OK';
        if (status === 'LOT_WASHED') {
            const lotResult = await pool.request()
                .input('tag_id', sql.VarChar, tag_id)
                .execute('Stored_tb_rfid_lot_select_by_tagid');
            const lotData = lotResult.recordset[0];
            await axios.post(`${AS400_INTERNAL_URL}/washing`, {
                tag_id,
                barcode: lotData?.barcode,
                location: lotData?.location,
                machine_no: location,
                process_code: lotData?.process_code,
                process: lotData?.process,
                lot_data: lotData,
            }).catch(err => console.error('[AS400] washing error:', err.message));
            await new Promise(r => setTimeout(r, 5000));
            await axios.post(`${AS400_INTERNAL_URL}/washing-result`, {
                barcode: lotData?.barcode,
                machine_no: machine_no || '',
                production_qty: lotData?.quantity,
            }).catch(err => console.error('[AS400] washing-result error:', err.message));
        }
        res.json({ result: status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// ON MACHINE
// =========================================================

// ดึงข้อมูล lot จาก tag_id (ใช้ใน Python และ MachineValidation)
router.get('/lot-by-tag/:tagId', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('tag_id', sql.VarChar, req.params.tagId)
            .execute('Stored_tb_rfid_lot_select_by_tagid');

        const data = result.recordset[0];
        if (!data || data.result === 'NOT_FOUND') return res.json({ found: false });
        res.json({ found: true, data });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// A5 — tag เข้า on_machine: validate part → update DB → ส่ง AS400
router.post('/on-machine', async (req, res) => {
    try {
        const { tag_id, process_code, location } = req.body;
        const pool = await poolPromise;

        // 1. ดึง lot data
        const lotResult = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
            .execute('Stored_tb_rfid_lot_select_by_tagid');
        const lotData = lotResult.recordset[0];
        if (!lotData) return res.json({ result: 'NOT_FOUND' });

        // 2. ดึง machine list + part convert (cache)
        const [machineList, convertData] = await Promise.all([
            getMachineList(),
            withCache(`part-convert:${lotData.part_no}`, TTL_30MIN, () =>
                axios.get(`${PART_CONVERT_URL}&PartConvertFrom=${lotData.part_no}`, {
                    headers: { Authorization: API_TOKEN },
                }).then(r => r.data)
            ),
        ]);

        // 3. validate part กับ machine ที่ location นี้
        const convertedParts = Array.isArray(convertData)
            ? convertData.map(c => c.partConvertTo).filter(Boolean)
            : [];
        const partsToMatch = convertedParts.length > 0 ? convertedParts : [lotData.part_no];
        const matchedMachine = machineList.find(m =>
            m.machineNoProd === location &&
            partsToMatch.some(p => m.innerRingPart === p || m.outerRingPart === p)
        );
        if (!matchedMachine) return res.json({ result: 'PART_MISMATCH' });

        // 4. update DB
        const result = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
            .input('machine_no', sql.VarChar, location || null)
            .input('process_code', sql.VarChar, process_code || null)
            .execute('Stored_tb_rfid_tray_on_machine');
        const status = result.recordset[0]?.result ?? 'OK';

        // 5. ส่ง A5 AS400
        if (status === 'OK' || status === 'LOT_ON_MACHINE') {
            axios.post(`${AS400_INTERNAL_URL}/on-machine-in`, {
                barcode: lotData.barcode,
                machine_no: location || '',
                production_qty: lotData.tray_qty,
                process_code: lotData.process_code,
                process: lotData.process,
            }).catch(err => console.error('[AS400] on-machine-in error:', err.message));
        }
        res.json({ result: status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// A6 — tag ครบ lot ครั้งแรก: ดึง wosBarcode + ส่ง checking ไป AS400
router.post('/on-machine-checking', async (req, res) => {
    try {
        const { barcode, location, part_no } = req.body;

        // ดึง machine info จาก cache เพื่อหา wosBarcode และ materialType
        let machineList = [];
        try {
            machineList = await getMachineList();
        } catch {
            machineList = apiCache.get('machine-list')?.data || [];
        }

        const machineRow = (machineList || []).find(m => m.machineNoProd === location);
        const wosBarcode = machineRow?.wosBarcode || '';
        // innerRingPart = materialType 2, outerRingPart = materialType 1
        const materialType = machineRow?.innerRingPart === part_no ? '2' : '1';
        const checkResult = wosBarcode ? 'Y' : 'N';

        axios.post(`${AS400_INTERNAL_URL}/checking`, {
            barcode,
            machine_no: location,
            wos_barcode: wosBarcode,
            jobtag: barcode,
            check_result: checkResult,
            material_type: materialType,
        }).catch(err => console.error('[AS400] checking error:', err.message));

        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// A7 — tag ออก on_machine เกิน cooldown
router.post('/on-machine-out', async (req, res) => {
    try {
        // Python ส่ง location มา ไม่ใช่ machine_no
        const { tag_id, barcode, qty, location } = req.body;
        axios.post(`${AS400_INTERNAL_URL}/on-machine-out`, {
            tag_id, barcode, qty, machine_no: location,
        }).catch(err => console.error('[AS400] on-machine-out error:', err.message));
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// นับ tray ที่ผ่าน washing แล้ว
router.get('/tray_count/:barcode', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('barcode', sql.VarChar, req.params.barcode)
            .execute('Stored_tb_rfid_tray_count_washing');
        res.json(result.recordset[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// =========================================================
// COMPLETED
// =========================================================
// update tray เป็น completed
router.post('/completed', async (req, res) => {
    try {
        const { tag_id } = req.body;
        const pool = await poolPromise;

        const lotResult = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
            .execute('Stored_tb_rfid_completed_select_by_tagid');
        const lotData = lotResult.recordset[0];

        const result = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
            .input('process_code', sql.VarChar, lotData?.process_code || null)
            .execute('Stored_tb_rfid_tray_completed');

        res.json({ result: result.recordset[0]?.result ?? 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// =========================================================
// DASHBOARD
// =========================================================
// ดึง monitor summary + lot list + history log
router.get('/dashboard', async (req, res) => {
    try {
        const { date_from = null, date_to = null } = req.query;
        const pool = await poolPromise;

        const monitor = await pool.request()
            .execute('Stored_tb_rfid_dashboard_monitor');
        const history = await pool.request()
            .input('date_from', date_from)
            .input('date_to', date_to)
            .execute('Stored_tb_rfid_dashboard_history');

        res.json({
            summary: monitor.recordsets[0],  // นับ lot แยก sub_process
            lots: monitor.recordsets[1],  // lot list Ongoing
            history: history.recordsets[0],  // log history
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.get('/dashboard/:barcode', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('barcode', sql.VarChar, req.params.barcode)
            .execute('[Stored_tb_rfid_dashboard_movement]');

        res.json({
            lot: result.recordsets[0][0] || null,
            rows: result.recordsets[1],
        });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// =========================================================
// MBR MONITOR
// =========================================================
// ดึง qty รวมของ tray ที่อยู่บน on_machine แยกตาม machine
router.get('/mbr-monitor', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('Stored_tb_rfid_mbr_monitor');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// =========================================================
// READER CONFIG
// =========================================================
// อ่าน readers_config.json
router.get('/readers-config', (req, res) => {
    try {
        const config = JSON.parse(fs.readFileSync(
            path.join(__dirname, '../../service/readers_config.json'), 'utf-8'
        ));
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// บันทึก readers_config.json
router.put('/readers-config', (req, res) => {
    try {
        fs.writeFileSync(
            path.join(__dirname, '../../service/readers_config.json'),
            JSON.stringify(req.body, null, 4)
        );
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// restart Python process ของ reader ที่ port นั้น
router.post('/readers-restart/:port', async (req, res) => {
    try {
        await axios.get(`http://localhost:${req.params.port}/restart`, { timeout: 3000 });
        res.json({ result: 'OK' });
    } catch {
        res.json({ result: 'OK' });
    }
});


// =========================================================
// AUTH / LOGIN
// =========================================================
// เช็ค emp_id + password
router.post('/login', async (req, res) => {
    try {
        const { emp_id, password } = req.body;
        const pool = await poolPromise;
        const result = await pool.request()
            .input('emp_id', sql.VarChar, emp_id)
            .input('password', sql.VarChar, password)
            .execute('Stored_tb_rfid_login_check');

        const row = result.recordset[0];
        if (row?.result === 'OK') {
            res.json({ result: 'OK', emp_id: row.emp_id, eng_name: row.eng_name, position: row.position });
        } else {
            res.json({ result: 'INVALID' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ดึง user ทั้งหมด
router.get('/login-setting', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('Stored_tb_rfid_login_setting_select');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// เพิ่ม user
router.post('/login-setting', async (req, res) => {
    try {
        const { emp_id, eng_name, password, position } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('emp_id', sql.VarChar, emp_id)
            .input('eng_name', sql.VarChar, eng_name)
            .input('password', sql.VarChar, password)
            .input('position', sql.VarChar, position)
            .execute('Stored_tb_rfid_login_setting_insert');
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ลบ user
router.delete('/login-setting/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .execute('Stored_tb_rfid_login_setting_delete');
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// =========================================================
// LOCATION PORTS
// =========================================================
// อ่าน location_ports.json
router.get('/location-ports', (req, res) => {
    try {
        const config = JSON.parse(fs.readFileSync(
            path.join(__dirname, '../../service/location_ports.json'), 'utf-8'
        ));
        res.json(config);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// บันทึก location_ports.json
router.put('/location-ports', (req, res) => {
    try {
        fs.writeFileSync(
            path.join(__dirname, '../../service/location_ports.json'),
            JSON.stringify(req.body, null, 4)
        );
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// =========================================================
// MASTER TRAY
// =========================================================
// ดึง master tray ทั้งหมด
router.get('/master-tray', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('Stored_tb_master_tray_select');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// insert/update master tray
router.post('/master-tray', async (req, res) => {
    try {
        const { part_no, pcs_stc, stc_try } = req.body;
        const pool = await poolPromise;
        const result = await pool.request()
            .input('part_no', sql.VarChar, part_no)
            .input('pcs_stc', sql.Int, pcs_stc)
            .input('stc_try', sql.Int, stc_try)
            .execute('Stored_tb_master_tray_update');
        res.json(result.recordset[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// bulk upsert จาก Excel
router.post('/master-tray/import', async (req, res) => {
    try {
        const { data } = req.body;
        const pool = await poolPromise;
        const results = await Promise.all(data.map(row =>
            pool.request()
                .input('part_no', sql.VarChar, row.part_no)
                .input('pcs_stc', sql.Int, row.pcs_stc)
                .input('stc_try', sql.Int, row.stc_try)
                .execute('Stored_tb_master_tray_update')
        ));
        res.json({ result: 'OK', count: results.length });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ลบ master tray
router.delete('/master-tray/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .execute('Stored_tb_master_tray_delete');
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


// =========================================================
// MASTER PROCESS
// =========================================================
// ดึง master process ทั้งหมด
router.get('/master-process', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('Stored_tb_master_process_select');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// เพิ่ม master process
router.post('/master-process', async (req, res) => {
    try {
        const { process_code, process } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('process_code', sql.VarChar, process_code)
            .input('process', sql.VarChar, process)
            .execute('Stored_tb_master_process_insert');
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// แก้ไข master process
router.put('/master-process/:id', async (req, res) => {
    try {
        const { process_code, process } = req.body;
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .input('process_code', sql.VarChar, process_code)
            .input('process', sql.VarChar, process)
            .execute('Stored_tb_master_process_update');
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// ลบ master process
router.delete('/master-process/:id', async (req, res) => {
    try {
        const pool = await poolPromise;
        await pool.request()
            .input('id', sql.Int, req.params.id)
            .execute('Stored_tb_master_process_delete');
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


module.exports = router;