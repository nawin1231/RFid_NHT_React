-- =========================================================
-- ย้อนกลับ step4_1 (2026-10-14) — คืน SP เป็นตัวก่อนรองรับงานด่วน
-- รันแล้ว: งานด่วนจะได้ NOT_READY เหมือนเดิม · rfid.js ไม่ต้องแก้ (ไม่เจอ via_pallet = งานธรรมดา)
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
            SET sub_process  = 'after_washing',
                machine_no   = @machine_no,
                process_code = ISNULL(@master_process_code, process_code),
                process      = ISNULL(@master_process, process),
                updated_at   = GETDATE()
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
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION
        SELECT ERROR_MESSAGE() AS result
    END CATCH
END
