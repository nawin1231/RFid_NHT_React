# SYSTEM REVIEW — RFID NHT Washing (2026-09-28)

> ตรวจทั้งระบบเพื่อเตรียมขยายจาก 5 → 99 readers
> **ตรวจจากการอ่านโค้ดเท่านั้น ยังไม่ได้วัดจริงกับโหลดจริง** · ยังไม่ได้แก้โค้ดใดๆ
> อ่านคู่กับ [`HANDOFF.md`](HANDOFF.md)

---

## ⚡ สรุปสั้น

| คำถาม | คำตอบ |
|---|---|
| สแกนตลอดเวลาทำให้คอขวดไหม | **ไม่** — การสแกนไม่ถึง Node/SQL · ยกเว้น washing / completed ที่ยิงซ้ำทุก 3 วิขณะถาดค้าง (S6) |
| SQL เป็นคอขวดไหม | **ยังไม่** — index หลักมีครบ · ขาด 2 ตัวบน `tb_rfid_as400_log` ที่จะช้าลงเมื่อข้อมูลโต (S4) |
| ข้อมูลหาย / งานค้างเกิดได้ไหม | **ได้จริง** — ต้นเหตุคือ "ส่งพลาดแล้วไม่ลองใหม่" + "error ถูกนับเป็นสำเร็จ" (R1–R8) |
| แก้แล้วจะหายไหม | ส่วนที่เป็น**โค้ดเรา** แก้ได้หมด · ที่เหลือขึ้นกับ AS400 / IT / RF (หัวข้อ 7) |

**ข่าวดี 2 ข้อที่เจอรอบนี้:**
- **A1 ส่งครั้งเดียวต่อ lot อยู่แล้ว** — HANDOFF 7.6 วิเคราะห์ผิด (ดู C6) → pallet batch ลดเหลือแค่งาน "ประหยัด request" ไม่ใช่งานแก้บั๊ก
- **ถาดสุดท้ายอ่านซ้ำไม่ทำให้ A3/A4 ส่งซ้ำ** — ตอบคำถาม HANDOFF ข้อ 6.4 แล้ว (ดู C7)

---

## 1. ขอบเขตที่ตรวจ

| ส่วน | ไฟล์ |
|---|---|
| Python | `main_dll.py`, `start_rfid.py`, `sid_u861.py`, `readers_config.json`, `location_ports.json` |
| Node | `server.js`, `routes/rfid.js`, `routes/as400.js` (ไม่แตะ `database.js` / `.env` ตามกฎ) |
| Frontend | `constances.js`, `instance.js`, `MbrMonitor.js`, `TagSearch.js`, `Dashboard.js` + จุด polling ของ `MultiRegister`, `MachineValidate`, `ReaderStatus`, `ReaderConfig`, `Location` |
| SQL | SP 7 ตัว: `last_on_machine_event`, `lot_select_by_tagid`, `tray_on_machine`, `tray_after_washing`, `as400_log_get_errors`, `lot_update_location`, `tray_completed` · index ของ `tb_rfid_as400_log`, `tb_rfid_tray`, `tb_rfid_lot` · RCSI = **OFF** |

**ยังไม่ได้ตรวจ:** SP อื่น (~15 ตัว เช่น `lot_insert`, `tray_insert`, `as400_log_insert`, `dashboard_*`) · index ของ `tb_rfid_log`, `tb_rfid_tray_log`

---

## 2. 🔴 ข้อมูลหาย / งานค้าง — เกิดได้จริงเมื่อระบบมีปัญหาชั่วคราว

