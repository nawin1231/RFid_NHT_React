-- =========================================================
-- step5_1 (2026-10-15) F2: กันส่ง A5 / A7 ซ้ำฝั่ง backend
-- =========================================================
-- ใช้โดย as400.js /on-machine-in และ /on-machine-out
-- คืนแถว ON_MACHINE_IN/OUT ล่าสุดของ tag "ทุกสถานะ" (SUCCESS / ERROR / REJECTED)
--
-- ต่างจาก Stored_tb_rfid_last_on_machine_event (Python ใช้ · นับเฉพาะ SUCCESS · ไม่แก้):
--   OUT ที่ AS400 ปฏิเสธ → SP เดิมมองไม่เห็น → Python ส่ง OUT ซ้ำวนไปเรื่อยๆ (P2)
--   SP นี้เห็น OUT นั้น → backend ตอบ ALREADY_OUT ไม่ส่งซ้ำ
--
-- กรองด้วย tag_id + jobtag คู่กัน: tag ถูกเอากลับมาใช้กับ lot ใหม่ได้
--   ถ้ากรองแค่ tag_id แล้ว lot เก่าค้างที่ IN (ไม่เคยได้ OUT เช่น Python ปิดอยู่ตอนถาดถูกยก)
--   → IN ของ lot ใหม่จะถูกกันผิดๆ
--   @jobtag ว่าง (NULL) = กรองแค่ tag_id
--
-- ใช้ index เดิม Index_tb_rfid_as400_log_tag_id (step1_1) ไม่ต้องสร้างเพิ่ม
-- ยังไม่รันไฟล์นี้ = backend หา SP ไม่เจอ → ส่งตามปกติเหมือนก่อนแก้ (ไม่พัง)
-- ย้อนกลับ: DROP PROCEDURE [dbo].[Stored_tb_rfid_as400_log_last_on_machine_any]
-- =========================================================

CREATE PROCEDURE [dbo].[Stored_tb_rfid_as400_log_last_on_machine_any]
    @tag_id VARCHAR(50),
    @jobtag VARCHAR(50) = NULL
AS
BEGIN
    SET NOCOUNT ON
    SELECT TOP 1 event_type, status
    FROM tb_rfid_as400_log
    WHERE tag_id = @tag_id
      AND (@jobtag IS NULL OR jobtag = @jobtag)
      AND event_type IN ('ON_MACHINE_IN', 'ON_MACHINE_OUT')
    ORDER BY timestamp DESC, id DESC
END
