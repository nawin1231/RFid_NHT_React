-- =========================================================
-- ขั้น 1.2 — ROLLBACK ใน BEGIN CATCH ให้เช็ค @@TRANCOUNT ก่อน   (2026-09-28)
-- ดูเหตุผลใน SYSTEM_REVIEW_2026-09-28.md ข้อ R2
--
-- แก้ 3 SP · เปลี่ยนแค่บรรทัดเดียวใน BEGIN CATCH ของแต่ละตัว (บรรทัดเดิม comment ไว้)
--   1) Stored_tb_rfid_tray_on_machine
--   2) Stored_tb_rfid_tray_after_washing
--   3) Stored_tb_rfid_tray_completed
-- (Stored_tb_rfid_lot_update_location มี IF @@TRANCOUNT อยู่แล้ว ไม่ต้องแก้)
--
-- ⚠️ script นี้สร้างจาก SP ที่ส่งมาเมื่อ 2026-09-28 (DB dev)
--    ก่อนรันบน server ให้เช็คว่า SP บน server เหมือนกัน
--    ถ้าไม่แน่ใจ → เปิด SP ใน SSMS (Modify) แล้วแก้เฉพาะบรรทัด ROLLBACK ใน CATCH เอง
--
-- ย้อนกลับ: เอา comment บรรทัดเดิมออก + ลบบรรทัด IF @@TRANCOUNT แล้วรันใหม่
-- =========================================================


-- =========================================================
-- 1) Stored_tb_rfid_tray_on_machine
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
GO


-- =========================================================
-- 2) Stored_tb_rfid_tray_after_washing
-- =========================================================
ALTER PROCEDURE [dbo].[Stored_tb_rfid_tray_after_washing]
    @tag_id       VARCHAR(50),
    @machine_no   VARCHAR(50)  = NULL,
    @process_code VARCHAR(10)  = NULL,
    @process      VARCHAR(100) = NULL
AS
BEGIN
    -- เช็คว่า tag มีและ sub_process = before_washing
    IF NOT EXISTS (
        SELECT 1 FROM tb_rfid_tray
        WHERE tag_id      = @tag_id
        AND   status      = 'Ongoing'
        AND   sub_process = 'before_washing'
    )
    BEGIN
        SELECT 'NOT_READY' AS result
        RETURN
    END

    -- ดึงข้อมูลจาก tb_rfid_tray
    DECLARE @barcode  VARCHAR(50)
    DECLARE @tray_no  INT
    DECLARE @tray_qty INT
    SELECT
        @barcode  = barcode,
        @tray_no  = tray_no,
        @tray_qty = tray_qty
    FROM tb_rfid_tray
    WHERE tag_id = @tag_id
    AND   status = 'Ongoing'

    -- เช็คว่า lot นี้ยังมี tray ที่ยังไม่ผ่าน pallet (registered)
    IF EXISTS (
        SELECT 1 FROM tb_rfid_tray
        WHERE barcode     = @barcode
        AND   status      = 'Ongoing'
        AND   sub_process = 'registered'
    )
    BEGIN
        SELECT 'LOT_NOT_READY' AS result
        RETURN
    END

    BEGIN TRANSACTION
    BEGIN TRY
        -- UPDATE tb_rfid_tray after_washing
        UPDATE tb_rfid_tray
        SET sub_process = 'after_washing',
            updated_at  = GETDATE()
        WHERE tag_id = @tag_id
        AND   status = 'Ongoing'

        -- INSERT tb_rfid_tray_log
        INSERT INTO tb_rfid_tray_log (
            tag_id,   barcode,       tray_no,
            tray_qty, sub_process,   created_at
        )
        VALUES (
            @tag_id,  @barcode,      @tray_no,
            @tray_qty,'after_washing',GETDATE()
        )

        -- เช็คว่าครบทุก tray ของ lot ไหม
        DECLARE @tray_counter INT
        DECLARE @tray_out     INT
        SELECT @tray_counter = tray_counter
        FROM tb_rfid_lot WHERE barcode = @barcode

        SELECT @tray_out = COUNT(*)
        FROM tb_rfid_tray
        WHERE barcode     = @barcode
        AND   sub_process = 'after_washing'

        DECLARE @master_process_code VARCHAR(10)
        DECLARE @master_process      VARCHAR(100)

        SELECT
            @master_process_code = process_code,
            @master_process      = process
        FROM tb_master_process
        WHERE process_code = @process_code

        -- ครบแล้ว UPDATE tb_rfid_lot INSERT tb_rfid_log
        IF @tray_out = @tray_counter
        BEGIN
            UPDATE tb_rfid_lot
            SET sub_process = 'after_washing',
                machine_no   = @machine_no,
                process_code = ISNULL(@master_process_code, process_code),
                process      = ISNULL(@master_process, process),
                updated_at  = GETDATE()
            WHERE barcode = @barcode

            -- INSERT tb_rfid_log
            INSERT INTO tb_rfid_log (
                sub_process,    barcode,
                process_code,   process,
                quantity,       location,
                status,         remark,
                created_at
            )
            SELECT
                'after_washing', barcode,
                ISNULL(@process_code, process_code),
                ISNULL(@process,      process),
                quantity,        location,
                status,          NULL,
                GETDATE()
            FROM tb_rfid_lot
            WHERE barcode = @barcode
        END

        COMMIT TRANSACTION
        IF @tray_out = @tray_counter
            SELECT 'LOT_WASHED' AS result
        ELSE
            SELECT 'OK' AS result
    END TRY
    BEGIN CATCH
        -- ROLLBACK TRANSACTION   -- เดิม: deadlock แล้ว SQL rollback ให้เองไปแล้ว → ROLLBACK ซ้ำ = error 3903 → Node 500
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION
        SELECT ERROR_MESSAGE() AS result
    END CATCH
