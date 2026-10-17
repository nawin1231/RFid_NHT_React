-- ⏸️ ยังไม่ใช้ — ไม่ต้องรันตอน deploy
--    เตรียมไว้สำหรับ "ส่งตามลำดับต่อ lot (FIFO)" ถ้าวันหลังต้องกัน A3 แซง A2 ตอน AS400 ปฏิเสธ A2
--    ผู้ใช้ตัดสินใจ 2026-09-29 ว่ายังไม่จำเป็น · as400.js ยังไม่ได้เรียก SP นี้
--
-- =========================================================
-- ขั้น 2.1 — SP ใหม่: lot นี้มีแถว AS400 ค้าง ERROR อยู่ไหม   (2026-09-29)
--
-- ใช้โดย as400.js (A1 / A2 / A3 / A4) ก่อนส่ง AS400:
--   มีแถว ERROR ค้าง → event ใหม่ของ lot นี้ "ยังไม่ส่ง" (จดเป็น ERROR WAIT_PREV)
--   → retryErrors ส่งตามลำดับเวลาให้ทีหลัง = AS400 ได้ข้อมูลเรียงถูกเสมอ (เช่น A2 ก่อน A3)
--
-- ไม่นับ api_type = 'checking' เพราะ retryErrors ไม่ retry checking → จะค้างตลอดไป
-- ใช้ index เดิม Index_tb_rfid_as400_log_jobtag
--
-- ⚠️ ต้องสร้างก่อน deploy as400.js ตัวใหม่
--    (ถ้าไม่มี SP นี้ as400.js จะ log error แล้วส่งตามปกติแบบเดิม — ระบบไม่พัง แค่ไม่กันลำดับ)
-- ต้องรันทั้ง DB dev และ DB server
-- =========================================================

CREATE PROCEDURE [dbo].[Stored_tb_rfid_as400_log_pending_by_jobtag]
    @jobtag VARCHAR(50)
AS
BEGIN
    SET NOCOUNT ON;

    SELECT COUNT(*) AS cnt
    FROM tb_rfid_as400_log
    WHERE jobtag   = @jobtag
      AND status   = 'ERROR'
      AND api_type <> 'checking';
END
GO

-- ตรวจ: ต้องได้ cnt (ตัวเลข) กลับมา
-- EXEC Stored_tb_rfid_as400_log_pending_by_jobtag @jobtag = 'G5994209';

-- =========================================================
-- ย้อนกลับ
-- =========================================================
-- DROP PROCEDURE [dbo].[Stored_tb_rfid_as400_log_pending_by_jobtag];


-- =========================================================
-- ปลดล็อก lot ที่ค้าง (ใช้เมื่อแถวไหนพลาดถาวร เช่น AS400 ปฏิเสธข้อมูลผิด)
-- แถว ERROR ที่ไม่มีวันผ่าน จะทำให้ event หลังจากนั้นของ lot เดียวกันรอไปตลอด
-- → เปลี่ยนสถานะแถวนั้นเป็น SKIPPED (retryErrors ดึงเฉพาะ ERROR) แล้ว lot จะไปต่อเอง
-- =========================================================
-- ดูแถวที่ค้างของ lot:
-- SELECT id, event_type, status, error_msg, response_msg, [timestamp]
-- FROM tb_rfid_as400_log WHERE jobtag = '<barcode>' AND status = 'ERROR' ORDER BY [timestamp];
--
-- ปลดแถวที่พลาดถาวร:
-- UPDATE tb_rfid_as400_log SET status = 'SKIPPED' WHERE id = <id>;
