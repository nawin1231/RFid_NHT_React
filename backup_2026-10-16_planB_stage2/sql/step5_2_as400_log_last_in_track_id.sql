-- =========================================================
-- step5_2 (2026-10-15) F1: OUT ใช้ trackId เดียวกับ IN ของคู่เดียวกัน
-- =========================================================
-- ปัญหา (P3): trackId สร้างจาก "วันที่ตอนส่ง" → IN วันที่ 14 / OUT วันที่ 15 ได้ trackId คนละตัว
--             → AS400 จับคู่ไม่ได้ ตอบ "Process/Location different"
-- แก้: ตอนส่ง OUT ให้หา trackId ของ IN ล่าสุดของคู่เดียวกันมาใช้
--   A2 PALLET_OUT     ← A1 PALLET_IN     (jobtag + location เดียวกัน เช่น BFW1 / BF)
--   A7 ON_MACHINE_OUT ← A5 ON_MACHINE_IN (jobtag + tag_id เดียวกัน)
--   A4 WASHING_RESULT ← A3 WASHING_RUN   (jobtag เดียวกัน)
-- IN + OUT วันเดียวกัน = ได้ trackId เหมือนเดิมทุกตัวอักษร · ต่างจากเดิมเฉพาะกรณีข้ามวัน
--
-- ไม่เอาแถว REJECTED (AS400 ไม่มีรายการนั้น ใช้ trackId ของมันก็ไม่ผ่าน)
-- ไม่เจอ / ยังไม่รันไฟล์นี้ → backend สร้าง trackId แบบเดิม (ไม่พัง)
-- ย้อนกลับ: DROP PROCEDURE [dbo].[Stored_tb_rfid_as400_log_last_in_track_id]
-- =========================================================

CREATE PROCEDURE [dbo].[Stored_tb_rfid_as400_log_last_in_track_id]
    @jobtag     VARCHAR(50),
    @event_type VARCHAR(50),
    @location   VARCHAR(20) = NULL,
    @tag_id     VARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON
    SELECT TOP 1 track_id, machine_no
    FROM tb_rfid_as400_log
    WHERE jobtag     = @jobtag
      AND event_type = @event_type
      AND (@location IS NULL OR location = @location)
      AND (@tag_id   IS NULL OR tag_id   = @tag_id)
      AND status <> 'REJECTED'
    ORDER BY timestamp DESC, id DESC
END
