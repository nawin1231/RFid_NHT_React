-- =========================================================
-- ขั้น 1.3 — index บน tb_rfid_log สำหรับหา location ล่าสุดของ lot   (2026-09-28)
--
-- ใช้โดย Stored_tb_rfid_lot_update_location (pallet):
--   SELECT TOP 1 location FROM tb_rfid_log WHERE barcode = @barcode ORDER BY created_at DESC
--
-- script นี้เช็คก่อน — ถ้ามี index ที่ขึ้นต้นด้วย barcode อยู่แล้วจะไม่สร้างซ้ำ
-- รันซ้ำได้ปลอดภัย · ต้องรันทั้ง DB dev และ DB server
-- =========================================================

IF NOT EXISTS (
    SELECT 1
    FROM sys.indexes i
    JOIN sys.index_columns ic ON ic.object_id = i.object_id AND ic.index_id  = i.index_id
    JOIN sys.columns       c  ON c.object_id  = ic.object_id AND c.column_id = ic.column_id
    WHERE i.object_id    = OBJECT_ID('dbo.tb_rfid_log')
      AND ic.key_ordinal = 1
      AND c.name         = 'barcode'
)
BEGIN
    CREATE NONCLUSTERED INDEX Index_tb_rfid_log_barcode
    ON dbo.tb_rfid_log (barcode, created_at DESC)
    INCLUDE (location);
    PRINT N'สร้าง Index_tb_rfid_log_barcode แล้ว';
END
ELSE
    PRINT N'มี index ที่ขึ้นต้นด้วย barcode อยู่แล้ว — ไม่ต้องสร้าง';
GO

-- ตรวจผล
EXEC sp_helpindex 'dbo.tb_rfid_log';
EXEC sp_helpindex 'dbo.tb_rfid_tray_log';   -- ดูไว้เฉยๆ (SP ที่ตรวจแล้วมีแต่ INSERT ลงตารางนี้ ไม่ได้อ่าน)
GO

-- =========================================================
-- ย้อนกลับ (เฉพาะกรณีที่ script นี้เป็นคนสร้าง)
-- =========================================================
-- DROP INDEX Index_tb_rfid_log_barcode ON dbo.tb_rfid_log;
