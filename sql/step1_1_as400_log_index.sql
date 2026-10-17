-- =========================================================
-- ขั้น 1.1 — เพิ่ม index บน tb_rfid_as400_log   (2026-09-28)
-- ดูเหตุผลใน SYSTEM_REVIEW_2026-09-28.md ข้อ S4
--
-- รันซ้ำได้ปลอดภัย (มีเช็ค IF NOT EXISTS)
-- ต้องรันทั้ง DB เครื่อง dev และ DB บน server ตอน deploy
-- ไม่ต้องแก้ SP / Node / Python
-- =========================================================

-- 1) ให้ Stored_tb_rfid_last_on_machine_event หา tag ได้ตรงๆ
--    (ถูกเรียกทุกครั้งที่ถาดใหม่ขึ้นเครื่อง MBR — WHERE tag_id ... ORDER BY timestamp DESC)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name      = 'Index_tb_rfid_as400_log_tag_id'
      AND object_id = OBJECT_ID('dbo.tb_rfid_as400_log')
)
BEGIN
    CREATE NONCLUSTERED INDEX Index_tb_rfid_as400_log_tag_id
    ON dbo.tb_rfid_as400_log (tag_id, [timestamp] DESC)
    INCLUDE (event_type, status);
END
GO

-- 2) ให้ Stored_tb_rfid_as400_log_get_errors หาแถว ERROR ได้ตรงๆ
--    (retryErrors เรียกทุก 5 นาที — WHERE status = 'ERROR' ... ORDER BY timestamp)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name      = 'Index_tb_rfid_as400_log_status'
      AND object_id = OBJECT_ID('dbo.tb_rfid_as400_log')
)
BEGIN
    CREATE NONCLUSTERED INDEX Index_tb_rfid_as400_log_status
    ON dbo.tb_rfid_as400_log (status, [timestamp])
    INCLUDE (api_type);
END
GO

-- ตรวจผล — ต้องเห็น 4 แถว (PK, jobtag, tag_id, status)
EXEC sp_helpindex 'dbo.tb_rfid_as400_log';
GO

-- =========================================================
-- ย้อนกลับ (ถ้าต้องการ) — ลบ index ไม่กระทบข้อมูล
-- =========================================================
-- DROP INDEX Index_tb_rfid_as400_log_tag_id ON dbo.tb_rfid_as400_log;
-- DROP INDEX Index_tb_rfid_as400_log_status ON dbo.tb_rfid_as400_log;
