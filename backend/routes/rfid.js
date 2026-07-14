const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../database');
const axios = require('axios');
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const AS400_INTERNAL_URL = process.env.AS400_INTERNAL_URL || 'http://localhost:5000/api/as400';


// Job Ticket API
const JOB_TICKET_URL = process.env.JOB_TICKET_URL;
const JOB_TICKET_TOKEN = process.env.JOB_TICKET_TOKEN;
router.get('/job-ticket/:barcode', async (req, res) => {
    try {
        const result = await axios.get(`${JOB_TICKET_URL}/${req.params.barcode}`, {
            headers: { Authorization: JOB_TICKET_TOKEN }
        });
        res.json(result.data);
    } catch (err) {
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});

// Machine API
const MACHINE_URL = process.env.MACHINE_URL;
const MACHINE_TOKEN = process.env.MACHINE_TOKEN;
router.get('/machine-list', async (req, res) => {
    try {
        const result = await axios.get(`${MACHINE_URL}/N?processes=1520,1512`, {
            headers: { Authorization: MACHINE_TOKEN }
        });
        res.json(result.data);
    } catch (err) {
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});
// Part Convert API
const PART_CONVERT_URL = process.env.PART_CONVERT_URL;
const PART_CONVERT_TOKEN = process.env.PART_CONVERT_TOKEN;
router.get('/part-convert/:partNo', async (req, res) => {
    const fullUrl = `${PART_CONVERT_URL}&PartConvertFrom=${req.params.partNo}`;
    try {
        const result = await axios.get(fullUrl, {
            headers: { Authorization: PART_CONVERT_TOKEN }
        });
        res.json(result.data);
    } catch (err) {
        res.status(err.response?.status || 500).json({ error: err.message });
    }
});

// เช็คสถานะ Reader จาก Python ว่า Connected หรือ Disconnected
router.get('/status', async (req, res) => {
    try {
        const readers = JSON.parse(
            fs.readFileSync(path.join(__dirname, '../../service/readers_config.json'), 'utf-8')
        );
        const requests = readers.map(r =>
            axios.get(`http://localhost:${r.port}/status`, { timeout: 2000 })
        );

        const results = await Promise.allSettled(requests);

        const statuses = results.map((r, i) => ({
            type: readers[i].type,
            port: readers[i].port,
            location: readers[i].location,
            ip: readers[i].ip,
            connected: r.status === 'fulfilled' && r.value.data.connected,
            current_qty: r.status === 'fulfilled' ? (r.value.data.current_qty ?? 0) : 0,
            min_qty: r.status === 'fulfilled' ? (r.value.data.min_qty ?? 0) : 0,
            low_qty: r.status === 'fulfilled' ? (r.value.data.low_qty ?? false) : false,
        }));

        res.json({
            connected: statuses.some(s => s.connected),
            readers: statuses,
        });

    } catch (err) {
        res.json({ connected: false, readers: [] });
    }
});

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
// หน้า Login
//=========================================================
// router.post('/login', async (req, res) => {
//     try {
//         const { emp_code } = req.body;

//         const pool = await poolPromise;
//         const result = await pool.request()
//             .input('emp_code', sql.VarChar, emp_code)
//             .execute('Stored_tb_rfid_employee_login');

//         const data = result.recordset[0] || result.recordsets?.[1]?.[0];
//         // console.log('recordsets:', JSON.stringify(result.recordsets));
//         // console.log('recordset:', JSON.stringify(result.recordset));

//         if (data.result !== 'OK') {
//             return res.json({ success: false, message: 'Employee not found!' });
//         }

//         res.json({
//             success: true,
//             emp_code: data.emp_code,
//             name: data.name,
//             position: data.position,
//         });

//     } catch (err) {
//         res.status(500).json({ error: err.message });
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
            quantity, operator
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
            .input('operator', sql.VarChar, operator)
            .execute('Stored_tb_rfid_lot_insert');

        // console.log('result:', result.recordset);

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
        const { tag_id, barcode, operator } = req.body;

        const pool = await poolPromise;
        const result = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
            .input('barcode', sql.VarChar, barcode)
            .input('operator', sql.VarChar, operator)
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
        const { tag_id, location, machine_no, process_code, process } = req.body;

        const pool = await poolPromise;
        const result = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
            .input('machine_no', sql.VarChar, machine_no || null)
            .input('process_code', sql.VarChar, process_code || null)
            .input('process', sql.VarChar, process || null)
            .execute('Stored_tb_rfid_tray_after_washing');

        const status = result.recordset[0]?.result ?? 'OK';
        res.json({ result: status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// router.post('/washing', async (req, res) => {
//     try {
//         const { tag_id } = req.body;

//         const pool   = await poolPromise;
//         const result = await pool.request()
//             .input('tag_id',   sql.VarChar, tag_id)
//             .execute('Stored_tb_rfid_tray_after_washing');

//         const status = result.recordset[0]?.result ?? 'OK';
//         res.json({ result: status });

//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });
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
//=========================================================
// หน้า History
//=========================================================
//Query log history
router.get('/history', async (req, res) => {
    try {
        const { date } = req.query;

        const pool = await poolPromise;
        const result = await pool.request()
            .execute('Stored_tb_rfid_log_query_top100_history');

        res.json(result.recordset);

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

//=========================================================
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

// update machine_no + บันทึก log
// UPDATE on_machine ทีละ tray
router.post('/on-machine', async (req, res) => {
    try {
        const { tag_id, machine_no, process_code, process } = req.body;

        const pool = await poolPromise;
        const result = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
            .input('machine_no', sql.VarChar, machine_no || null)
            .input('process_code', sql.VarChar, process_code || null)
            .input('process', sql.VarChar, process || null)
            .execute('Stored_tb_rfid_tray_on_machine');

        const status = result.recordset[0]?.result ?? 'OK';
        res.json({ result: status });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});
// router.post('/on-machine', async (req, res) => {
//     try {
//         const { tag_id, machine_no } = req.body;

//         const pool   = await poolPromise;
//         const result = await pool.request()
//             .input('tag_id',     sql.VarChar, tag_id)
//             .execute('Stored_tb_rfid_tray_on_machine');

//         const status = result.recordset[0]?.result ?? 'OK';
//         res.json({ result: status });

//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });
// UPDATE completed ทีละ tray
// router.post('/completed', async (req, res) => {
//     try {
//         const { tag_id, machine_no, process_code, process } = req.body;

//         const pool   = await poolPromise;
//         const result = await pool.request()
//             .input('tag_id',       sql.VarChar, tag_id)
//             .input('machine_no',   sql.VarChar, machine_no   || null)
//             .input('process_code', sql.VarChar, process_code || null)
//             .input('process',      sql.VarChar, process      || null)
//             .execute('Stored_tb_rfid_tray_completed');

//         const status = result.recordset[0]?.result ?? 'OK';
//         res.json({ result: status });
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });
router.post('/completed', async (req, res) => {
    try {
        const { tag_id } = req.body;

        const pool = await poolPromise;
        const result = await pool.request()
            .input('tag_id', sql.VarChar, tag_id)
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

// Dashboard
router.get('/dashboard', async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('Stored_tb_rfid_dashboard');
        res.json({
            summary: result.recordsets[0][0],
            lots: result.recordsets[1],
        });

    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});


//=========================================================
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

// restart Python reader
router.post('/readers-restart/:port', async (req, res) => {
    try {
        await axios.get(`http://localhost:${req.params.port}/restart`, { timeout: 3000 });
        res.json({ result: 'OK' });
    } catch {
        res.json({ result: 'OK' });
    }
});
//=========================================================
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
//=========================================================
// หน้า As400 Log
//=========================================================


module.exports = router;