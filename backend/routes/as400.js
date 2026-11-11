const express = require("express");
const router = express.Router();
const { sql, poolPromise } = require("../database");
const axios = require("axios");
const fs = require("fs");
const path = require("path");

const AS400_MOVEMENT_URL = process.env.AS400_MOVEMENT_URL;
const AS400_PRODUCTION_RESULT_URL = process.env.AS400_PRODUCTION_RESULT_URL;
const API_CHECKING_URL = process.env.API_CHECKING_URL;
const API_TOKEN = process.env.API_TOKEN;
const AS400_TIMEOUT_MS = 8000;

// A5 receive 1520 BF + A6 checking — false = ไม่ส่ง AS400 (operator ยิง handy receive เอง)
// ยังบันทึก log เป็น LOCAL → กันส่งซ้ำ / หา IN ของถาดได้เหมือนเดิม · true = กลับมาส่ง
const SEND_ON_MACHINE = false;
// A7 issue 1520 BF — ระบบส่งเองตอน completed · issue ไม่เบิ้ล (operator ยิงไปก่อน → AS400 ตีกลับ → MANUAL)
const SEND_ISSUE_1520 = true;
const markLocal = (pool, logId, flag = "SEND_ON_MACHINE") =>
  updateStatus(pool, logId, "LOCAL", null, `not sent (${flag} = false)`);

// trackId format: process+location_DDMMYYYY_jobtag
const generateTrackId = (process, location, jobtag) => {
  const now = new Date();
  const dd = String(now.getDate()).padStart(2, "0");
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const yyyy = now.getFullYear();
  return `${process}${location}_${dd}${mm}${yyyy}_${jobtag}`;
};

// หา trackId ของ IN ล่าสุดของคู่เดียวกัน
const trackIdFromIn = async (
  pool,
  { jobtag, inEvent, location = null, tagId = null },
  fallback,
) => {
  if (!jobtag) return fallback;
  try {
    const r = await pool
      .request()
      .input("jobtag", sql.VarChar, jobtag)
      .input("event_type", sql.VarChar, inEvent)
      .input("location", sql.VarChar, location)
      .input("tag_id", sql.VarChar, tagId)
      .execute("Stored_tb_rfid_as400_log_last_in_track_id");
    return r.recordset[0]?.track_id || fallback;
  } catch {
    return fallback;
  }
};

// insert log 1 ครั้ง → return id (route ใช้ logToDB ด้านล่างแทน)
const logToDBOnce = async (pool, eventType, apiType, payload) => {
  const result = await pool
    .request()
    .input("track_id", sql.VarChar, payload.track_id)
    .input("api_type", sql.VarChar, apiType)
    .input("event_type", sql.VarChar, eventType)
    .input("machine_no", sql.VarChar, payload.machine_no || null)
    .input("movement_action", sql.VarChar, payload.movement_action || null)
    .input("jobtag", sql.VarChar, payload.jobtag || null)
    .input("process", sql.VarChar, payload.process || null)
    .input("location", sql.VarChar, payload.location || null)
    .input("production_qty", sql.Int, payload.production_qty || null)
    .input("tag_id", sql.VarChar, payload.tag_id || null)
    .execute("Stored_tb_rfid_as400_log_insert");
  return result.recordset[0].id;
};

// insert log พลาด → ลองใหม่ 2 ครั้ง → ยังไม่ได้ จดลง logs/as400_failed.jsonl แล้ว throw
const LOG_RETRY_DELAYS_MS = [500, 1500];
const FAILED_LOG_FILE = path.join(__dirname, "../logs/as400_failed.jsonl");

const logToDB = async (pool, eventType, apiType, payload) => {
  let lastErr;
  for (let attempt = 0; attempt <= LOG_RETRY_DELAYS_MS.length; attempt++) {
    if (attempt > 0)
      await new Promise((r) => setTimeout(r, LOG_RETRY_DELAYS_MS[attempt - 1]));
    try {
      return await logToDBOnce(pool, eventType, apiType, payload);
    } catch (err) {
      lastErr = err;
    }
  }

  const line =
    JSON.stringify({
      failed_at: new Date().toISOString(),
      event_type: eventType,
      api_type: apiType,
      payload,
      error: lastErr?.message,
    }) + "\n";
  try {
    fs.mkdirSync(path.dirname(FAILED_LOG_FILE), { recursive: true });
    fs.appendFileSync(FAILED_LOG_FILE, line, "utf-8");
  } catch (fileErr) {
    // เขียนไฟล์ก็ไม่ได้ → ข้อมูลจะหาย เหลือที่เดียวคือ console (เก็บ log นี้ไว้)
    console.error(
      `[logToDB] เขียนไฟล์สำรองไม่ได้ (${fileErr.message}) · ข้อมูลที่หาย: ${line}`,
    );
  }
  throw lastErr;
};

