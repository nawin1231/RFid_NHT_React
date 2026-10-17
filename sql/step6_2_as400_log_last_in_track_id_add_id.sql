-- =========================================================
-- step6_2 (2026-10-16) แบบ B: last_in_track_id คืน id ด้วย
-- =========================================================
-- รันหลัง step5_2 · เพิ่มคอลัมน์ id ใน SELECT อย่างเดียว ส่วนอื่นเหมือน step5_2 ทุกบรรทัด
-- ใช้ใน as400.js /on-machine-out: เทียบ id ของ IN กับ OUT ล่าสุดของถาด
--   → ไม่มี IN / OUT ไปแล้วหลัง IN ล่าสุด = ไม่ส่ง A7 ซ้ำ
--   (กันถาดที่ Python ตัวเก่าส่ง A7 ไปแล้วก่อน deploy แล้วมาถึง completed หลัง deploy)
--
-- ย้อนกลับ: รัน step5_2 อีกครั้งโดยเปลี่ยน CREATE เป็น ALTER
-- =========================================================

ALTER PROCEDURE [dbo].[Stored_tb_rfid_as400_log_last_in_track_id]
    @jobtag     VARCHAR(50),
    @event_type VARCHAR(50),
    @location   VARCHAR(20) = NULL,
    @tag_id     VARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON
    -- machine_no: แบบ B ใช้หาเครื่องของถาดตอนส่ง A7 ที่ completed (ถาดไม่มีคอลัมน์เครื่องของตัวเอง)
    -- SELECT TOP 1 track_id, machine_no
    SELECT TOP 1 id, track_id, machine_no
    FROM tb_rfid_as400_log
    WHERE jobtag     = @jobtag
      AND event_type = @event_type
      AND (@location IS NULL OR location = @location)
      AND (@tag_id   IS NULL OR tag_id   = @tag_id)
      AND status <> 'REJECTED'
    ORDER BY timestamp DESC, id DESC
END
