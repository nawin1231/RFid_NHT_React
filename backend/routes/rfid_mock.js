const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../database');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
// -- API --
const AS400_INTERNAL_URL = process.env.AS400_INTERNAL_URL || 'http://localhost:5000/api/as400';
const JOB_TICKET_URL = process.env.JOB_TICKET_URL;
const MACHINE_URL = process.env.MACHINE_URL;
const PART_CONVERT_URL = process.env.PART_CONVERT_URL;
const API_TOKEN = process.env.API_TOKEN;
const API_CHECKING_URL = process.env.API_CHECKING_URL;

// ---- API CACHE ----
// เก็บ cache แยกตาม key เพื่อไม่ให้ปนกัน
const apiCache = new Map()
// helper ดึงจาก cache หรือเรียก API ใหม่ถ้าหมดอายุ
const withCache = async (key, ttlMs, fetchFn) => {
    const cached = apiCache.get(key)
    if (cached && Date.now() - cached.timestamp < ttlMs) {
        return cached.data  // คืน cache เลย
    }
    const data = await fetchFn()
    apiCache.set(key, { data, timestamp: Date.now() })
    return data
}

const TTL_5MIN = 5 * 60 * 1000
const TTL_30MIN = 30 * 60 * 1000

// Job Ticket API
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
router.get('/machine-list', async (req, res) => {
    try {
        const data = await withCache(
            'machine-list',
            TTL_30MIN,
            async () => {
                const result = await axios.get(`${MACHINE_URL}/N?processes=1520,1512`, {
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
// Mock Machine API
// router.get('/machine-list',async (req,res) => {
//     try{
//         const pool = await poolPromise;
//         const result = await pool.request()
//             .execute('Stored_tb_mock_machine_select');
//         res.json(result.recordset);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });
// Part Convert API
router.get('/part-convert/:partNo', async (req, res) => {
    try {
        const data = await withCache(
            `part-convert:${req.params.partNo}`,
            TTL_30MIN,
            async () => {
                const fullUrl = `${PART_CONVERT_URL}&PartConvertFrom=${req.params.partNo}`;
                const result = await axios.get(fullUrl, {
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

// เช็คสถานะ Reader จาก Python ว่า Connected หรือ Disconnected (main_dll)
router.get('/status', async (req, res) => {
    try {
        const readers = JSON.parse(
            fs.readFileSync(path.join(__dirname, '../../service/readers_config.json'), 'utf-8')
        );
        const requests = readers.map(r =>
            axios.get(`http://localhost:${r.port}/status`, { timeout: 2000 })
        );

        const results = await Promise.allSettled(requests);

        // ดึง machine list จาก cache
        let machineList = [];
        try {
            machineList = await withCache('machine-list', TTL_30MIN, async () => {
                const result = await axios.get(`${MACHINE_URL}/N?processes=1520,1512`, {
                    headers: { Authorization: API_TOKEN }
                });
                return result.data;
            });
        } catch {
            machineList = apiCache.get('machine-list')?.data || [];
        }

        const statuses = results.map((r, i) => {
            const reader = readers[i];
            const machineRow = (machineList || []).find(m => m.machineNoProd === reader.location);
            const parts = [machineRow?.innerRingPart].filter(Boolean);
            const rps = [machineRow?.rp].filter(Boolean);

            return {
                type: reader.type,
                port: reader.port,
                location: reader.location,
                ip: reader.ip,
                connected: r.status === 'fulfilled' && r.value.data.connected,
                current_qty: r.status === 'fulfilled' ? (r.value.data.current_qty ?? 0) : 0,
                min_qty: r.status === 'fulfilled' ? (r.value.data.min_qty ?? 0) : 0,
                low_qty: r.status === 'fulfilled' ? (r.value.data.low_qty ?? false) : false,
            };
        });

        res.json({
            connected: statuses.some(s => s.connected),
            readers: statuses,
        });

    } catch (err) {
        res.json({ connected: false, readers: [] });
    }
});

// router.get('/status', async (req, res) => { (main_multi)
//     try {
//         const result = await axios.get('http://localhost:8000/status/all', { timeout: 2000 });
//         res.json(result.data);
//     } catch (err) {
//         res.json({ connected: false, readers: [] });
//     }
// });

// // ดึง tag id จาก Python
// router.get('/new-tag', async (req, res) => {
//     try {
//         const result = await axios.get(`${PYTHON_URL}/new-tag`);
//         res.json(result.data);
//     } catch {
//         res.json({ tag_id: null });
//     }
// });


//=========================================================
// หน้า Register
//=========================================================
// INSERT lot ตอน scan barcode
router.post('/register-lot', async (req, res) => {
    try {
        const {
            barcode, lot_no, material_no, part_no,
            machine_no, process_code, process, coil,
            ir_diameter, rw_diameter, process_date,
            quantity
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

// INSERT tray ตอน scan tag
router.post('/register-tray', async (req, res) => {
    try {
        const { tag_id, barcode } = req.body;

        const pool = await poolPromise;
        const result = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
            .input('barcode', sql.VarChar, barcode)
            .execute('Stored_tb_rfid_tray_insert');

        const status = result.recordset[0]?.result ?? 'OK';
        res.json({ result: status });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
//=========================================================
// หน้า Pallet
//=========================================================
// Updated location + บันทึก log
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
                tag_id,
                barcode: lotData?.barcode,
                location,
                lot_data: lotData,
            }).catch(err => console.error('[AS400] pallet-in error:', err.message));
        }
        res.json({ result: status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
router.post('/pallet-lot-out', async (req, res) => {
    try {
        const { barcode, location } = req.body;
        axios.post(`${AS400_INTERNAL_URL}/pallet-out`, {
            barcode,
            location,
        }).catch(err => console.error('[AS400] pallet-out error:', err.message));

        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
//ข้อมูล log การเพิ่ม location pallet
router.get('/pallet-log', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('Stored_tb_rfid_lot_query_top50_location');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

//after_washing
router.post('/washing', async (req, res) => {
    try {
        const { tag_id, location, machine_no, process_code } = req.body; // ลบ process ออก
        const pool = await poolPromise;
        const result = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
            .input('machine_no', sql.VarChar, machine_no || null)
            .input('process_code', sql.VarChar, process_code || null)
            // ลบ .input('process', ...) ออก
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
                machine_no: machine_no,
                process_code: lotData?.process_code,
                process: lotData?.process,
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

//ข้อมูล log การเข้าออกเครื่อง washing
router.get('/washing-log', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('Stored_tb_rfid_tray_query_top50_washing');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// หน้า Machine Validation
//=========================================================
// ดึงข้อมูล lot จาก tag_id
router.get('/lot-by-tag/:tagId', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('tag_id', sql.VarChar, req.params.tagId)
            .execute('Stored_tb_rfid_lot_select_by_tagid');

        const data = result.recordset[0];

        if (!data || data.result === 'NOT_FOUND') {
            return res.json({ found: false });
        }

        res.json({ found: true, data });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
            withCache('machine-list', TTL_30MIN, () =>
                axios.get(`${MACHINE_URL}/N?processes=1520,1512`, { headers: { Authorization: API_TOKEN } })
                    .then(r => r.data)
            ),
            withCache(`part-convert:${lotData.part_no}`, TTL_30MIN, () =>
                axios.get(`${PART_CONVERT_URL}&PartConvertFrom=${lotData.part_no}`, { headers: { Authorization: API_TOKEN } })
                    .then(r => r.data)
            ),
        ]);

        // 3. validate part
        const convertedParts = Array.isArray(convertData) ? convertData.map(c => c.partConvertTo).filter(Boolean) : [];
        const partsToMatch = convertedParts.length > 0 ? convertedParts : [lotData.part_no];
        const matchedMachine = machineList.find(m =>
            m.machineNoProd === location &&
            partsToMatch.some(p => m.innerRingPart === p || m.outerRingPart === p)
        );

        // helper ส่ง A6
        const sendChecking = (checkResult, machine) => {
            const materialType = partsToMatch.some(p => machine?.innerRingPart === p) ? '2' : '1';
            axios.post(`${AS400_INTERNAL_URL}/checking`, {
                barcode: lotData.barcode,
                machine_no: location,
                wos_barcode: machine?.wosBarcode,
                jobtag: lotData.barcode,
                check_result: checkResult,
                material_type: materialType,
            }).catch(err => console.error('[AS400] checking error:', err.message));
        };

        // ไม่ผ่าน → ส่ง A6 N แล้ว return
        if (!matchedMachine) {
            const machineInfo = machineList.find(m => m.machineNoProd === location);
            sendChecking('N', machineInfo);
            return res.json({ result: 'PART_MISMATCH' });
        }

        // 4. update DB
        const result = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
            .input('machine_no', sql.VarChar, location || null)
            .input('process_code', sql.VarChar, process_code || null)
            .execute('Stored_tb_rfid_tray_on_machine');
        const status = result.recordset[0]?.result ?? 'OK';
        console.log('[ON-MACHINE] status:', status, 'tag:', tag_id);

        // 5. ส่ง AS400
        if (status === 'OK' || status === 'LOT_ON_MACHINE') {
            await axios.post(`${AS400_INTERNAL_URL}/on-machine-in`, {
                barcode: lotData.barcode,
                machine_no: location || '',
                production_qty: lotData.tray_qty,
                process_code: lotData.process_code,
                process: lotData.process,
            }).catch(err => console.error('[AS400] on-machine-in error:', err.message));
        }
        if (status === 'LOT_ON_MACHINE') {
            sendChecking('Y', matchedMachine);
        }
        console.log('[A6] wosBarcode:', matchedMachine?.wosBarcode, 'machine:', location);
        res.json({ result: status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.post('/on-machine-out', async (req, res) => {
    try {
        const { tag_id, barcode, qty, machine_no } = req.body;
        const pool = await poolPromise;

        axios.post(`${AS400_INTERNAL_URL}/on-machine-out`, {
            tag_id,
            qty,
            barcode,
            machine_no,
        }).catch(err => console.error('[AS400] on-machine-out error:', err.message));

        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

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
        const status = result.recordset[0]?.result ?? 'OK';
        res.json({ result: status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

//ข้อมูล log การเข้าออกเครื่อง washing
router.get('/on-machine-log', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('Stored_tb_rfid_tray_query_top50_machine');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// เรียกนับ จำนวน tag ที่ผ่าน washing เพื่อจะไปแสดง machine ที่ตรงกับ part_no
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

router.get('/dashboard', async (req, res) => {
    try {
        const { date_from = null, date_to = null } = req.query

        const pool = await poolPromise

        // Monitor: เรียก SP แรก ได้ 2 recordset — summary และ lot list
        const monitor = await pool.request()
            .execute('Stored_tb_rfid_dashboard_monitor')

        // History: เรียก SP สอง รับ date range
        const history = await pool.request()
            .input('date_from', date_from)
            .input('date_to', date_to)
            .execute('Stored_tb_rfid_dashboard_history')

        res.json({
            summary: monitor.recordsets[0], // นับ lot แยก sub_process
            lots: monitor.recordsets[1], // lot list ทั้งหมด Ongoing
            history: history.recordsets[0], // log history
        })

    } catch (err) {
        res.status(500).json({ error: err.message })
    }
})

// MBR Monitor
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


// หน้า Reader Config
//=========================================================
// อ่าน readers config
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

// บันทึก readers config
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

// restart Python reader (main_dll)
router.post('/readers-restart/:port', async (req, res) => {
    try {
        await axios.get(`http://localhost:${req.params.port}/restart`, { timeout: 3000 });
        res.json({ result: 'OK' });
    } catch {
        res.json({ result: 'OK' });
    }
});

// Reader config Login
router.post('/login', async (req, res) => {
    try {
        const { emp_id, password } = req.body;

        const pool = await poolPromise;
        const result = await pool.request()
            .input('emp_id', sql.VarChar, emp_id)
            .input('password', sql.VarChar, password)
            .execute('Stored_tb_rfid_login_check');

        const status = result.recordset[0]?.result;

        if (status === 'OK') {
            res.json({
                result: 'OK',
                emp_id: result.recordset[0].emp_id,
                eng_name: result.recordset[0].eng_name,
                position: result.recordset[0].position,
            });
        } else {
            res.json({ result: 'INVALID' });
        }
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
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

// หน้า Location Json
//=========================================================
// อ่าน location ports
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

// บันทึก location ports
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

// Master Tray
//=========================================================
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

router.post('/master-tray/import', async (req, res) => {
    try {
        const { data } = req.body; // array of { part_no, pcs_stc, stc_try }
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

// Master Process
//=========================================================
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