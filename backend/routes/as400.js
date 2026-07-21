const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../database');
const axios = require('axios');

const AS400_MOVEMENT_URL = process.env.AS400_MOVEMENT_URL;
const AS400_MOVEMENT_TOKEN = process.env.AS400_MOVEMENT_TOKEN;
const AS400_PRODUCTION_RESULT_URL = process.env.AS400_PRODUCTION_RESULT_URL;
const AS400_PRODUCTION_RESULT_TOKEN = process.env.AS400_PRODUCTION_RESULT_TOKEN;

// สร้าง trackId format: process+location_DDMMYYYY_jobtag
const generateTrackId = (process, location, jobtag) => {
    const now = new Date();
    const dd = String(now.getDate()).padStart(2, '0');
    const mm = String(now.getMonth() + 1).padStart(2, '0');
    const yyyy = now.getFullYear();
    return `${process}${location}_${dd}${mm}${yyyy}_${jobtag}`;
};

// insert log return id
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
    return result.recordset[0].id;  // return id กลับมาใช้ update status
};

// update status หลังส่ง API
const updateStatus = async (pool, id, status, errorMsg = null) => {
    await pool.request()
        .input('id', sql.Int, id)
        .input('status', sql.VarChar, status)
        .input('error_msg', sql.VarChar, errorMsg)
        .execute('Stored_tb_rfid_as400_log_update_status');
};