END
GO


-- =========================================================
-- 3) Stored_tb_rfid_tray_completed
-- =========================================================
ALTER PROCEDURE [dbo].[Stored_tb_rfid_tray_completed]
    @tag_id       VARCHAR(50),
    @process_code VARCHAR(10)  = NULL,
    @process      VARCHAR(100) = NULL
AS
BEGIN
    -- เช็คว่า tag มีและ sub_process = on_machine
    IF NOT EXISTS (
        SELECT 1 FROM tb_rfid_tray
        WHERE tag_id      = @tag_id
        AND   sub_process = 'on_machine'
        AND   status      = 'Ongoing'
    )
    BEGIN
        SELECT 'NOT_ON_MACHINE' AS result
        RETURN
    END

    -- ดึงข้อมูลจาก tb_rfid_tray
    DECLARE @barcode  VARCHAR(50)
    DECLARE @tray_no  INT
    DECLARE @tray_qty INT
    SELECT
        @barcode  = barcode,
        @tray_no  = tray_no,
        @tray_qty = tray_qty
    FROM tb_rfid_tray
    WHERE tag_id      = @tag_id
    AND   sub_process = 'on_machine'
    AND   status      = 'Ongoing'

    BEGIN TRANSACTION
    BEGIN TRY
        -- UPDATE tray นี้เป็น completed
        UPDATE tb_rfid_tray
        SET sub_process = 'completed',
        updated_at  = GETDATE()
        WHERE tag_id = @tag_id
        AND   status = 'Ongoing'

        -- INSERT tray log
        INSERT INTO tb_rfid_tray_log (
            tag_id, barcode, tray_no, tray_qty,
            sub_process,created_at
        )
        VALUES (
            @tag_id, @barcode, @tray_no, @tray_qty,
            'completed', GETDATE()
        )

        -- เช็คว่าทุก tray ใน lot นี้ completed หรือยัง
        DECLARE @remaining INT
        SELECT @remaining = COUNT(*)
        FROM tb_rfid_tray
        WHERE barcode     = @barcode
        AND   status      = 'Ongoing'
        AND   sub_process != 'completed'

        UPDATE tb_rfid_tray
        SET sub_process = 'completed',
            status      = 'Completed',
            updated_at  = GETDATE()
        WHERE tag_id  = @tag_id
        AND   barcode = @barcode
        AND   status  = 'Ongoing'

        DECLARE @master_process_code VARCHAR(10)
        DECLARE @master_process      VARCHAR(100)
        SELECT
            @master_process_code = process_code,
            @master_process = process
        FROM tb_master_process
        WHERE process_code = @process_code


        IF @remaining = 0
        BEGIN
            -- ทุก tray completed UPDATE tb_rfid_lot
            UPDATE tb_rfid_lot
            SET sub_process = 'completed',
                status      = 'Completed',
                process_code = ISNULL(@master_process_code, process_code),
                process = ISNULL(@master_process, process),
                updated_at  = GETDATE()
            WHERE barcode = @barcode
            AND   status  = 'Ongoing'

            -- INSERT lot log
            INSERT INTO tb_rfid_log (
                sub_process,  barcode,
                process_code, process,
                quantity,     location,
                status,       remark,
                created_at
            )
            SELECT
                'completed',  barcode,
                ISNULL(@master_process_code, process_code),
                ISNULL(@master_process, process),
                quantity,     location,
                'Completed',  NULL,
                GETDATE()
            FROM tb_rfid_lot
            WHERE barcode = @barcode
            ORDER BY updated_at DESC

            COMMIT TRANSACTION
            SELECT 'LOT_COMPLETED' AS result  -- ทุก tray จบ lot จบ
        END
        ELSE
        BEGIN
            COMMIT TRANSACTION
            SELECT 'OK' AS result  -- tray นี้จบแต่ lot ยังไม่จบ
        END

    END TRY
    BEGIN CATCH
        -- ROLLBACK TRANSACTION   -- เดิม: deadlock แล้ว SQL rollback ให้เองไปแล้ว → ROLLBACK ซ้ำ = error 3903 → Node 500
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION
        SELECT ERROR_MESSAGE() AS result
    END CATCH
END
GO
