-- =========================================================
-- step6_1 (2026-10-16) แบบ B: ถาดที่ขึ้นเครื่องแล้ว ไม่ต้องทำซ้ำ
-- =========================================================
-- เดิม: ถาดที่เป็น on_machine อยู่แล้ว ผ่านเข้า SP ได้ → update + insert tray_log ซ้ำ → ตอบ OK
--       → Node ส่ง A5 (ON_MACHINE_IN) ซ้ำทุกครั้งที่ reader อ่านหลุดแล้วอ่านใหม่ (P1: G6332797 70 ครั้ง)
-- ตอนนี้: ถาดเป็น on_machine อยู่แล้ว → ตอบ ALREADY_ON_MACHINE ทันที ไม่แตะ DB
--         → Node ไม่ส่ง A5 / A6 · Python นับ qty แสดงผลเหมือนเดิม
-- ส่วนอื่นเหมือนเดิมทุกบรรทัด
--
-- ย้อนกลับ: รัน ALTER ด้วยไฟล์เดิม (ไม่มีบล็อก ALREADY_ON_MACHINE)
-- ⚠️ ต้อง deploy พร้อม rfid.js + main_dll.py (exe) ตัวใหม่ — Python ตัวเก่าไม่รู้จัก ALREADY_ON_MACHINE
-- =========================================================

ALTER PROCEDURE [dbo].[Stored_tb_rfid_tray_on_machine]
    @tag_id       VARCHAR(50),
    @machine_no   VARCHAR(50)  = NULL,
    @process_code VARCHAR(10)  = NULL,
    @process      VARCHAR(100) = NULL
AS
BEGIN
    -- เช็คว่า tag มีและ sub_process = after_washing
    IF NOT EXISTS (
        SELECT 1 FROM tb_rfid_tray
        WHERE tag_id      = @tag_id
        AND   status      = 'Ongoing'
        AND   sub_process IN ('after_washing','on_machine')
    )
    BEGIN
        SELECT 'NOT_WASHED' AS result
        RETURN
    END

    -- แบบ B: ขึ้นเครื่องไปแล้ว → ไม่ทำซ้ำ (A5 ส่งครั้งเดียวต่อถาด)
    IF EXISTS (
        SELECT 1 FROM tb_rfid_tray
        WHERE tag_id      = @tag_id
        AND   status      = 'Ongoing'
        AND   sub_process = 'on_machine'
    )
    BEGIN
        SELECT 'ALREADY_ON_MACHINE' AS result
        RETURN
    END

    -- ดึงข้อมูลจาก tb_rfid_tray
    DECLARE @barcode  VARCHAR(50)
    DECLARE @tray_no  INT
    DECLARE @tray_qty INT
    SELECT  @barcode  = barcode,
            @tray_no  = tray_no,
            @tray_qty = tray_qty
    FROM tb_rfid_tray
    WHERE tag_id      = @tag_id
    AND   sub_process IN ('after_washing','on_machine')
    AND   status      = 'Ongoing'

    -- เช็คว่า lot นี้ยังมี tray ที่ยังไม่ผ่าน washing
    IF EXISTS (
        SELECT 1 FROM tb_rfid_tray
        WHERE barcode     = @barcode
        AND   status      = 'Ongoing'
        AND   sub_process NOT IN ('after_washing', 'on_machine', 'completed')
    )
    BEGIN
        SELECT 'LOT_NOT_READY' AS result
        RETURN
    END

    BEGIN TRANSACTION
    BEGIN TRY
        -- UPDATE tb_rfid_tray เป็น on_machine
        UPDATE tb_rfid_tray
        SET sub_process = 'on_machine',
            updated_at  = GETDATE()
        WHERE tag_id = @tag_id
        AND   status = 'Ongoing'

        -- INSERT tb_rfid_tray_log
        INSERT INTO tb_rfid_tray_log (
            tag_id,   barcode,      tray_no,
            tray_qty, sub_process,
            created_at
        )
        VALUES (
            @tag_id,  @barcode,     @tray_no,
            @tray_qty,'on_machine',
            GETDATE()
        )

        -- เช็คว่าครบทุก tray ของ lot ไหม
        DECLARE @tray_counter INT
        DECLARE @tray_on      INT
        SELECT @tray_counter = tray_counter
        FROM tb_rfid_lot
        WHERE barcode = @barcode

        SELECT @tray_on = COUNT(*)
        FROM tb_rfid_tray
        WHERE barcode     = @barcode
        AND   sub_process = 'on_machine'

        DECLARE @master_process_code VARCHAR(10)
        DECLARE @master_process      VARCHAR(100)

        SELECT
            @master_process_code = process_code,
            @master_process      = process
        FROM tb_master_process
        WHERE process_code = @process_code

        -- ครบแล้ว UPDATE tb_rfid_lot INSERT tb_rfid_log
        IF @tray_on = @tray_counter
        BEGIN
            UPDATE tb_rfid_lot
            SET sub_process = 'on_machine',
            machine_no   = @machine_no,
            process_code = ISNULL(@master_process_code, process_code),
            process      = ISNULL(@master_process, process),
            updated_at  = GETDATE()
            WHERE barcode = @barcode

            -- INSERT tb_rfid_log
            INSERT INTO tb_rfid_log (
                sub_process,  barcode,
                process_code, process,
                quantity,     location,
                status,       remark,
                created_at
            )
            SELECT
                'on_machine', barcode,
                ISNULL(@process_code, process_code),
                ISNULL(@process,      process),
                quantity, location,
                status, null, GETDATE()
            FROM tb_rfid_lot
            WHERE barcode = @barcode
        END

        COMMIT TRANSACTION
        IF @tray_on = @tray_counter
            SELECT 'LOT_ON_MACHINE' AS result
        ELSE
            SELECT 'OK' AS result
    END TRY
    BEGIN CATCH
        -- ROLLBACK TRANSACTION   -- เดิม: deadlock แล้ว SQL rollback ให้เองไปแล้ว → ROLLBACK ซ้ำ = error 3903 → Node 500
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION
        SELECT ERROR_MESSAGE() AS result
    END CATCH
END
