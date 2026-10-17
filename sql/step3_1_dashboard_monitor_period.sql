-- =========================================================
-- ขั้น 3.1 — Dashboard Monitor แบบช่วงเวลา (วันนี้ / สัปดาห์นี้ / เดือนนี้)   (2026-10-05)
--
-- SP ใหม่ ไม่แก้ Stored_tb_rfid_dashboard_monitor เดิม (ยังอยู่ ย้อนกลับได้)
-- ใช้โดย rfid.js  GET /dashboard/monitor?period=day|week|month
--
-- recordset 1 (summary) : ปริมาณที่ "เข้า" แต่ละ sub_process ในช่วงเวลา @period
--                         อ่านจาก tb_rfid_log (บันทึกตอน lot เข้าแต่ละขั้น)
--                         นับ lot ไม่ซ้ำ — ย้าย pallet จะมี before_washing 2 แถว
-- recordset 2 (lots)    : lot ที่มีความเคลื่อนไหว "วันนี้" เสมอ (ทุกสถานะ รวม Completed)
--
-- ช่วงเวลาคำนวณจาก GETDATE() ของ SQL Server — นาฬิกาเดียวกับที่ SP อื่นบันทึก created_at / updated_at
--   day   = เที่ยงคืนวันนี้ → เที่ยงคืนพรุ่งนี้
--   week  = วันจันทร์ของสัปดาห์นี้ → เที่ยงคืนพรุ่งนี้   (ไม่ขึ้นกับ SET DATEFIRST)
--   month = วันที่ 1 ของเดือนนี้ → เที่ยงคืนพรุ่งนี้
--
-- ต้องรันทั้ง DB dev และ DB server
-- =========================================================

CREATE PROCEDURE [dbo].[Stored_tb_rfid_dashboard_monitor_period]
    @period VARCHAR(10) = 'day'
AS
BEGIN
    SET NOCOUNT ON;

    DECLARE @today    DATETIME = CAST(CAST(GETDATE() AS DATE) AS DATETIME);
    DECLARE @tomorrow DATETIME = DATEADD(DAY, 1, @today);
    DECLARE @from     DATETIME =
        CASE @period
            -- 1900-01-01 เป็นวันจันทร์ → ถอยกลับไปวันจันทร์ล่าสุดเสมอ
            WHEN 'week'  THEN DATEADD(DAY, -(DATEDIFF(DAY, '19000101', @today) % 7), @today)
            WHEN 'month' THEN DATEADD(DAY, 1 - DAY(@today), @today)
            ELSE @today
        END;

    -- 1) Summary: ปริมาณที่เข้าแต่ละขั้นในช่วงเวลา
    SELECT
        sub_process,
        COUNT(*)      AS lot_count,
        SUM(quantity) AS total_qty
    FROM (
        SELECT sub_process, barcode, MAX(quantity) AS quantity
        FROM tb_rfid_log
        WHERE created_at >= @from
          AND created_at <  @tomorrow
        GROUP BY sub_process, barcode
    ) x
    GROUP BY sub_process;

    -- 2) Lot list: lot ที่ขยับวันนี้ (ตารางแสดงเฉพาะวันนี้เสมอ ไม่ขึ้นกับ @period)
    SELECT
        l.barcode,
        l.part_no,
        l.sub_process,
        l.status,
        l.tray_done,
        l.tray_counter,
        l.location,
        l.machine_no,
        l.process_code,
        l.process,
        l.quantity,
        l.updated_at
    FROM tb_rfid_lot l
    WHERE l.updated_at >= @today
      AND l.updated_at <  @tomorrow
    ORDER BY l.updated_at DESC;
END
GO

-- index ช่วยกรองตามเวลา (tb_rfid_log โตเรื่อยๆ · ดู "เดือนนี้" จะได้ไม่ไล่ทั้งตาราง)
IF NOT EXISTS (
    SELECT 1 FROM sys.indexes
    WHERE name = 'Index_tb_rfid_log_created_at' AND object_id = OBJECT_ID('dbo.tb_rfid_log')
)
BEGIN
    CREATE NONCLUSTERED INDEX Index_tb_rfid_log_created_at
    ON dbo.tb_rfid_log (created_at)
    INCLUDE (sub_process, barcode, quantity);
END
GO

-- ตรวจ
-- EXEC Stored_tb_rfid_dashboard_monitor_period @period = 'day';
-- EXEC Stored_tb_rfid_dashboard_monitor_period @period = 'week';
-- EXEC Stored_tb_rfid_dashboard_monitor_period @period = 'month';

-- =========================================================
-- ย้อนกลับ
-- =========================================================
-- DROP PROCEDURE [dbo].[Stored_tb_rfid_dashboard_monitor_period];
-- DROP INDEX Index_tb_rfid_log_created_at ON dbo.tb_rfid_log;
