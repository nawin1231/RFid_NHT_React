-- =========================================================
-- step4_1 (2026-10-14) งานด่วน: register → washing เลย ไม่ผ่าน pallet
-- =========================================================
-- งานธรรมดา: register → pallet (A1 BFW1) → washing ครบ lot (A2 BFW1 → A3 → A4)   ← เหมือนเดิม
-- งานด่วน:   register → washing ครบ lot (A1 BF → A2 BF → A3 → A4)                ← ใหม่
--
-- แก้ 4 จุด (ของเดิม comment ไว้):
--   ① รับถาด registered ได้ด้วย (เดิมรับแค่ before_washing)
--   ② เก็บ sub_process ของถาดไว้ใน @tray_sub
--   ③ ปิดก้อน LOT_NOT_READY — งานธรรมดาไม่มีวันเหลือถาด registered หลังแตะ pallet
--      (SP lot_update_location เปลี่ยนทุกถาดใน lot เป็น before_washing ตั้งแต่ tag แรก)
--      ก้อนนี้จึงบล็อกแค่งานด่วน
--   ④ ตอน LOT_WASHED ส่ง via_pallet กลับไปด้วย: 1 = ผ่าน pallet (ธรรมดา) / 0 = ไม่ผ่าน (ด่วน)
--
-- รันได้ก่อนหรือหลังวาง rfid.js ก็ได้: Node ที่ไม่เจอ via_pallet จะถือเป็นงานธรรมดา
-- ย้อนกลับ: รัน step4_1_rollback_tray_after_washing.sql
-- =========================================================

ALTER PROCEDURE [dbo].[Stored_tb_rfid_tray_after_washing]
    @tag_id       VARCHAR(50),
    @machine_no   VARCHAR(50)  = NULL,
    @process_code VARCHAR(10)  = NULL,
    @process      VARCHAR(100) = NULL
AS
BEGIN
    -- เช็คว่า tag มีและ sub_process = before_washing (งานธรรมดา) หรือ registered (งานด่วน)
    IF NOT EXISTS (
        SELECT 1 FROM tb_rfid_tray
        WHERE tag_id      = @tag_id
        AND   status      = 'Ongoing'
        -- AND   sub_process = 'before_washing'
        AND   sub_process IN ('registered', 'before_washing')   -- ① registered = งานด่วน
    )
    BEGIN
        SELECT 'NOT_READY' AS result
        RETURN
    END

    -- ดึงข้อมูลจาก tb_rfid_tray
    DECLARE @barcode  VARCHAR(50)
    DECLARE @tray_no  INT
    DECLARE @tray_qty INT
    DECLARE @tray_sub VARCHAR(50)                               -- ②
    SELECT
        @barcode  = barcode,
        @tray_no  = tray_no,
        @tray_qty = tray_qty,
        @tray_sub = sub_process                                 -- ②
    FROM tb_rfid_tray
    WHERE tag_id = @tag_id
    AND   status = 'Ongoing'

    -- ③ เดิม: lot ยังมี tray ที่ยังไม่ผ่าน pallet (registered) → LOT_NOT_READY
    --    ปิดเพื่อให้งานด่วนผ่าน (งานธรรมดาไม่มีถาด registered เหลือหลังแตะ pallet อยู่แล้ว)
    -- IF EXISTS (
    --     SELECT 1 FROM tb_rfid_tray
    --     WHERE barcode     = @barcode
    --     AND   status      = 'Ongoing'
    --     AND   sub_process = 'registered'
    -- )
    -- BEGIN
    --     SELECT 'LOT_NOT_READY' AS result
    --     RETURN
    -- END

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
            -- SELECT 'LOT_WASHED' AS result
            SELECT 'LOT_WASHED' AS result,                                          -- ④
                   CASE WHEN @tray_sub = 'before_washing' THEN 1 ELSE 0 END AS via_pallet
        ELSE
            SELECT 'OK' AS result
    END TRY
    BEGIN CATCH
        IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION
        SELECT ERROR_MESSAGE() AS result
    END CATCH
END
