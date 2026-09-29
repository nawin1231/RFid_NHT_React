const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../database');
const axios = require('axios');
const fs = require('fs');
const path = require('path');

const AS400_MOVEMENT_URL = process.env.AS400_MOVEMENT_URL;
const AS400_PRODUCTION_RESULT_URL = process.env.AS400_PRODUCTION_RESULT_URL;
const API_CHECKING_URL = process.env.API_CHECKING_URL;
const API_TOKEN = process.env.API_TOKEN;
const AS400_TIMEOUT_MS = 8000;

// trackId format: process+location_DDMMYYYY_jobtag
const generateTrackId = (process, location, jobtag) => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${process}${location}_${dd}${mm}${yyyy}_${jobtag}`;
};

// insert log → return id
// const logToDB = async (pool, eventType, apiType, payload) => {
// เปลี่ยนชื่อเป็น logToDBOnce — ไส้ในเหมือนเดิมทุกบรรทัด · ทุก route เรียก logToDB ตัวใหม่ด้านล่าง
const logToDBOnce = async (pool, eventType, apiType, payload) => {
    const result = await pool.request()
        .input('track_id', sql.VarChar, payload.track_id)
        .input('api_type', sql.VarChar, apiType)
        .input('event_type', sql.VarChar, eventType)
        .input('machine_no', sql.VarChar, payload.machine_no || null)
        .input('movement_action', sql.VarChar, payload.movement_action || null)
        .input('jobtag', sql.VarChar, payload.jobtag || null)
        .input('process', sql.VarChar, payload.process || null)
        .input('location', sql.VarChar, payload.location || null)
        .input('production_qty', sql.Int, payload.production_qty || null)
        .input('tag_id', sql.VarChar, payload.tag_id || null)
        .execute('Stored_tb_rfid_as400_log_insert');
    return result.recordset[0].id;
};

// ตาข่ายของ logToDB
// เดิม: insert log พลาดครั้งเดียว (pool เต็ม / DB สะดุด) → route โยน 500 → ไม่ส่ง AS400 + ไม่มีแถวใน log
//       → retryErrors มองไม่เห็น → event หายเงียบ ไม่มีร่องรอยใน DB
// ตอนนี้: ลองใหม่ก่อน · ยังไม่ได้ → จดลงไฟล์สำรองไว้เป็นหลักฐาน แล้ว throw ต่อเหมือนเดิม
//    "ไม่ส่ง AS400" เมื่อไม่มีแถว log เพราะตัวกันส่งซ้ำ
//    (last_on_machine_event, check_last_event) อ่านจากตาราง log — ส่งไปโดยไม่มีแถว = อาจส่งซ้ำทีหลัง
//    ข้อมูลในไฟล์ยังไม่เคยถึง AS400 จึงเอาไปส่งซ้ำเองได้ปลอดภัย
const LOG_RETRY_DELAYS_MS = [500, 1500]; 
const FAILED_LOG_FILE = path.join(__dirname, '../logs/as400_failed.jsonl');

const logToDB = async (pool, eventType, apiType, payload) => {
    let lastErr;
    for (let attempt = 0; attempt <= LOG_RETRY_DELAYS_MS.length; attempt++) {
        if (attempt > 0) await new Promise(r => setTimeout(r, LOG_RETRY_DELAYS_MS[attempt - 1]));
        try {
            return await logToDBOnce(pool, eventType, apiType, payload);
        } catch (err) {
            lastErr = err;
            console.error(`[logToDB] ${eventType} ${payload.jobtag || ''} ครั้งที่ ${attempt + 1} พลาด: ${err.message}`);
        }
    }

    // ลองครบแล้วยังไม่ได้ → จดลงไฟล์ 1 บรรทัด = 1 event (JSON Lines)
    const line = JSON.stringify({
        failed_at: new Date().toISOString(),
        event_type: eventType,
        api_type: apiType,
        payload,
        error: lastErr?.message,
    }) + '\n';
    try {
        fs.mkdirSync(path.dirname(FAILED_LOG_FILE), { recursive: true });
        fs.appendFileSync(FAILED_LOG_FILE, line, 'utf-8');
        console.error(`[logToDB] ${eventType} ${payload.jobtag || ''} → ไม่ได้ส่ง AS400 · จดไว้ที่ ${FAILED_LOG_FILE}`);
    } catch (fileErr) {
        // เขียนไฟล์ก็ไม่ได้ → อย่างน้อยให้ข้อมูลเต็มอยู่ใน console
        console.error(`[logToDB] เขียนไฟล์สำรองไม่ได้ (${fileErr.message}) · ข้อมูลที่หาย: ${line}`);
    }
    throw lastErr;
};

// update status + เก็บ response หลังส่ง API
const updateStatus = async (pool, id, status, errorMsg = null, responseMsg = null) => {
    await pool.request()
        .input('id', sql.Int, id)
        .input('status', sql.VarChar, status)
        .input('error_msg', sql.VarChar, errorMsg)
        .input('response_msg', sql.VarChar, responseMsg)
        .execute('Stored_tb_rfid_as400_log_update_status');
};

// ส่ง movement API + update status
const sendMovement = async (pool, logId, body) => {
    try {
        const axiosRes = await axios.post(`${AS400_MOVEMENT_URL}`, [body], {
            headers: { Authorization: API_TOKEN },
            timeout: AS400_TIMEOUT_MS,
        });
        // 207 = processed with some errors
        if (axiosRes.status === 207) {
            await updateStatus(pool, logId, 'ERROR', null, JSON.stringify(axiosRes.data));
        } else {
            await updateStatus(pool, logId, 'SUCCESS', null, JSON.stringify(axiosRes.data));
        }
    } catch (apiErr) {
        const isTimeout = apiErr.code === 'ECONNABORTED';
        const errMsg = isTimeout ? null : (apiErr.response?.data
            ? JSON.stringify(apiErr.response.data)
            : apiErr.message);
        const resMsg = isTimeout ? `timeout of ${AS400_TIMEOUT_MS}ms exceeded` : null;
        await updateStatus(pool, logId, isTimeout ? 'SUCCESS' : 'ERROR', errMsg, resMsg);
    }
    // await updateStatus(pool, logId, 'PENDING', null, 'MOCK MODE');
};

// A1 — PALLET IN (MOVE_IN 1201 BFW)
router.post('/pallet-in', async (req, res) => {
    try {
        const { tag_id, barcode, location ,lot_data  } = req.body;
        const pool = await poolPromise;
        const payload = {
            track_id: generateTrackId('1201', location, barcode),
            machine_no: '',
            movement_action: 'MOVE_IN',
            jobtag: barcode,
            process: '1201',
            location: `BF${location}`,
            production_qty: lot_data?.quantity ?? null,
        };
        const logId = await logToDB(pool, 'PALLET_IN', 'movement', payload);
        await sendMovement(pool, logId, {
            trackId: payload.track_id,
            machineNo: payload.machine_no,
            movementAction: payload.movement_action,
            jobtag: payload.jobtag,
            process: payload.process,
            location: payload.location,
            timestamp: new Date().toISOString(),
        });
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// A2 — PALLET OUT (MOVE_OUT 1201 BFW)
router.post('/pallet-out', async (req, res) => {
    try {
        const { barcode, location, lot_data  } = req.body;
        const pool = await poolPromise;
        const checkResult = await pool.request()
            .input('jobtag', sql.VarChar, barcode)
            .execute('Stored_tb_rfid_as400_log_check_last_event');
        if (checkResult.recordset[0]?.event_type === 'PALLET_OUT') {
            return res.json({ result: 'ALREADY_OUT' });
        }
        const payload = {
            track_id: generateTrackId('1201', location, barcode),
            machine_no: '',
            movement_action: 'MOVE_OUT',
            jobtag: barcode,
            process: '1201',
            location: `BF${location}`,
            production_qty: lot_data?.quantity ?? null,
        };
        const logId = await logToDB(pool, 'PALLET_OUT', 'movement', payload);
        await sendMovement(pool, logId, {
            trackId: payload.track_id,
            machineNo: payload.machine_no,
            movementAction: payload.movement_action,
            jobtag: payload.jobtag,
            process: payload.process,
            location: payload.location,
            timestamp: new Date().toISOString(),
        });
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// A3 — WASHING RUN (MOVE_IN 1201 RUN)
router.post('/washing', async (req, res) => {
    try {
        const { barcode, location, machine_no, process_code,lot_data } = req.body;
        const pool = await poolPromise;
        const payload = {
            track_id: generateTrackId(process_code || '1201', 'RUN', barcode),
            machine_no: machine_no || '',
            movement_action: 'MOVE_IN',
            jobtag: barcode,
            process: process_code || '1201',
            location: 'RUN',
            production_qty: lot_data?.quantity ?? null,
        };
        const logId = await logToDB(pool, 'WASHING_RUN', 'movement', payload);
        await sendMovement(pool, logId, {
            trackId: payload.track_id,
            machineNo: payload.machine_no,
            movementAction: payload.movement_action,
            jobtag: payload.jobtag,
            process: payload.process,
            location: payload.location,
            timestamp: new Date().toISOString(),
        });
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// A4 — WASHING RESULT (production-result 1201)
router.post('/washing-result', async (req, res) => {
    try {
        const { barcode, machine_no, production_qty } = req.body;
        const pool = await poolPromise;
        const payload = {
            track_id: generateTrackId('1201', 'RUN', barcode),
            machine_no: machine_no || '',
            movement_action: null,
            jobtag: barcode,
            process: '1201',
            location: 'RUN',
            production_qty: production_qty,
        };
        const logId = await logToDB(pool, 'WASHING_RESULT', 'production-result', payload);
        try {
            const axiosRes = await axios.post(`${AS400_PRODUCTION_RESULT_URL}`, [{
                trackId: payload.track_id,
                jobtagIn: payload.jobtag,
                machineNo: payload.machine_no,
                processCode: payload.process,
                productionQty: payload.production_qty,
                ngQty: 0,
                timestamp: new Date().toISOString(),
            }], {
                headers: { Authorization: API_TOKEN },
                timeout: AS400_TIMEOUT_MS,
            });
            if (axiosRes.status === 207) {
                await updateStatus(pool, logId, 'ERROR', null, JSON.stringify(axiosRes.data));
            } else {
                await updateStatus(pool, logId, 'SUCCESS', null, JSON.stringify(axiosRes.data));
            }
        } catch (apiErr) {
            const isTimeout = apiErr.code === 'ECONNABORTED';
            const errMsg = isTimeout ? null : (apiErr.response?.data
                ? JSON.stringify(apiErr.response.data)
                : apiErr.message);
            const resMsg = isTimeout ? `timeout of ${AS400_TIMEOUT_MS}ms exceeded` : null;
            await updateStatus(pool, logId, isTimeout ? 'SUCCESS' : 'ERROR', errMsg, resMsg);
        }
        // await updateStatus(pool, logId, 'PENDING', null, 'MOCK MODE');
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// A5 — ON MACHINE IN (MOVE_IN 1520 BF) ทีละ tag
router.post('/on-machine-in', async (req, res) => {
    try {
        const { tag_id, barcode, machine_no, production_qty, process_code } = req.body;
        const pool = await poolPromise;
        const payload = {
            track_id: generateTrackId(process_code || '1520', 'BF', barcode),
            machine_no: machine_no || '',
            movement_action: 'MOVE_IN',
            jobtag: barcode,
            process: process_code || '1520',
            location: 'BF',
            production_qty: production_qty,
            tag_id: tag_id || null,
        };
        const logId = await logToDB(pool, 'ON_MACHINE_IN', 'movement', payload);
        await sendMovement(pool, logId, {
            trackId: payload.track_id,
            machineNo: payload.machine_no,
            movementAction: payload.movement_action,
            jobtag: payload.jobtag,
            process: payload.process,
            location: payload.location,
            qty: payload.production_qty,
            timestamp: new Date().toISOString(),
        });
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// A6 — CHECKING
router.post('/checking', async (req, res) => {
    try {
        const { barcode, machine_no, wos_barcode, jobtag, check_result, material_type } = req.body;
        const pool = await poolPromise;
        const payload = {
            wosBarcode: wos_barcode,
            machine: machine_no,
            checkBy: 'RFID',
            jobtagList: [{
                jobtag: jobtag,
                checkResult: check_result,
                materialType: material_type,
            }]
        };
        const logId = await logToDB(pool, 'CHECKING', 'checking', {
            track_id: generateTrackId('1520', 'BF', jobtag),
            machine_no,
            jobtag,
            process: '1520',
            location: 'BF',
        });
        try {
            const axiosRes = await axios.post(`${API_CHECKING_URL}`, payload, {
                headers: { Authorization: API_TOKEN },
                timeout: AS400_TIMEOUT_MS,
            });
            if (axiosRes.status === 207) {
                await updateStatus(pool, logId, 'ERROR', null, JSON.stringify(axiosRes.data));
            } else {
                await updateStatus(pool, logId, 'SUCCESS', null, JSON.stringify(axiosRes.data));
            }
        } catch (apiErr) {
            const isTimeout = apiErr.code === 'ECONNABORTED';
            const errMsg = isTimeout ? null : (apiErr.response?.data
                ? JSON.stringify(apiErr.response.data)
                : apiErr.message);
            const resMsg = isTimeout ? `timeout of ${AS400_TIMEOUT_MS}ms exceeded` : null;
            await updateStatus(pool, logId, isTimeout ? 'SUCCESS' : 'ERROR', errMsg, resMsg);
        }
        // await updateStatus(pool, logId, 'PENDING', null, 'MOCK MODE');
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// A7 — ON MACHINE OUT (MOVE_OUT 1520 BF) ทีละ tag
router.post('/on-machine-out', async (req, res) => {
    try {
        const { tag_id, barcode, qty, machine_no } = req.body;
        const pool = await poolPromise;
        const payload = {
            track_id: generateTrackId('1520', 'BF', barcode),
            machine_no: machine_no || '',
            movement_action: 'MOVE_OUT',
            jobtag: barcode,
            process: '1520',
            location: 'BF',
            production_qty: qty,
            tag_id: tag_id || null,
        };
        const logId = await logToDB(pool, 'ON_MACHINE_OUT', 'movement', payload);
        await sendMovement(pool, logId, {
            trackId: payload.track_id,
            machineNo: payload.machine_no,
            movementAction: payload.movement_action,
            jobtag: payload.jobtag,
            process: payload.process,
            location: payload.location,
            qty: payload.production_qty,
            timestamp: new Date().toISOString(),
        });
        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Auto retry — ดึง ERROR records แล้วส่งใหม่
const retryErrorsOnce = async () => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .execute('Stored_tb_rfid_as400_log_get_errors');

        for (const row of result.recordset) {

            if (row.api_type === 'movement') {
                await sendMovement(pool, row.id, {
                    trackId: row.track_id,
                    machineNo: row.machine_no || '',
                    movementAction: row.movement_action,
                    jobtag: row.jobtag,
                    process: row.process,
                    location: row.location,
                    qty: row.production_qty,
                    timestamp: new Date().toISOString(),
                });
            } else if (row.api_type === 'production-result') {
                try {
                    const axiosRes = await axios.post(`${AS400_PRODUCTION_RESULT_URL}`, [{
                        trackId: row.track_id,
                        jobtagIn: row.jobtag,
                        machineNo: row.machine_no || '',
                        processCode: row.process,
                        productionQty: row.production_qty,
                        ngQty: 0,
                        timestamp: new Date().toISOString(),
                    }], { headers: { Authorization: API_TOKEN }, timeout: AS400_TIMEOUT_MS });
                    await updateStatus(pool, row.id,
                        axiosRes.status === 207 ? 'ERROR' : 'SUCCESS',
                        null, JSON.stringify(axiosRes.data));
                } catch (apiErr) {
                    const isTimeout = apiErr.code === 'ECONNABORTED';
                    await updateStatus(pool, row.id,
                        isTimeout ? 'SUCCESS' : 'ERROR',
                        isTimeout ? null : JSON.stringify(apiErr.response?.data || apiErr.message),
                        isTimeout ? `timeout of ${AS400_TIMEOUT_MS}ms exceeded` : null);
                }
            }
        }
    } catch (err) {
    }
};

// กันรอบทับ — 1 รอบส่งได้ถึง 100 แถว × 8 วิ (AS400_TIMEOUT_MS) = 800 วิ
// แต่ server.js เรียกทุก 300 วิ → ถ้า AS400 ช้า รอบใหม่เริ่มก่อนรอบเก่าจบ
// → ดึงแถว ERROR ชุดเดิมมาส่งซ้อน = ส่งซ้ำไป AS400
let retryRunning = false;
const retryErrors = async () => {
    if (retryRunning) {
        console.warn(`[retryErrors] ${new Date().toLocaleTimeString()} รอบก่อนยังไม่เสร็จ → ข้ามรอบนี้`);
        return;
    }
    retryRunning = true;
    try {
        await retryErrorsOnce();
    } finally {
        retryRunning = false;   // ต้องปล่อยเสมอ ไม่งั้น error ครั้งเดียว retry หยุดถาวร
    }
};

module.exports = { router, retryErrors };