// A1 PALLET IN (MOVE_IN)
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

        // ส่ง API ไป AS400
        try {
            await axios.post(`${AS400_MOVEMENT_URL}`, [{
                trackId: payload.track_id,
                machineNo: payload.machine_no,
                movementAction: payload.movement_action,
                jobtag: payload.jobtag,
                process: payload.process,
                location: payload.location,
                timestamp: new Date().toISOString(),
            }], {
                headers: { Authorization: AS400_MOVEMENT_TOKEN },
                timeout: 3000,
            });
            await updateStatus(pool, logId, 'SUCCESS');
        } catch (apiErr) {
            const isTimeout = apiErr.code === 'ECONNABORTED';
            await updateStatus(pool, logId,
                isTimeout ? 'SUCCESS' : 'ERROR',
                apiErr.message
            );
        }

        res.json({ result: 'OK' });
    } catch (err) {
        console.error('[AS400] pallet-in error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// A2 PALLET OUT (MOVE_OUT)
router.post('/pallet-out', async (req, res) => {
    try {
        const { barcode, location } = req.body;
        const pool = await poolPromise;

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

        try {
            await axios.post(`${AS400_MOVEMENT_URL}`, [{
                trackId: payload.track_id,
                machineNo: payload.machine_no,
                movementAction: payload.movement_action,
                jobtag: payload.jobtag,
                process: payload.process,
                location: payload.location,
                timestamp: new Date().toISOString(),
            }], {
                headers: { Authorization: AS400_MOVEMENT_TOKEN },
                timeout: 3000,
            });
            await updateStatus(pool, logId, 'SUCCESS');
        } catch (apiErr) {
            const isTimeout = apiErr.code === 'ECONNABORTED';
            await updateStatus(pool, logId,
                isTimeout ? 'SUCCESS' : 'ERROR',
                apiErr.message
            );
        }

        res.json({ result: 'OK' });
    } catch (err) {
        console.error('[AS400] pallet-out error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// A3 WASHING RUN (MOVE_IN)
router.post('/washing', async (req, res) => {
    try {
        const { tag_id, barcode, location, machine_no } = req.body;
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
        //console.log('[washing] payload:', payload);
        const logId = await logToDB(pool, 'WASHING_RUN', 'movement', payload);

        try {
            await axios.post(`${AS400_MOVEMENT_URL}`, [{
                trackId: payload.track_id,
                machineNo: payload.machine_no,
                movementAction: payload.movement_action,
                jobtag: payload.jobtag,
                process: payload.process,
                location: payload.location,
                timestamp: new Date().toISOString(),
            }], {
                headers: { Authorization: AS400_MOVEMENT_TOKEN },
                timeout: 3000,
            });
            await updateStatus(pool, logId, 'SUCCESS');
        } catch (apiErr) {
            const isTimeout = apiErr.code === 'ECONNABORTED';
            await updateStatus(pool, logId,
                isTimeout ? 'SUCCESS' : 'ERROR',
                apiErr.message
            );
        }

        res.json({ result: 'OK' });
    } catch (err) {
        console.error('[AS400] washing error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// A4 WASHING RESULT (production-result)
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
        console.log('[on-machine-result] machine_no:', payload.machine_no);
        const logId = await logToDB(pool, 'WASHING_RESULT', 'production-result', payload);

        try {
            await axios.post(`${AS400_PRODUCTION_RESULT_URL}`, [{
                trackId: payload.track_id,
                jobtagIn: payload.jobtag,
                machineNo: payload.machine_no,
                processCode: payload.process,
                productionQty: payload.production_qty,
                ngQty: 0,
                timestamp: new Date().toISOString(),
            }], {
                headers: { Authorization: AS400_PRODUCTION_RESULT_TOKEN },
                timeout: 3000,
            });
            await updateStatus(pool, logId, 'SUCCESS');
        } catch (apiErr) {
            const isTimeout = apiErr.code === 'ECONNABORTED';
            await updateStatus(pool, logId,
                isTimeout ? 'SUCCESS' : 'ERROR',
                apiErr.message
            );
        }

        res.json({ result: 'OK' });
    } catch (err) {
        console.error('[AS400] washing-result error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

// A5 MBR OUT (MOVE_OUT)
router.post('/mbr-out', async (req, res) => {
    try {
        const { barcode, machine_no } = req.body;
        const pool = await poolPromise;

        const payload = {
            track_id: generateTrackId('1520', 'BF', barcode),
            machine_no: machine_no || '',
            movement_action: 'MOVE_OUT',
            jobtag: barcode,
            process: '1520',
            location: 'BF',
            production_qty: null,
        };
        console.log('[mbr-out] machine_no:', payload.machine_no);
        const logId = await logToDB(pool, 'MBR_OUT', 'movement', payload);

        try {
            await axios.post(`${AS400_MOVEMENT_URL}`, [{
                trackId: payload.track_id,
                machineNo: payload.machine_no,
                movementAction: payload.movement_action,
                jobtag: payload.jobtag,
                process: payload.process,
                location: payload.location,
                timestamp: new Date().toISOString(),
            }], {
                headers: { Authorization: AS400_MOVEMENT_TOKEN },
                timeout: 3000,
            });
            await updateStatus(pool, logId, 'SUCCESS');
        } catch (apiErr) {
            const isTimeout = apiErr.code === 'ECONNABORTED';
            await updateStatus(pool, logId,
                isTimeout ? 'SUCCESS' : 'ERROR',
                apiErr.message
            );
        }

        res.json({ result: 'OK' });
    } catch (err) {
        console.error('[AS400] mbr-out error:', err.message);
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;

// const express = require('express');
// const router = express.Router();
// const { sql, poolPromise } = require('../database');
// // const axios = require('axios');

// // const AS400_URL   = process.env.AS400_URL;
// // const AS400_TOKEN = process.env.AS400_TOKEN;

// // Process Code Mapping
// const PROCESS = {
//     pallet_in: {
//         from_process: '1070',
//         from_location: 'AF',
//         to_process: '1201',
//         to_location: 'BF',
//     },
// };

// // สร้าง trackId
// // format: YYYYMMDD_location_barcode
// const generateTrackId = (location, barcode) => {
//     const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
//     return `${date}_${location}_${barcode}`;
// };

// // บันทึก log ลง DB ผ่าน SP
// const logToDB = async (pool, eventType, apiType, payload) => {
//     try {
//         await pool.request()
//             .input('event_type', sql.VarChar, eventType)
//             .input('api_type', sql.VarChar, apiType)
//             .input('track_id', sql.VarChar, payload.track_id || null)
//             .input('jobtag', sql.VarChar, payload.jobtag || null)
//             .input('machine_no', sql.VarChar, payload.machine_no || null)
//             .input('process_code', sql.VarChar, payload.process_code || null)
//             .input('moves_from_process', sql.VarChar, payload.moves_from_process || null)
//             .input('moves_from_location', sql.VarChar, payload.moves_from_location || null)
//             .input('moves_to_process', sql.VarChar, payload.moves_to_process || null)
//             .input('moves_to_location', sql.VarChar, payload.moves_to_location || null)
//             .input('production_qty', sql.Int, payload.production_qty || null)
//             .input('ng_qty', sql.Int, payload.ng_qty || 0)
//             .input('tag_id', sql.VarChar, payload.tag_id || null)
//             .input('barcode', sql.VarChar, payload.barcode || null)
//             .execute('Stored_tb_rfid_as400_log_insert');
//         //console.log(`[AS400] [${eventType}] logged: ${payload.jobtag}`);
//     } catch (err) {
//         console.error(`[AS400] logToDB error: ${err.message}`);
//     }
// };

// // PALLET IN
// // API: movement
// router.post('/pallet-in', async (req, res) => {
//     try {
//         const { tag_id, barcode, location, lot_data } = req.body;
//         const p = PROCESS.pallet_in;
//         const payload = {
//             tag_id,
//             barcode,
//             jobtag: barcode,
//             track_id: generateTrackId(location, barcode),
//             machine_no: null,
//             process_code: null,
//             moves_from_process: null,
//             moves_from_location: null,
//             moves_to_process: p.to_process,
//             moves_to_location: `${p.to_location}${location}`,
//             production_qty: null,
//             ng_qty: 0,
//         };
//         const pool = await poolPromise;
//         await logToDB(pool, 'PALLET_IN', 'movement', payload);

//         // เมื่อ IT พร้อม
//         // await axios.post(`${AS400_URL}/movement_wip`, [{
//         //     trackId:           payload.track_id,
//         //     machineNo:         payload.machine_no,
//         //     jobtag:            payload.jobtag,
//         //     movesFromProcess:  payload.moves_from_process,
//         //     movesFromLocation: payload.moves_from_location,
//         //     movesToProcess:    payload.moves_to_process,
//         //     movesToLocation:   payload.moves_to_location,
//         //     timestamp:         new Date().toISOString(),
//         // }], { headers: { Authorization: AS400_TOKEN } });

//         res.json({ result: 'OK' });
//     } catch (err) {
//         console.error('[AS400] pallet-in error:', err.message);
//         res.status(500).json({ error: err.message });
//     }
// });

// // GET /api/as400/logs — ดึง log ทั้งหมด
// router.get('/logs', async (req, res) => {
//     try {
//         const pool = await poolPromise;
//         const result = await pool.request()
//             .query(`
//                 SELECT [id]
//       ,[track_id]
//       ,[machine_no]
//       ,[jobtag]
//       ,[process_code]
//       ,[moves_from_process]
//       ,[moves_from_location]
//       ,[moves_to_process]
//       ,[moves_to_location]
//       ,[created_at]
//   FROM [db_nht_washing_rfid_1].[dbo].[tb_rfid_as400_log]
//             `);
//         res.json(result.recordset);
//     } catch (err) {
//         res.status(500).json({ error: err.message });
//     }
// });

// module.exports = router;

// const express              = require('express');
// const router               = express.Router();
// const { sql, poolPromise } = require('../database');

// // บันทึก log ลง DB ผ่าน SP
// const logToDB = async (pool, eventType, apiType, payload) => {
//     try {
//         await pool.request()
//             .input('event_type',          sql.VarChar, eventType)
//             .input('api_type',            sql.VarChar, apiType)
//             .input('jobtag',              sql.VarChar, payload.jobtag              || null)
//             .input('movement_action',     sql.VarChar, payload.movement_action     || null)
//             .input('process_code',        sql.VarChar, payload.process_code        || null)
//             .input('moves_from_location', sql.VarChar, payload.moves_from_location || null)
//             .input('moves_to_location',   sql.VarChar, payload.moves_to_location   || null)
//             .input('production_qty',      sql.Int,     payload.production_qty      || null)
//             .input('tag_id',              sql.VarChar, payload.tag_id              || null)
//             .input('barcode',             sql.VarChar, payload.barcode             || null)
//             .execute('Stored_tb_rfid_as400_log_insert');
//         //console.log(`[AS400] [${eventType}] logged: ${payload.jobtag}`);
//     } catch (err) {
//         console.error(`[AS400] logToDB error: ${err.message}`);
//     }
// };

// // A1 — PALLET IN
// router.post('/pallet-in', async (req, res) => {
//     try {
//         const { tag_id, barcode, location, lot_data } = req.body;
//         const pool = await poolPromise;

//         // ดึง log ล่าสุดของ barcode นี้ เพื่อรู้ moves_from
//         const logResult = await pool.request()
//             .input('barcode', sql.VarChar, barcode)
//             .query(`
//                 SELECT TOP 1 process_code, moves_to_location
//                 FROM tb_rfid_as400_log
//                 WHERE barcode = @barcode
//                 ORDER BY timestamp DESC
//             `);
//         const lastLog = logResult.recordset[0];

//         const payload = {
//             tag_id,
//             barcode,
//             jobtag:               barcode,
//             movement_action:      'move_in',
//             process_code:         '1201',
//             moves_from_location:  lastLog?.moves_to_location || 'AF',
//             moves_to_location:    `BF${location}`,
//             production_qty:       null,
//         };

//         await logToDB(pool, 'PALLET_IN', 'movement', payload);
//         res.json({ result: 'OK' });
//     } catch (err) {
//         console.error('[AS400] pallet-in error:', err.message);
//         res.status(500).json({ error: err.message });
//     }
// });

// // A2 — PALLET OUT
// router.post('/pallet-out', async (req, res) => {
//     try {
//         const { barcode, location } = req.body;
//         const pool    = await poolPromise;
//         const payload = {
//             tag_id:               null,
//             barcode,
//             jobtag:               barcode,
//             movement_action:      'move_out',
//             process_code:         '1201',
//             moves_from_location:  `BF${location}`,
//             moves_to_location:    null,
//             production_qty:       null,
//         };

//         await logToDB(pool, 'PALLET_OUT', 'movement', payload);
//         res.json({ result: 'OK' });
//     } catch (err) {
//         console.error('[AS400] pallet-out error:', err.message);
//         res.status(500).json({ error: err.message });
//     }
// });

// // A3 — WASHING RUN
// router.post('/washing', async (req, res) => {
//     try {
//         const { tag_id, barcode, location, lot_data } = req.body;
//         const pool = await poolPromise;

//         // A3 — move_in RUN
//         const payload_run = {
//             tag_id,
//             barcode,
//             jobtag:               barcode,
//             movement_action:      'move_in',
//             process_code:         '1201',
//             moves_from_location:  `BF${location}`,
//             moves_to_location:    'RUN',
//             production_qty:       null,
//         };
//         await logToDB(pool, 'WASHING_RUN', 'movement', payload_run);

//         res.json({ result: 'OK' });
//     } catch (err) {
//         console.error('[AS400] washing error:', err.message);
//         res.status(500).json({ error: err.message });
//     }
// });

// module.exports = router;