// update status + เก็บ response หลังส่ง API
const updateStatus = async (
  pool,
  id,
  status,
  errorMsg = null,
  responseMsg = null,
) => {
  await pool
    .request()
    .input("id", sql.Int, id)
    .input("status", sql.VarChar, status)
    .input("error_msg", sql.VarChar, errorMsg)
    .input("response_msg", sql.VarChar, responseMsg)
    .execute("Stored_tb_rfid_as400_log_update_status");
};

// แสดง status ของ 207 (processed with some errors) → "REJECTED" / "MANUAL" / "ERROR"
const REJECT_PATTERNS = ["Process/Location different"];
const statusOf207 = (data, manual = null) => {
  const items = Array.isArray(data?.data) ? data.data : [];
  const rejectedItem = items.find((i) =>
    REJECT_PATTERNS.some((p) =>
      `${i?.message ?? ""} ${i?.reason ?? ""}`.includes(p),
    ),
  );
  if (!rejectedItem) return "ERROR";
  const m = `${rejectedItem.message ?? ""}`.match(/expected\s+(\S+)\/(\S+)/);
  if (manual?.kind === "OUT") {
    // ยังอยู่ STOR BF = operator ยังไม่ยิง receive 1520 → ERROR ให้ retry จนกว่าจะรับ
    if (m && m[1] === "STOR" && m[2] === "BF") return "ERROR";
    return "MANUAL";
  }
  if (manual?.kind === "IN") {
    if (m && m[1] === `${manual.process}` && m[2] === `${manual.location}`)
      return "MANUAL";
  }
  return "REJECTED";
};

const sendMovement = async (pool, logId, body, manual = null) => {
  // ⚠️⚠️ TEST MODE — ปิดส่ง AS400 ชั่วคราว ต้องลบ 3 บรรทัดนี้ก่อนใช้งานจริง ⚠️⚠️
  // await updateStatus(pool, logId, 'MOCK', null, 'TEST MODE - not sent');
  // return;
  try {
    const axiosRes = await axios.post(`${AS400_MOVEMENT_URL}`, [body], {
      headers: { Authorization: API_TOKEN },
      timeout: AS400_TIMEOUT_MS,
    });
    // 207 = processed with some errors
    if (axiosRes.status === 207) {
      await updateStatus(
        pool,
        logId,
        statusOf207(axiosRes.data, manual),
        null,
        JSON.stringify(axiosRes.data),
      );
    } else {
      await updateStatus(
        pool,
        logId,
        "SUCCESS",
        null,
        JSON.stringify(axiosRes.data),
      );
    }
  } catch (apiErr) {
    const isTimeout = apiErr.code === "ECONNABORTED";
    const errMsg = isTimeout
      ? null
      : apiErr.response?.data
        ? JSON.stringify(apiErr.response.data)
        : apiErr.message;
    const resMsg = isTimeout
      ? `timeout of ${AS400_TIMEOUT_MS}ms exceeded`
      : null;
    await updateStatus(
      pool,
      logId,
      isTimeout ? "SUCCESS" : "ERROR",
      errMsg,
      resMsg,
    );
  }
};

