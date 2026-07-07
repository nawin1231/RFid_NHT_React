const express            = require('express');
const router             = express.Router();
const { sql, poolPromise } = require('../database');
// const axios = require('axios');

// const AS400_URL   = process.env.AS400_URL;
// const AS400_TOKEN = process.env.AS400_TOKEN;

const PROCESS = {
    pallet_in: {
        from_process:  '1070',
        from_location: 'AF',
        to_process:    '1201',
        to_location:   'BF',
    },
    pallet_out: {
        from_process:  '1201',
        from_location: 'BF',
    },
    washing_run: {
        from_process:  '1201',
        from_location: 'BF',
        to_process:    '1201',
        to_location:   'RUN',
    },
    washing_af: {
        from_process:  '1201',
        from_location: 'RUN',
        to_process:    '1201',
        to_location:   'AF',
    },
};

const generateTrackId = (location, barcode) => {
    const date = new Date().toISOString().slice(0, 10).replace(/-/g, '');
    return `${date}_${location}_${barcode}`;
};

const logToDB = async (pool, eventType, apiType, payload) => {
    try {
        await pool.request()
            .input('event_type',           sql.VarChar, eventType)
            .input('api_type',             sql.VarChar, apiType)
            .input('track_id',             sql.VarChar, payload.track_id             || null)
            .input('jobtag',               sql.VarChar, payload.jobtag               || null)
            .input('machine_no',           sql.VarChar, payload.machine_no           || null)
            .input('process_code',         sql.VarChar, payload.process_code         || null)
            .input('moves_from_process',   sql.VarChar, payload.moves_from_process   || null)
            .input('moves_from_location',  sql.VarChar, payload.moves_from_location  || null)
            .input('moves_to_process',     sql.VarChar, payload.moves_to_process     || null)
            .input('moves_to_location',    sql.VarChar, payload.moves_to_location    || null)
            .input('production_qty',       sql.Int,     payload.production_qty       || null)
            .input('ng_qty',               sql.Int,     payload.ng_qty               || 0)
            .input('tag_id',               sql.VarChar, payload.tag_id               || null)
            .input('barcode',              sql.VarChar, payload.barcode              || null)
            .execute('Stored_tb_rfid_as400_log_insert');
        console.log(`[AS400] [${eventType}] logged: ${payload.jobtag}`);
    } catch (err) {
        console.error(`[AS400] logToDB error: ${err.message}`);
    }
};

// PALLET IN
router.post('/pallet-in', async (req, res) => {
    try {
        const { tag_id, barcode, location, lot_data } = req.body;
        const p       = PROCESS.pallet_in;
        const payload = {
            tag_id,
            barcode,
            jobtag:               barcode,
            track_id:             generateTrackId(location, barcode),
            machine_no:           null,
            process_code:         lot_data?.process_code || null,
            moves_from_process:   p.from_process,
            moves_from_location:  p.from_location,
            moves_to_process:     p.to_process,
            moves_to_location:    `${p.to_location}${location}`,
            production_qty:       null,
            ng_qty:               0,
        };
        const pool = await poolPromise;
        await logToDB(pool, 'PALLET_IN', 'movement_wip', payload);

        // await axios.post(`${AS400_URL}/movement_wip`, [{
        //     trackId:           payload.track_id,
        //     machineNo:         payload.machine_no,
        //     jobtag:            payload.jobtag,
        //     movesFromProcess:  payload.moves_from_process,
        //     movesFromLocation: payload.moves_from_location,
        //     movesToProcess:    payload.moves_to_process,
        //     movesToLocation:   payload.moves_to_location,
        //     timestamp:         new Date().toISOString(),
        // }], { headers: { Authorization: AS400_TOKEN } });

        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// PALLET OUT
router.post('/pallet-out', async (req, res) => {
    try {
        const { barcode, location } = req.body;
        const p       = PROCESS.pallet_out;
        const payload = {
            tag_id:               null,
            barcode,
            jobtag:               barcode,
            track_id:             generateTrackId(location, barcode),
            machine_no:           null,
            process_code:         null,
            moves_from_process:   p.from_process,
            moves_from_location:  `${p.from_location}${location}`,
            moves_to_process:     null,
            moves_to_location:    null,
            production_qty:       null,
            ng_qty:               0,
        };
        const pool = await poolPromise;
        await logToDB(pool, 'PALLET_OUT', 'issue', payload);

        // await axios.post(`${AS400_URL}/issue`, [{
        //     trackId:  payload.track_id,
        //     jobtag:   payload.jobtag,
        //     process:  payload.moves_from_process,
        //     location: payload.moves_from_location,
        //     timestamp: new Date().toISOString(),
        // }], { headers: { Authorization: AS400_TOKEN } });

        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// WASHING
router.post('/washing', async (req, res) => {
    try {
        const { tag_id, barcode, location, lot_data } = req.body;
        const track_id = generateTrackId(location, barcode);
        const pool     = await poolPromise;

        // RUN
        const p_run = PROCESS.washing_run;
        await logToDB(pool, 'WASHING_RUN', 'movement_wip', {
            tag_id,
            barcode,
            jobtag:               barcode,
            track_id,
            machine_no:           null,
            process_code:         lot_data?.process_code || null,
            moves_from_process:   p_run.from_process,
            moves_from_location:  `${p_run.from_location}${location}`,
            moves_to_process:     p_run.to_process,
            moves_to_location:    `${p_run.to_location}${location}`,
            production_qty:       null,
            ng_qty:               0,
        });

        // AF
        const p_af = PROCESS.washing_af;
        await logToDB(pool, 'WASHING_AF', 'movement_wip', {
            tag_id,
            barcode,
            jobtag:               barcode,
            track_id,
            machine_no:           null,
            process_code:         lot_data?.process_code || null,
            moves_from_process:   p_af.from_process,
            moves_from_location:  `${p_af.from_location}${location}`,
            moves_to_process:     p_af.to_process,
            moves_to_location:    `${p_af.to_location}${location}`,
            production_qty:       null,
            ng_qty:               0,
        });

        // await axios.post(`${AS400_URL}/movement_wip`, [
        //     { ...run payload... },
        //     { ...af payload... },
        // ], { headers: { Authorization: AS400_TOKEN } });

        res.json({ result: 'OK' });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

module.exports = router;