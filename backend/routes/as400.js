const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../database');
const axios = require('axios');

// const AS400_MOVEMENT_URL = process.env.AS400_MOVEMENT_URL;
// const AS400_MOVEMENT_TOKEN = process.env.AS400_MOVEMENT_TOKEN;
// const AS400_PRODUCTION_RESULT_URL = process.env.AS400_PRODUCTION_RESULT_URL;
// const AS400_PRODUCTION_RESULT_TOKEN = process.env.AS400_PRODUCTION_RESULT_TOKEN;

// trackId format: process+location_DDMMYYYY_jobtag
const generateTrackId = (process, location, jobtag) => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${process}${location}_${dd}${mm}${yyyy}_${jobtag}`;
};

// insert log → return id
const logToDB = async (pool, eventType, apiType, payload) => {
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
        .execute('Stored_tb_rfid_as400_log_insert');
    return result.recordset[0].id;
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
    // try {
    //     const axiosRes = await axios.post(`${AS400_MOVEMENT_URL}`, [body], {
    //         headers: { Authorization: AS400_MOVEMENT_TOKEN },
    //         timeout: 3000,
    //     });
    //     // 207 = processed with some errors
    //     if (axiosRes.status === 207) {
    //         await updateStatus(pool, logId, 'ERROR', null, JSON.stringify(axiosRes.data));
    //     } else {
    //         await updateStatus(pool, logId, 'SUCCESS', null, JSON.stringify(axiosRes.data));
    //     }
    // } catch (apiErr) {
    //     const isTimeout = apiErr.code === 'ECONNABORTED';
    //     const errMsg = isTimeout ? null : (apiErr.response?.data
    //         ? JSON.stringify(apiErr.response.data)
    //         : apiErr.message);
    //     const resMsg = isTimeout ? 'timeout of 3000ms exceeded' : null;
    //     await updateStatus(pool, logId, isTimeout ? 'SUCCESS' : 'ERROR', errMsg, resMsg);
    // }
    await updateStatus(pool, logId, 'PENDING', null, 'MOCK MODE');
};

// A1 — PALLET IN (MOVE_IN 1201 BFW)
router.post('/pallet-in', async (req, res) => {
    try {
        const { tag_id, barcode, location } = req.body;
        const pool = await poolPromise;
        const payload = {
            track_id: generateTrackId('1201', location, barcode),
            machine_no: '',
            movement_action: 'MOVE_IN',
            jobtag: barcode,
            process: '1201',
            location: `BF${location}`,
            production_qty: null,
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
        console.error('[AS400] pallet-in error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// A2 — PALLET OUT (MOVE_OUT 1201 BFW)
router.post('/pallet-out', async (req, res) => {
    try {
        const { barcode, location } = req.body;
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
            production_qty: null,
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
        console.error('[AS400] pallet-out error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// A3 — WASHING RUN (MOVE_IN 1201 RUN)
router.post('/washing', async (req, res) => {
    try {
        const { barcode, location, machine_no } = req.body;
        const pool = await poolPromise;
        const payload = {
            track_id: generateTrackId('1201', 'RUN', barcode),
            machine_no: machine_no || '',
            movement_action: 'MOVE_IN',
            jobtag: barcode,
            process: '1201',
            location: 'RUN',
            production_qty: null,
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
        console.error('[AS400] washing error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// A4 — WASHING RESULT (production-result 1201)
router.post('/on-machine-result', async (req, res) => {
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
        // try {
        //     const axiosRes = await axios.post(`${AS400_PRODUCTION_RESULT_URL}`, [{
        //         trackId: payload.track_id,
        //         jobtagIn: payload.jobtag,
        //         machineNo: payload.machine_no,
        //         processCode: payload.process,
        //         productionQty: payload.production_qty,
        //         ngQty: 0,
        //         timestamp: new Date().toISOString(),
        //     }], {
        //         headers: { Authorization: AS400_PRODUCTION_RESULT_TOKEN },
        //         timeout: 3000,
        //     });
        //     console.log('[on-machine-result] payload:', payload);
        //     if (axiosRes.status === 207) {
        //         await updateStatus(pool, logId, 'ERROR', null, JSON.stringify(axiosRes.data));
        //     } else {
        //         await updateStatus(pool, logId, 'SUCCESS', null, JSON.stringify(axiosRes.data));
        //     }
        // } catch (apiErr) {
        //     const isTimeout = apiErr.code === 'ECONNABORTED';
        //     const errMsg = isTimeout ? null : (apiErr.response?.data
        //         ? JSON.stringify(apiErr.response.data)
        //         : apiErr.message);
        //     const resMsg = isTimeout ? 'timeout of 3000ms exceeded' : null;
        //     await updateStatus(pool, logId, isTimeout ? 'SUCCESS' : 'ERROR', errMsg, resMsg);
        // }
        await updateStatus(pool, logId, 'PENDING', null, 'MOCK MODE');
        res.json({ result: 'OK' });
    } catch (err) {
        console.error('[AS400] on-machine-result error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// A5 — ON MACHINE IN (MOVE_IN 1520 BF) ทีละ tag
router.post('/on-machine-in', async (req, res) => {
    try {
        const { barcode, machine_no, production_qty } = req.body;
        const pool = await poolPromise;
        const payload = {
            track_id: generateTrackId('1520', 'BF', barcode),
            machine_no: machine_no || '',
            movement_action: 'MOVE_IN',
            jobtag: barcode,
            process: '1520',
            location: 'BF',
            production_qty: production_qty,
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
        console.error('[AS400] on-machine-in error:', err.message);
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
        console.error('[AS400] on-machine-out error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;