// A1 — PALLET IN (MOVE_IN 1201 BFW)
router.post("/pallet-in", async (req, res) => {
  try {
    const { tag_id, barcode, location, lot_data } = req.body;
    const pool = await poolPromise;
    const payload = {
      track_id: generateTrackId("1201", location, barcode),
      machine_no: "",
      movement_action: "MOVE_IN",
      jobtag: barcode,
      process: "1201",
      location: `BF${location}`,
      production_qty: lot_data?.quantity ?? null,
    };
    const logId = await logToDB(pool, "PALLET_IN", "movement", payload);
    await sendMovement(pool, logId, {
      trackId: payload.track_id,
      machineNo: payload.machine_no,
      movementAction: payload.movement_action,
      jobtag: payload.jobtag,
      process: payload.process,
      location: payload.location,
      timestamp: new Date().toISOString(),
    });
    res.json({ result: "OK" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A2 — PALLET OUT (MOVE_OUT 1201 BFW)
router.post("/pallet-out", async (req, res) => {
  try {
    const { barcode, location, lot_data } = req.body;
    const pool = await poolPromise;
    const checkResult = await pool
      .request()
      .input("jobtag", sql.VarChar, barcode)
      .execute("Stored_tb_rfid_as400_log_check_last_event");
    if (checkResult.recordset[0]?.event_type === "PALLET_OUT") {
      return res.json({ result: "ALREADY_OUT" });
    }
    const payload = {
      track_id: await trackIdFromIn(
        pool,
        { jobtag: barcode, inEvent: "PALLET_IN", location: `BF${location}` },
        generateTrackId("1201", location, barcode),
      ),
      machine_no: "",
      movement_action: "MOVE_OUT",
      jobtag: barcode,
      process: "1201",
      location: `BF${location}`,
      production_qty: lot_data?.quantity ?? null,
    };
    const logId = await logToDB(pool, "PALLET_OUT", "movement", payload);
    await sendMovement(pool, logId, {
      trackId: payload.track_id,
      machineNo: payload.machine_no,
      movementAction: payload.movement_action,
      jobtag: payload.jobtag,
      process: payload.process,
      location: payload.location,
      timestamp: new Date().toISOString(),
    });
    res.json({ result: "OK" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A3 — WASHING RUN (MOVE_IN 1201 RUN)
router.post("/washing", async (req, res) => {
  try {
    const { barcode, location, machine_no, process_code, lot_data } = req.body;
    const pool = await poolPromise;
    const payload = {
      track_id: generateTrackId(process_code || "1201", "RUN", barcode),
      machine_no: machine_no || "",
      movement_action: "MOVE_IN",
      jobtag: barcode,
      process: process_code || "1201",
      location: "RUN",
      production_qty: lot_data?.quantity ?? null,
    };
    const logId = await logToDB(pool, "WASHING_RUN", "movement", payload);
    await sendMovement(pool, logId, {
      trackId: payload.track_id,
      machineNo: payload.machine_no,
      movementAction: payload.movement_action,
      jobtag: payload.jobtag,
      process: payload.process,
      location: payload.location,
      timestamp: new Date().toISOString(),
    });
    res.json({ result: "OK" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A4 — WASHING RESULT (production-result 1201)
router.post("/washing-result", async (req, res) => {
  try {
    const { barcode, machine_no, production_qty } = req.body;
    const pool = await poolPromise;
    const payload = {
      track_id: await trackIdFromIn(
        pool,
        { jobtag: barcode, inEvent: "WASHING_RUN" },
        generateTrackId("1201", "RUN", barcode),
      ),
      machine_no: machine_no || "",
      movement_action: null,
      jobtag: barcode,
      process: "1201",
      location: "RUN",
      production_qty: production_qty,
    };
    const logId = await logToDB(
      pool,
      "WASHING_RESULT",
      "production-result",
      payload,
    );
    try {
      const axiosRes = await axios.post(
        `${AS400_PRODUCTION_RESULT_URL}`,
        [
          {
            trackId: payload.track_id,
            jobtagIn: payload.jobtag,
            machineNo: payload.machine_no,
            processCode: payload.process,
            productionQty: payload.production_qty,
            ngQty: 0,
            timestamp: new Date().toISOString(),
          },
        ],
        {
          headers: { Authorization: API_TOKEN },
          timeout: AS400_TIMEOUT_MS,
        },
      );
      if (axiosRes.status === 207) {
        await updateStatus(
          pool,
          logId,
          statusOf207(axiosRes.data),
          null,
          JSON.stringify(axiosRes.data),
        );
      } else {
        await updateStatus(
          pool,
          logId,
          "SUCCESS",
          null,
          JSON.stringify(axiosRes.data),
        );
      }
    } catch (apiErr) {
      const isTimeout = apiErr.code === "ECONNABORTED";
      const errMsg = isTimeout
        ? null
        : apiErr.response?.data
          ? JSON.stringify(apiErr.response.data)
          : apiErr.message;
      const resMsg = isTimeout
        ? `timeout of ${AS400_TIMEOUT_MS}ms exceeded`
        : null;
      await updateStatus(
        pool,
        logId,
        isTimeout ? "SUCCESS" : "ERROR",
        errMsg,
        resMsg,
      );
    }
    res.json({ result: "OK" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A5 — ON MACHINE IN (MOVE_IN 1520 BF) ทีละ tag
router.post("/on-machine-in", async (req, res) => {
  try {
    const { tag_id, barcode, machine_no, production_qty, process_code } =
      req.body;
    const pool = await poolPromise;
    const payload = {
      track_id: generateTrackId(process_code || "1520", "BF", barcode),
      machine_no: machine_no || "",
      movement_action: "MOVE_IN",
      jobtag: barcode,
      process: process_code || "1520",
      location: "BF",
      production_qty: production_qty,
      tag_id: tag_id || null,
    };
    const logId = await logToDB(pool, "ON_MACHINE_IN", "movement", payload);
    if (!SEND_ON_MACHINE) {
      await markLocal(pool, logId);
      return res.json({ result: "OK" });
    }
    await sendMovement(
      pool,
      logId,
      {
        trackId: payload.track_id,
        machineNo: payload.machine_no,
        movementAction: payload.movement_action,
        jobtag: payload.jobtag,
        process: payload.process,
        location: payload.location,
        qty: payload.production_qty,
        timestamp: new Date().toISOString(),
      },
      { kind: "IN", process: payload.process, location: payload.location },
    );
    res.json({ result: "OK" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// A6 — CHECKING
router.post("/checking", async (req, res) => {
  try {
    const {
      barcode,
      machine_no,
      wos_barcode,
      jobtag,
      check_result,
      material_type,
    } = req.body;
    const pool = await poolPromise;
    const payload = {
      wosBarcode: wos_barcode,
      machine: machine_no,
      checkBy: "RFID",
      jobtagList: [
        {
          jobtag: jobtag,
          checkResult: check_result,
          materialType: material_type,
        },
      ],
    };
    const logId = await logToDB(pool, "CHECKING", "checking", {
      track_id: generateTrackId("1520", "BF", jobtag),
      machine_no,
      jobtag,
      process: "1520",
      location: "BF",
    });
    if (!SEND_ON_MACHINE) {
      await markLocal(pool, logId);
      return res.json({ result: "OK" });
    }
    try {
      const axiosRes = await axios.post(`${API_CHECKING_URL}`, payload, {
        headers: { Authorization: API_TOKEN },
        timeout: AS400_TIMEOUT_MS,
      });
      if (axiosRes.status === 207) {
        await updateStatus(
          pool,
          logId,
          "ERROR",
          null,
          JSON.stringify(axiosRes.data),
        );
      } else {
        await updateStatus(
          pool,
          logId,
          "SUCCESS",
          null,
          JSON.stringify(axiosRes.data),
        );
      }
    } catch (apiErr) {
      const isTimeout = apiErr.code === "ECONNABORTED";
      const errMsg = isTimeout
        ? null
        : apiErr.response?.data
          ? JSON.stringify(apiErr.response.data)
          : apiErr.message;
      const resMsg = isTimeout
        ? `timeout of ${AS400_TIMEOUT_MS}ms exceeded`
        : null;
      await updateStatus(
        pool,
        logId,
        isTimeout ? "SUCCESS" : "ERROR",
        errMsg,
        resMsg,
      );
    }
    res.json({ result: "OK" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// แถว IN / OUT ล่าสุดของถาด
const lastLogRow = async (pool, jobtag, eventType, tagId) => {
  const r = await pool
    .request()
    .input("jobtag", sql.VarChar, jobtag)
    .input("event_type", sql.VarChar, eventType)
    .input("location", sql.VarChar, null)
    .input("tag_id", sql.VarChar, tagId)
    .execute("Stored_tb_rfid_as400_log_last_in_track_id");
  return { row: r.recordset[0] || null, hasId: !!r.recordset.columns?.id };
};

// A7 — ON MACHINE OUT (MOVE_OUT 1520 BF) ทีละ tag
router.post("/on-machine-out", async (req, res) => {
  try {
    const { tag_id, barcode, qty, machine_no } = req.body;
    const pool = await poolPromise;

    // กันส่ง A7 ซ้ำ / ส่ง OUT ทั้งที่ไม่มี IN · SP ยังไม่มี id หรือพัง → ส่งตามเดิม
    let inRow = null;
    try {
      const lastIn = await lastLogRow(pool, barcode, "ON_MACHINE_IN", tag_id);
      const outRow = (await lastLogRow(pool, barcode, "ON_MACHINE_OUT", tag_id))
        .row;
      inRow = lastIn.row;
      if (lastIn.hasId) {
        if (!inRow) return res.json({ result: "SKIPPED_NO_IN" });
        if (outRow && outRow.id > inRow.id) return res.json({ result: "SKIPPED_ALREADY_OUT" });
      }
    } catch {
      // SP พัง → ส่งตามเดิม
    }

    const payload = {
      track_id: await trackIdFromIn(
        pool,
        { jobtag: barcode, inEvent: "ON_MACHINE_IN", tagId: tag_id },
        generateTrackId("1520", "BF", barcode),
      ),
      machine_no: machine_no || inRow?.machine_no || "", // ส่งจาก completed ไม่มีเครื่อง → ใช้ของแถว IN
      movement_action: "MOVE_OUT",
      jobtag: barcode,
      process: "1520",
      location: "BF",
      production_qty: qty,
      tag_id: tag_id || null,
    };
    const logId = await logToDB(pool, "ON_MACHINE_OUT", "movement", payload);
    if (!SEND_ISSUE_1520) {
      await markLocal(pool, logId, "SEND_ISSUE_1520");
      return res.json({ result: "OK" });
    }
    await sendMovement(
      pool,
      logId,
      {
        trackId: payload.track_id,
        machineNo: payload.machine_no,
        movementAction: payload.movement_action,
        jobtag: payload.jobtag,
        process: payload.process,
        location: payload.location,
        qty: payload.production_qty,
        timestamp: new Date().toISOString(),
      },
      { kind: "OUT" },
    );
    res.json({ result: "OK" });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Auto retry — ดึง ERROR records แล้วส่งใหม่
const retryErrorsOnce = async () => {
  try {
    const pool = await poolPromise;
    const result = await pool
      .request()
      .execute("Stored_tb_rfid_as400_log_get_errors");

    for (const row of result.recordset) {
      if (row.api_type === "movement") {
        // 1520 ที่ปิดส่งไว้ไม่เคยเป็น ERROR (บันทึก LOCAL ตั้งแต่แรก) → ERROR ที่เจอ = ตั้งใจให้ส่ง (เช่น fix2)
        const is1520 = `${row.process}` === "1520" && row.location === "BF";
        const manual = !is1520
          ? null
          : row.movement_action === "MOVE_OUT"
            ? { kind: "OUT" }
            : { kind: "IN", process: row.process, location: row.location };
        await sendMovement(
          pool,
          row.id,
          {
            trackId: row.track_id,
            machineNo: row.machine_no || "",
            movementAction: row.movement_action,
            jobtag: row.jobtag,
            process: row.process,
            location: row.location,
            qty: row.production_qty,
            timestamp: new Date().toISOString(),
          },
          manual,
        );
      } else if (row.api_type === "production-result") {
        try {
          const axiosRes = await axios.post(
            `${AS400_PRODUCTION_RESULT_URL}`,
            [
              {
                trackId: row.track_id,
                jobtagIn: row.jobtag,
                machineNo: row.machine_no || "",
                processCode: row.process,
                productionQty: row.production_qty,
                ngQty: 0,
                timestamp: new Date().toISOString(),
              },
            ],
            {
              headers: { Authorization: API_TOKEN },
              timeout: AS400_TIMEOUT_MS,
            },
          );
          await updateStatus(
            pool,
            row.id,
            axiosRes.status === 207 ? statusOf207(axiosRes.data) : "SUCCESS",
            null,
            JSON.stringify(axiosRes.data),
          );
        } catch (apiErr) {
          const isTimeout = apiErr.code === "ECONNABORTED";
          await updateStatus(
            pool,
            row.id,
            isTimeout ? "SUCCESS" : "ERROR",
            isTimeout
              ? null
              : JSON.stringify(apiErr.response?.data || apiErr.message),
            isTimeout ? `timeout of ${AS400_TIMEOUT_MS}ms exceeded` : null,
          );
        }
      }
    }
  } catch (err) {}
};

// กันรอบ retry ทับกัน (AS400 ช้า รอบเก่ายังไม่จบ → รอบใหม่ส่งแถวเดิมซ้ำ)
let retryRunning = false;
const retryErrors = async () => {
  if (retryRunning) return;
  retryRunning = true;
  try {
    await retryErrorsOnce();
  } finally {
    retryRunning = false; // ต้องปล่อยเสมอ ไม่งั้น error ครั้งเดียว retry หยุดถาวร
  }
};

module.exports = { router, retryErrors };