| # | ปัญหา | ผลที่เกิด | ที่ | แก้ที่ |
|---|---|---|---|---|
| **R1** | Python ถือว่า result ที่ไม่รู้จัก (รวม 500) = **สำเร็จ** | นับ qty แล้ว แต่ DB ไม่ update + ไม่ส่ง A5 → ถาดไป completed ไม่ได้ (`NOT_ON_MACHINE`) = **งานค้าง** | [main_dll.py:267-300](service/main_dll.py#L267-L300) | เฟส 3 (exe) |
| **R2** | SP ตอน error คืน `ERROR_MESSAGE() AS result` ด้วย 200 · `ROLLBACK` ไม่เช็ค `@@TRANCOUNT` → deadlock แล้ว error ซ้อน (3903) → 500 | ทั้งสองทางไปจบที่ R1 | SP `tray_on_machine`, `tray_after_washing`, `tray_completed` | SQL 1 บรรทัด/SP |
| **R3** | A7: `pop` state **ก่อน** POST | ส่งพลาด = หายถาวร AS400 ไม่ได้ MOVE_OUT | [main_dll.py:364-387](service/main_dll.py#L364-L387) | เฟส 3 |
| **R4** | A2: `lot_tags.pop` ทำไม่ว่าส่งสำเร็จหรือไม่ | ส่งพลาด = หายถาวร | [main_dll.py:529-537](service/main_dll.py#L529-L537) | เฟส 3 |
| **R5** | A6: `lot_checked.add` **ก่อน** POST | ส่งพลาด = ไม่ส่งอีก | [main_dll.py:328](service/main_dll.py#L328) | เฟส 3 |
| **R6** | pallet: tag ถูกใส่ `tags_on_pallet` **ก่อน** `/lot-by-tag` → lookup พลาดครั้งเดียว tag หลุดจาก lot ถาวร | lot ไม่ครบ = **A1 ไม่ยิงเลย** | [main_dll.py:466-478](service/main_dll.py#L466-L478) | เฟส 3 |
| **R7** | `logToDB` พลาด (pool เต็ม / DB สะดุด) → ไม่มีแถว log → ไม่ส่ง AS400 → `retryErrors` มองไม่เห็น | หายเงียบ | [as400.js:22](backend/routes/as400.js#L22) ทุกจุดที่เรียก | เฟส 1 |
| **R8** | AS400 รับแล้ว แต่ `updateStatus` เขียนไม่ได้ → แถวค้าง `PENDING` ตลอดไป · ไม่มีใครดู | ข้อมูลไม่ตรงกัน ไม่มีใครรู้ | [as400.js:49-70](backend/routes/as400.js#L49-L70) | เฟส 1 (แค่แจ้งเตือน — **ห้ามส่งซ้ำอัตโนมัติ** จนกว่ารู้เรื่อง trackId) |

**ห่วงโซ่ที่อันตรายที่สุด:** IT API ตอบ error เร็ว (500 / ต่อไม่ได้) → `/on-machine` ไม่มี fallback ([rfid.js:416-423](backend/routes/rfid.js#L416-L423)) → 500 → **R1** → ถาดถูกนับว่าขึ้นเครื่องทั้งที่ไม่ได้ update

---

## 3. 🟠 คอขวดเมื่อขยาย 99 readers

| # | ปัญหา | ที่ | แก้ที่ | ความเร่ง |
|---|---|---|---|---|
| **S1** | SQL pool = 10 (default) · เต็มแล้วรอ 60 วิ แต่ Python รอ 5 วิ | `database.js` | **ผู้ใช้แก้เอง** | สูง |
| **S2** | IT API ไม่มี timeout · `withCache` ไม่กันยิงซ้อน (cache หมด = ทุกเครื่องยิงพร้อมกัน) · `/on-machine` ไม่มี fallback cache เก่า | [rfid.js:21-33](backend/routes/rfid.js#L21-L33), [:416-423](backend/routes/rfid.js#L416-L423) | เฟส 1 | สูง |
| **S3** | `/status` ยิงหา Python **ทุกตัว** ทุกครั้ง · ถูก poll จาก 3 หน้า (ReaderStatus 3 วิ, ReaderConfig 3 วิ, MbrMonitor 5 วิ) × จำนวนจอ | [rfid.js:152](backend/routes/rfid.js#L152) | เฟส 1 (cache 2 วิ) | สูง |
| **S4** | `tb_rfid_as400_log` ไม่มี index `tag_id`, `status` → table scan ทุกครั้งที่ถาดใหม่ขึ้นเครื่อง · ตารางโต ~30+ แถว/lot ไม่เคยลบ | SQL | SQL (script ด้านล่าง) | สูง (ง่ายสุด) |
| **S5** | `retryErrors` ส่งทีละแถว แถวละ ≤8 วิ · ไม่กันรอบทับ · ไม่มี cap | [as400.js:328](backend/routes/as400.js#L328), [server.js:22](backend/server.js#L22) | เฟส 1 | กลาง |
| **S6** | washing / completed ยิง Node **ทุก tag ทุก 3 วิ** ขณะถาดค้างหน้า reader (50 ถาด ≈ 17 req/วิ/reader) | [main_dll.py:155](service/main_dll.py#L155), [:415](service/main_dll.py#L415) | เฟส 3 | ขึ้นกับหน้างาน |
| **S7** | completed: `time.sleep(1)` **ต่อ tag** ที่ได้ `NOT_ON_MACHINE` อยู่ใน loop → ถาดค้าง N ใบ = ถาดใหม่รอ N วิ (ข้อมูลไม่หาย แค่ช้า) · ตอนนี้ reader completed ปิดอยู่ | [main_dll.py:425](service/main_dll.py#L425) | เฟส 3 | กลาง |
| **S8** | **TagSearch: stale closure** — `tagData` ใน `setInterval` ค้างเป็น `{}` ตลอด → เรียก `/lot-by-tag` **ทุก tag ทุกวินาที** พร้อมกัน (50 tag = 50 SQL/วิ ต่อ 1 จอ) | [TagSearch.js:83-93](frontend/src/pages/nht_washing/TagSearch.js#L83-L93) | frontend (ไม่ต้อง build exe) | กลาง |
| **S9** | on_machine เรียก SP 4 ครั้งต่อถาด (`last_event` + `lot_select` ×2 + `tray_on_machine`) · ลดเหลือ 2 ได้ | [main_dll.py:240-318](service/main_dll.py#L240-L318) | เฟส 3 | ต่ำ |
| **S10** | pallet เรียก `/pallet` ทีละ tag · แต่ละครั้ง SP update **ทุกถาดของ lot** (10 ถาด = 100 row updates) | [main_dll.py:501-508](service/main_dll.py#L501-L508) | เฟส 3 (pallet batch — **ไม่เร่งแล้ว**) | ต่ำ |
| **S11** | Dashboard `fetchMonitor` เรียก `/dashboard` **ไม่ส่งวันที่** ทุก 3 นาที → Node รัน `dashboard_history` ด้วย NULL แล้วทิ้งผล · ถ้า SP คืนทั้งหมดเมื่อ NULL = หนักขึ้นเรื่อยๆ | [Dashboard.js:83](frontend/src/pages/nht_washing/Dashboard.js#L83) | ต้องดู SP ก่อน | ยังไม่ยืนยัน |
| **S12** | `start_rfid.py` เรียก `netstat` + `sleep(3)` ต่อ reader · restart ตัวที่ crash ก็ `sleep(3)` บล็อก loop → 99 ตัว boot ช้า 2-3 นาที | [start_rfid.py:13-29](service/start_rfid.py#L13-L29), [:109](service/start_rfid.py#L109) | ว่างค่อยทำ | ต่ำ |
| **S13** | Python สร้าง httpx connection ใหม่ทุกครั้ง | `main_dll.py` 15 จุด | ว่างค่อยทำ | ต่ำ |

---

## 4. 🟡 การดูแลระบบ (Operations)

| # | ปัญหา | ทางแก้ | ข้อควรระวัง |
|---|---|---|---|
| **O1** | ดูงานผ่าน terminal · 99 process พิมพ์ลงหน้าต่างเดียว | รัน `start_rfid.py` และ Node backend เป็น **Windows Service** (NSSM) → reboot แล้วขึ้นเอง crash แล้ว restart เอง | service อยู่ session 0 → `winsound.Beep` บน PC **อาจไม่มีเสียง** · relay → PLC ยังทำงานปกติ |
| **O2** | ไม่มี log file | log แยกไฟล์ต่อ reader + rotate | disk เต็มถ้าไม่ rotate |
| **O3** | ไม่รู้ว่าระบบป่วย จนงานค้าง | หน้า Monitor: connected, scan ล่าสุด, คิวค้างส่ง, จำนวน `ERROR` / `PENDING` ค้าง, error ล่าสุด | — |
| **O4** | `/new-tag` อ่านแล้วล้าง → 2 จอชี้ location เดียวกันแย่ง tag | กฎ: **1 reader = 1 จอ** | — |

---

## 5. ✅ ตรวจแล้วไม่เป็นปัญหา

| # | เรื่อง | เหตุผล |
|---|---|---|
| C1 | การสแกน | reader แต่ละตัวมี process + TCP ของตัวเอง · scan ไม่เรียก Node |
| C2 | on_machine / pallet / register ขณะถาดวางนิ่ง | เรียก Node **0 ครั้ง** — เฉพาะตอนเข้า/ออก |
| C3 | Node รอ AS400 | ไม่รอ — ทุกจุด fire-and-forget |
| C4 | Index หลัก | `tray.tag_id`, `tray.barcode`, `lot.barcode` มีครบ → `lot_select_by_tagid` เร็ว |
| C5 | Race ใน SP เมื่อ lot เดียวกันเข้า 2 reader พร้อมกัน | RCSI = OFF → กลายเป็น deadlock (มีเสียงดัง) ไม่ใช่นับขาดเงียบๆ · แก้ R1+R2 แล้ว ตัวที่แพ้จะลองใหม่และนับถูก · ⚠️ **ห้ามเปิด RCSI โดยไม่แก้ SP** |
| C6 | **A1 ส่งกี่ครั้งต่อ lot** | **ครั้งเดียว** — `lot_update_location` ครั้งแรก update **ทุกถาดของ lot** ใน transaction เดียวแล้วคืน `OK` → A1 · tag ถัดไป `@lastlocation = @location` → `DUPLICATE_LOCATION` → Node ไม่ส่ง A1 · **ตรง requirement แล้ว** · HANDOFF 7.6 ที่ว่า "A1 10 ครั้ง" **ผิด** · ยังได้ของแถม: ครั้งแรกพลาด tag ถัดไปจะส่งแทนเอง |
| C7 | A3/A4 ส่งซ้ำเมื่อถาดสุดท้ายถูกอ่านซ้ำ | **ไม่ซ้ำ** — ครั้งที่ 2 ถาดเป็น `after_washing` แล้ว → `NOT_READY` |
| C8 | `lot_update_location` rollback | มี `IF @@TRANCOUNT > 0` แล้ว ✅ |
| C9 | completed race | reader ตัวเดียว + Python ส่งทีละ tag → ไม่มี race |

---

## 6. ลำดับการทำ + ผลเสียที่อาจเกิด

```
0 Deploy ของเดิม → 1 SQL → 2 เฟส 1 (backend + frontend) → 3 เฟส 2 กันซ้ำ → 4 เฟส 3 Python
                                                            ↑ รอ IT ตอบ trackId
5 Operations (service / log / monitor) ทำคู่ขนานได้
```

| ขั้น | งาน | ใครทำ / build exe | แก้ข้อ | ผลเสียที่อาจเกิด |
|---|---|---|---|---|
| **0** | deploy งานค้าง (proxy, UI, `USE_EXE`, exe ใหม่) | ผม+คุณ / ✅ | — | ลืมลบ `_internal\` เก่า · proxy ยังไม่เคยเทสบน server จริง |
| **1** | index 2 ตัว · `IF @@TRANCOUNT > 0` ใน 3 SP · เช็ค index `tb_rfid_log` | คุณ / ❌ | S4, R2 | เขียนช้าลงเล็กน้อย · R2 ได้ผลเต็มหลังขั้น 4 |
| **2** | pool 50 · IT API timeout + กันซ้อน + fallback · cache `/status` · `retryErrors` กันทับ + cap · ตาข่าย `logToDB` · แจ้งเตือน `PENDING` ค้าง · แก้ TagSearch | คุณ (pool, คอลัมน์ retry) + ผม / ❌ | S1, S2, S3, S5, S8, R7, R8 | cache เก่าตอน IT ล่มอาจเช็ค part ผิดถ้าเครื่องเพิ่งเปลี่ยน part · alarm บนจอช้าลง ≤2 วิ · แถวที่เกิน cap เป็น `FAILED` ต้องมีคนจัดการ |
| **3** | ตาราง dedup + `event_id` | คุณ (SQL) + ผม / ❌ | ทำให้ขั้น 4 ปลอดภัย | SQL เขียนเพิ่ม 1 ครั้ง/event · ต้องมีงานล้างข้อมูลเก่า |
| **4** | Outbox + whitelist result + แก้ลำดับ pop/add + washing/completed ยิงครั้งเดียวต่อรอบ + ลด SP on_machine + (optional) pallet batch | ผม / ✅ | R1, R3–R6, S6, S7, S9, S10 | **ใหญ่สุด** กระทบทุก reader · ต้องเทส reader ตัวเดียวก่อน · ข้ามขั้น 3 = ข้อมูลซ้ำ |
| **5** | NSSM · log file · หน้า Monitor | ผม+คุณ / ❌ | O1–O3 | เสียง beep บน PC อาจหาย |

### SQL สำหรับขั้น 1

```sql
-- S4: index บน tb_rfid_as400_log
CREATE NONCLUSTERED INDEX Index_tb_rfid_as400_log_tag_id
ON tb_rfid_as400_log (tag_id, timestamp DESC)
INCLUDE (event_type, status);

CREATE NONCLUSTERED INDEX Index_tb_rfid_as400_log_status
ON tb_rfid_as400_log (status, timestamp)
INCLUDE (api_type);

-- ย้อนกลับ
-- DROP INDEX Index_tb_rfid_as400_log_tag_id ON tb_rfid_as400_log;
-- DROP INDEX Index_tb_rfid_as400_log_status ON tb_rfid_as400_log;

-- R2: ใน BEGIN CATCH ของ tray_on_machine, tray_after_washing, tray_completed
--     ROLLBACK TRANSACTION
--  →  IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION

-- เช็ค index ของตาราง log (lot_update_location อ่าน tb_rfid_log ด้วย barcode ORDER BY created_at)
EXEC sp_helpindex 'tb_rfid_log';
EXEC sp_helpindex 'tb_rfid_tray_log';
```

---

## 7. ความเสี่ยงที่เหลือแม้ทำครบ (ไม่ใช่โค้ดเรา)

| เรื่อง | เหตุผล |
|---|---|
| AS400 timeout = SUCCESS | ข้อตกลงเดิม · ถ้า AS400 timeout แล้วไม่ได้บันทึกจริง เราไม่รู้ |
| trackId dedup ฝั่ง AS400 | ถ้า AS400 ทิ้ง trackId ซ้ำ → A6/A7/รอบ 2 หายที่ AS400 |
| RF อ่านไม่ได้ | tag เสีย · โลหะบัง · วิ่งผ่านเร็วเกิน · 50 tag อาจต้องปรับ `Qvalue` (ตอนนี้ 4) — ปรับเมื่อเจออาการเท่านั้น |
| ลำดับ A1/A2 ตอนย้าย pallet | รอ IT |

---

## 8. คำถามที่รอคำตอบ

| # | ถามใคร | คำถาม |
|---|---|---|
| ~~1~~ | ~~IT~~ | ✅ **ตอบแล้ว (2026-09-28):** AS400 **ไม่** dedup — trackId ซ้ำได้ SUCCESS ทุกครั้งและบันทึกทุกครั้ง → ข้อมูลตอนนี้ไม่หาย แต่ **ส่งซ้ำ = AS400 นับซ้ำ** → retry ต้องส่งซ้ำเฉพาะตอนมั่นใจว่ายังไม่ถึง · และยืนยันแล้วว่า **timeout = SUCCESS ถูกต้อง** (G5185798 PALLET_IN timeout แต่มีบน AS400) |
| 2 | IT | AS400 รับ pallet-in จุดใหม่ ก่อน pallet-out จุดเดิมได้ไหม |
| 3 | ผู้ใช้ | ถาดที่ reader washing / completed วิ่งผ่านไปเลย หรือวางค้าง (ตัดสินความเร่งของ S6/S7) |
| 4 | ผู้ใช้ | **ถาดถูกยกออกจาก pallet แล้ววางกลับ pallet เดิม** เกิดได้ไหม — ถ้าได้: A2 ถูกส่งไปแล้ว แต่วางกลับได้ `DUPLICATE_LOCATION` → ไม่ส่ง A1 ใหม่ → AS400 เห็นว่าออกจาก pallet แล้ว |
| 5 | ผู้ใช้ | ผล `sp_helpindex` ของ `tb_rfid_log`, `tb_rfid_tray_log` |
| 6 | ผู้ใช้ | SP `Stored_tb_rfid_dashboard_history` เมื่อ `date_from/date_to = NULL` คืนอะไร (S11) |
| 7 | ผู้ใช้ | บน server รัน Node backend ด้วยอะไร — crash แล้ว restart เองไหม |
