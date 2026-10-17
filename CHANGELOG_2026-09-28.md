# CHANGELOG — 2026-09-28

> สรุปทุกอย่างที่แก้ในรอบนี้: แก้ไฟล์ไหน · ทำอะไร · ทำไม · ได้อะไร · ผลเสีย · กระทบโค้ดเดิมอย่างไร
> โค้ดเดิมทุกจุดที่เปลี่ยน **comment ไว้แล้ว** ย้อนกลับได้ · เหตุผลเชิงลึกดู [`SYSTEM_REVIEW_2026-09-28.md`](SYSTEM_REVIEW_2026-09-28.md)

---

## ⚡ สรุปสั้น

**เป้าหมาย:** เตรียมระบบขยายเป็น 99 reader — ตัดคอขวด และทำให้ "ส่งพลาดแล้วไม่หาย / ไม่ค้าง"

**หลักสำคัญ:** ตอนระบบปกติ **ทำงานเหมือนเดิมทุกอย่าง** · ที่เปลี่ยนมีผลเฉพาะตอนมีปัญหา (DB ช้า, IT API ล่ม, Node ดับ, เปิดหลายจอ)
→ เทสแล้ว "ไม่รู้สึกต่าง" คือถูกต้อง

| ไฟล์ | แก้อะไร (ย่อ) | ตอนปกติ | build exe |
|---|---|---|---|
| SQL 3 ไฟล์ | index 3 ตัว + ROLLBACK ปลอดภัยใน 3 SP | เหมือนเดิม (เร็วขึ้นเมื่อข้อมูลเยอะ) | ❌ |
| `backend/database.js` | pool 10 → 50 (ผู้ใช้แก้เอง) | เหมือนเดิม | ❌ |
| `backend/routes/rfid.js` | IT API timeout + กันยิงซ้อน + cache เก่า · cache `/status` 2 วิ | เหมือนเดิม | ❌ |
| `backend/routes/as400.js` | retry กันรอบทับ · `logToDB` ลองใหม่ + ไฟล์สำรอง | เหมือนเดิม | ❌ |
| `frontend/.../TagSearch.js` | เลิกยิง SQL ทุกวินาที | สถานะ tag อัปเดตทุก 10 วิ (เดิม 1 วิ) | ❌ (build frontend) |
| `service/main_dll.py` | on_machine ไม่นับ error เป็นสำเร็จ · A7/A6/A2 ส่งไม่ถึงเข้าคิวลองใหม่ · pallet ลองใหม่ | เหมือนเดิม | ✅ |

**Contract ไม่เปลี่ยน:** URL, request, response ของทุก API เหมือนเดิม · หน้าเว็บ / Python / Node คุยกันแบบเดิม · ไม่มี table / คอลัมน์ใหม่

---

## 1. SQL

### 1.1 index บน `tb_rfid_as400_log` — [`sql/step1_1_as400_log_index.sql`](sql/step1_1_as400_log_index.sql)

| | |
|---|---|
| **แก้อะไร** | เพิ่ม index `(tag_id, timestamp DESC)` และ `(status, timestamp)` |
| **ทำไม** | `Stored_tb_rfid_last_on_machine_event` ถูกเรียก**ทุกครั้งที่ถาดใหม่ขึ้นเครื่อง** ค้นด้วย `tag_id` · `get_errors` ค้นด้วย `status` · เดิมมีแค่ index `jobtag` → ต้องไล่อ่านทั้งตาราง · ตารางนี้โต ~30 แถว/lot ไม่เคยลบ |
| **ได้อะไร** | ค้นหาเร็วเท่าเดิมแม้ตารางโตเป็นล้านแถว · ไม่ไปขวางการเขียน log ของเครื่องอื่น |
| **ผลเสีย** | INSERT ช้าลงระดับ ms (วัดไม่ได้) · ใช้ disk เพิ่มเล็กน้อย |
| **กระทบโค้ดเดิม** | ไม่กระทบ — ไม่แก้ SP / Node / Python |
| **ย้อนกลับ** | `DROP INDEX` (ท้ายไฟล์) |

### 1.2 ROLLBACK ปลอดภัย — [`sql/step1_2_sp_rollback_trancount.sql`](sql/step1_2_sp_rollback_trancount.sql)

| | |
|---|---|
| **แก้อะไร** | ใน `BEGIN CATCH` ของ `Stored_tb_rfid_tray_on_machine`, `_tray_after_washing`, `_tray_completed`: `ROLLBACK TRANSACTION` → `IF @@TRANCOUNT > 0 ROLLBACK TRANSACTION` (บรรทัดเดียวต่อ SP) |
| **ทำไม** | ตอน deadlock SQL rollback ให้เองไปแล้ว → สั่ง ROLLBACK ซ้ำ = error ซ้อน (3903) → Node ตอบ 500 และข้อความ error จริงหาย |
| **ได้อะไร** | SP คืนข้อความ error ตัวจริง · Python (หลังแก้ 4.1) ใช้ผลนี้ตัดสินว่าต้องลองใหม่ |
| **ผลเสีย** | ไม่มี — มีผลเฉพาะตอน SP error อยู่แล้ว |
| **กระทบโค้ดเดิม** | ตอนปกติเหมือนเดิมทุกอย่าง · `lot_update_location` มีอยู่แล้วไม่ได้แก้ |
| **ย้อนกลับ** | เอาบรรทัดเดิมกลับ |

### 1.3 index บน `tb_rfid_log` — [`sql/step1_3_rfid_log_index.sql`](sql/step1_3_rfid_log_index.sql)

| | |
|---|---|
| **แก้อะไร** | index `(barcode, created_at DESC) INCLUDE (location)` — script เช็คก่อน มีแล้วไม่สร้างซ้ำ |
| **ทำไม** | `lot_update_location` (pallet) อ่าน location ล่าสุดของ lot จากตารางนี้ **ภายใน transaction ที่ล็อกแถวไว้** ทุก tag |
| **ได้อะไร** | ล็อกสั้นลงตอน pallet confirm |
| **ผลเสีย / กระทบ / ย้อนกลับ** | เหมือน 1.1 |

---

## 2. `backend/database.js` (ผู้ใช้แก้เอง)

| | |
|---|---|
| **แก้อะไร** | เพิ่ม `pool: { max: 50, min: 0, idleTimeoutMillis: 30000 }` ใน `dbConfig` |
| **ทำไม** | default = 10 connection · เต็มแล้วรอ 60 วิ แต่ Python รอแค่ 5 วิ → คอขวดแรกเมื่อ 99 reader ยิงพร้อมกัน |
| **ได้อะไร** | รับงาน SQL พร้อมกันได้ 50 |
| **ผลเสีย** | SQL Server ใช้ RAM เพิ่มเล็กน้อยตอน connection เต็ม (คืนเองเมื่อว่าง 30 วิ) |
| **กระทบโค้ดเดิม** | ไม่กระทบ |

---

## 3. `backend/routes/rfid.js`

### 3.1 IT API: timeout + กันยิงซ้อน + ใช้ cache เก่า — [rfid.js:25-80](backend/routes/rfid.js#L25-L80)

| | |
|---|---|
| **แก้อะไร** | `withCache` ใหม่ ([rfid.js:40](backend/routes/rfid.js#L40)) · เพิ่ม `timeout: IT_API_TIMEOUT_MS` ทุกจุดที่เรียก IT API (machine-list, job-ticket, part-convert ×2) |
| **ทำไม** | (1) เดิมไม่มี timeout → IT ค้าง = Node ค้างรอไม่มีกำหนด (2) cache หมดอายุ → ทุก request ที่เข้าพร้อมกันยิง IT ซ้อน (76 เครื่อง = 76 ครั้ง) (3) IT ล่ม → error ทันที ทั้งที่มีข้อมูลเก่าใน cache |
| **ได้อะไร** | ยิง IT ครั้งเดียวแล้วแบ่งผล · IT ล่มยังเช็ค part ได้ด้วยข้อมูลเก่า · Node ไม่ค้าง |
| **ผลเสีย** | ช่วง IT ล่ม ใช้ข้อมูลเก่าได้ถึง 2 ชม. → ถ้าเครื่องเพิ่งเปลี่ยน part อาจเช็คผิด · ถ้า IT ปกติตอบช้ากว่า 8 วิ จะกลายเป็น error |
| **กระทบโค้ดเดิม** | ทุก route ที่ใช้ `withCache` / `getMachineList` ได้ผลแบบเดิม · response เหมือนเดิม |
| **ค่าที่ปรับได้** | `IT_API_TIMEOUT_MS = 8000` (**ห้ามต่ำกว่า 5000** — ต้องนานกว่า timeout ของ Python) · `STALE_MAX_MS = 2 ชม.` |
| **ข้อความใหม่ใน console** | `[cache] machine-list: IT API error (...) → ใช้ข้อมูลเก่า N นาที` |

### 3.2 cache `/status` 2 วิ — [rfid.js:206-280](backend/routes/rfid.js#L206-L280)

| | |
|---|---|
| **แก้อะไร** | route เดิมเปลี่ยนเป็นฟังก์ชัน `buildStatus()` (ไส้ในไม่แก้) · route ใหม่ cache ผล 2 วิ + กันยิงซ้อน |
| **ทำไม** | `/status` ถามหา Python **ทุกตัว** ทุกครั้งที่จอถาม · 3 หน้า poll (ReaderStatus 3 วิ, ReaderConfig 3 วิ, MbrMonitor 5 วิ) × จำนวนจอ → 99 reader × 5 จอ ≈ 150 req/วิ |
| **ได้อะไร** | ไม่เกิน ~50 req/วิ ไม่ว่าเปิดกี่จอ |
| **ผลเสีย** | สถานะบนจอช้าสุด 2 วิ (alarm บนจอช้าลงเล็กน้อย · **relay / PLC ไม่ช้า** เพราะ Python สั่งเอง) |
| **กระทบโค้ดเดิม** | response รูปแบบเดิมทุก field · หน้าเว็บไม่ต้องแก้ |

---

## 4. `backend/routes/as400.js`

### 4.1 `retryErrors` กันรอบทับ — [as400.js:373-440](backend/routes/as400.js#L373)

| | |
|---|---|
| **แก้อะไร** | ฟังก์ชันเดิมเปลี่ยนชื่อเป็น `retryErrorsOnce` (ไส้ในไม่แก้) · `retryErrors` ใหม่ครอบด้วย flag กันรอบซ้อน |
| **ทำไม** | 1 รอบส่งได้ถึง 100 แถว × 8 วิ = 800 วิ แต่ `server.js` เรียกทุก 300 วิ → AS400 ช้า = รอบใหม่ทับรอบเก่า = **ส่งแถวเดิมซ้ำไป AS400** (AS400 นับซ้ำ) |
| **ได้อะไร** | ไม่ส่งซ้ำจากรอบทับกัน |
| **ผลเสีย** | รอบถัดไปเลื่อนออกไปถ้ารอบก่อนนาน (ไม่เสียข้อมูล) |
| **กระทบโค้ดเดิม** | `server.js` ไม่ต้องแก้ · export ชื่อเดิม |
| **ข้อความใหม่** | `[retryErrors] ... รอบก่อนยังไม่เสร็จ → ข้ามรอบนี้` (เห็นบ่อย = AS400 ช้ามาก) |

### 4.2 ตาข่าย `logToDB` — [as400.js:24-85](backend/routes/as400.js#L24)

| | |
|---|---|
| **แก้อะไร** | ฟังก์ชันเดิมเปลี่ยนชื่อเป็น `logToDBOnce` (ไส้ในไม่แก้) · `logToDB` ใหม่: ลองใหม่ 3 ครั้ง (รอ 0.5 / 1.5 วิ) → ยังไม่ได้ จดลง `backend/logs/as400_failed.jsonl` แล้ว throw ต่อเหมือนเดิม |
| **ทำไม** | เดิม insert log พลาดครั้งเดียว (pool เต็ม / DB สะดุด) → ไม่ส่ง AS400 + ไม่มีแถว log → `retryErrors` มองไม่เห็น → **หายเงียบ ไม่มีร่องรอย** |
| **ได้อะไร** | DB สะดุดแป๊บเดียว → ผ่าน · DB ล่มนาน → มีหลักฐานในไฟล์ พร้อมข้อมูลครบให้ส่งซ้ำ |
| **ผลเสีย** | ตอน DB มีปัญหา การส่ง AS400 ช้าลง ≤ 2 วิ (ไม่กระทบ Python เพราะ `rfid.js` ไม่รอผล) · ยังไม่มีใครอ่านไฟล์นี้อัตโนมัติ |
| **กระทบโค้ดเดิม** | 7 จุดที่เรียก (A1-A7) ไม่ต้องแก้ · **จงใจไม่ส่ง AS400 เมื่อไม่มีแถว log** (เหมือนเดิม) เพราะตัวกันส่งซ้ำอ่านจากตารางนี้ |
| **ข้อความใหม่** | `[logToDB] <event> ครั้งที่ N พลาด: ...` · `→ ไม่ได้ส่ง AS400 · จดไว้ที่ ...` |

---

## 5. `frontend/src/pages/nht_washing/TagSearch.js`

| | |
|---|---|
| **แก้อะไร** | ใช้ `lastFetchRef` จำเวลาที่ดึงข้อมูลแต่ละ tag ([TagSearch.js:33](frontend/src/pages/nht_washing/TagSearch.js#L33)) · ดึงซ้ำได้ทุก `LOT_REFRESH_MS` = 10 วิ |
| **ทำไม** | บั๊ก stale closure: `setInterval` เห็น `tagData` เป็น `{}` ตลอด → ยิง `/lot-by-tag` **ทุก tag ทุกวินาทีพร้อมกัน** (50 tag = 50 SQL/วิ ต่อ 1 จอ) · tag ที่ไม่มีใน DB ก็ยิงซ้ำตลอด |
| **ได้อะไร** | SQL ลด ~10 เท่า |
| **ผลเสีย** | สถานะ tag บนจออัปเดตทุก 10 วิ (เดิม 1 วิ — ซึ่งเป็นผลจากบั๊ก) · ช่อง Search + Go ยังดึงสดเหมือนเดิม |
| **กระทบโค้ดเดิม** | หน้าตา / การใช้งานเหมือนเดิม · ปุ่ม ✕ ล้างแล้วดึงใหม่ทันที |

---

## 6. `service/main_dll.py` — ⚠️ ต้อง build exe ใหม่

### 6.1 on_machine ไม่นับ error เป็นสำเร็จ (ข้อ 4.1) — [main_dll.py:416](service/main_dll.py#L416), [:483](service/main_dll.py#L483), [:532](service/main_dll.py#L532)

| | |
|---|---|
| **แก้อะไร** | `/on-machine` ตอบ `OK` / `LOT_ON_MACHINE` เท่านั้นถึงนับว่าขึ้นเครื่อง · ตอบอย่างอื่น (500, ข้อความ error จาก SP) → ไม่นับ ลองใหม่หลัง 10 วิ · `last-on-machine-event` ตอบไม่ใช่ 200 → ไม่ส่ง `/on-machine` · ต่อ Node ไม่ได้ / timeout → เว้น 10 วิ (เดิมทุก 0.5 วิ) |
| **ทำไม** | **ต้นเหตุ "งานรันต่อไม่ได้"** — เดิม error ตกไป `else` = เส้นทางสำเร็จ → นับ qty แล้ว แต่ DB ไม่ได้ update + ไม่ส่ง A5 → ถาดไป completed ไม่ได้ (`NOT_ON_MACHINE`) · และ last-event 500 → ถือว่าเป็น tag ใหม่ → ส่ง A5 ซ้ำได้ |
| **ได้อะไร** | DB / Node / IT มีปัญหาชั่วคราว → ถาดถูกลองใหม่จนสำเร็จ ไม่ค้าง |
| **ผลเสีย** | ถาดที่เจอ error ถูกนับช้าลง ~10 วิต่อรอบที่พลาด · Node ล่มยาว = ข้อความ retry ขึ้นเรื่อยๆ |
| **กระทบโค้ดเดิม** | ทาง OK / RESTORE / PART_MISMATCH / NOT_WASHED **เหมือนเดิมทุกบรรทัด** · type อื่นไม่แตะ |
| **ข้อความใหม่** | `[on_machine] NOT CONFIRMED (HTTP ..) result=..: <tag> → retry in 10s` · `[on_machine] last-event HTTP 500: ...` |

### 6.2 A7 / A6 / A2 ส่งไม่ถึง → เข้าคิวลองใหม่ (ข้อ 4.2) — [main_dll.py:219-280](service/main_dll.py#L219)

| | |
|---|---|
| **แก้อะไร** | ฟังก์ชันใหม่ `post_node` / `send_or_queue` / `cancel_out_if_back` / `flush_send_retry` · A6 ([:523](service/main_dll.py#L523)), A7 ([:590](service/main_dll.py#L590)), A2 ([:780](service/main_dll.py#L780)) เปลี่ยนมาใช้ `send_or_queue` |
| **ทำไม** | เดิม state ถูกลบก่อน/ไม่ว่าส่งสำเร็จหรือไม่ + พลาดแล้วแค่ print → **A7 / A2 / A6 หายถาวร** AS400 ไม่ได้ MOVE_OUT |
| **หลักการ** | AS400 **ไม่** dedup trackId (ยืนยันแล้ว) → ส่งซ้ำ = นับซ้ำ → แยกผลส่ง 3 แบบ: **OK** จบ · **NOT_SENT** (ต่อไม่ติด / Node ตอบ error) เข้าคิวลองใหม่ทุก 10 วิ · **UNKNOWN** (timeout ระหว่างรอคำตอบ) **ไม่ส่งซ้ำ** ยกเว้น A2 เพราะ `as400.js` กันด้วย `ALREADY_OUT` |
| **ได้อะไร** | Node ดับ / DB ล่มชั่วคราว → OUT ไม่หาย ส่งตามให้เองเมื่อระบบกลับมา · ถาด / lot กลับมาหน้า reader ก่อนส่งสำเร็จ → ยกเลิก OUT อัตโนมัติ (AS400 ยังเห็น IN = ถูกต้อง) |
| **ผลเสีย** | คิวอยู่ใน memory → **Python restart ระหว่างรอ = คิวหาย** · กรณี UNKNOWN อาจหายได้ (เลือกหายดีกว่านับซ้ำ) |
| **กระทบโค้ดเดิม** | การนับ qty / ล้าง state / reset A6 **เหมือนเดิม** · เปลี่ยนเฉพาะตอนส่งไม่สำเร็จ |
| **ข้อความใหม่** | `[SEND QUEUED]` · `[SEND RETRY]` · `[SEND RETRY OK]` · `[SEND UNCERTAIN] ... ไม่ส่งซ้ำ` · `[SEND CANCELLED] ... ถาดกลับมาหน้า reader` |

### 6.3 pallet ลองใหม่ (ข้อ 4.3) — [main_dll.py:693](service/main_dll.py#L693), [:733](service/main_dll.py#L733)

| | |
|---|---|
| **แก้อะไร** | `/lot-by-tag` พลาด → เอา tag ออกจาก `tags_on_pallet` ลองใหม่หลัง 10 วิ · A1: ถ้าไม่มี tag ไหนได้ผลชัดเจนจาก SP (`OK` / `DUPLICATE_LOCATION` / `NOT_READY` / `TRAY_NOT_COMPLETE`) → ปลด `lot_confirmed` ให้ส่งรอบใหม่ |
| **ทำไม** | เดิม lookup พลาดครั้งเดียว → tag หลุดจาก lot ถาวร → lot ไม่ครบ → **A1 ไม่ถูกส่งเลย** · และ A1 ทุก tag พลาด → ไม่ส่งอีกเลย |
| **ได้อะไร** | lot บน pallet ได้ A1 แน่นอนเมื่อระบบกลับมา |
| **ผลเสีย** | tag ที่ lookup พลาดจะเข้า lot ช้าลง ~10 วิ |
| **กระทบโค้ดเดิม** | tag ที่ไม่มีใน DB (`found: false`) · `TRAY_NOT_COMPLETE` → **ไม่ลองซ้ำเหมือนเดิม** · ส่ง A1 ซ้ำปลอดภัย: SP คืน `DUPLICATE_LOCATION` → Node ไม่ส่ง A1 ซ้ำ |
| **ข้อความใหม่** | `[pallet] lot-by-tag error: ... → retry <tag> in 10s` · `[PALLET NOT CONFIRMED] lot=... → retry after 5s` |

### ~~6.4 log แยกไฟล์ต่อ reader (ข้อ 5.2)~~ — ❌ **ถอดออกแล้ว 2026-09-29**

> ผู้ใช้ดูงานผ่าน database อยู่แล้ว + pm2 / NSSM เก็บ log ของ process ให้อยู่แล้ว → ไม่จำเป็น
> ลบออกทั้งก้อน (ไม่ comment เพราะไม่เคยขึ้น production — ลบแล้วไฟล์กลับเป็นเหมือนต้นฉบับตรงจุดนั้น)
> ตารางด้านล่างเก็บไว้เป็นบันทึก ถ้าวันหลังอยากทำใหม่

| | |
|---|---|
| **เคยทำ** | `_DailyLogFile` + `_Tee` แทน `sys.stdout` / `sys.stderr` → `service/logs/<location>_<port>_<YYYY-MM-DD>.log` |

| | |
|---|---|
| **แก้อะไร** | `_DailyLogFile` + `_Tee` แทน `sys.stdout` / `sys.stderr` · ทุกบรรทัดที่ print ขึ้น console เหมือนเดิม **และ** ลง `service/logs/<location>_<port>_<YYYY-MM-DD>.log` |
| **ทำไม** | 99 process print ลง console เดียว อ่านไม่ออก · ปิดหน้าต่าง = log หาย · ถ้าทำเป็น Windows Service จะไม่มี console ให้ดูเลย |
| **ได้อะไร** | ดู log ย้อนหลังแยกทีละ reader · ขึ้นไฟล์ใหม่ทุกวัน · ลบไฟล์เก่ากว่า 30 วันเอง · หลาย thread พร้อมกันไม่ปนกลางบรรทัด |
| **ผลเสีย** | ใช้ disk (ข้อความเท่าที่ print อยู่แล้ว × 30 วัน) · เขียนไฟล์ไม่ได้ = ข้ามเงียบๆ (ไม่ crash) |
| **กระทบโค้ดเดิม** | ไม่ต้องแก้ print เดิมสักจุด · console เหมือนเดิม |
| **ค่าที่ปรับได้** | `LOG_KEEP_DAYS = 30` |

### ค่าคงที่ใหม่ใน `main_dll.py`

| ค่า | ค่า | ความหมาย |
|---|---|---|
| `ON_MACHINE_RETRY_DELAY` | 10 วิ | on_machine error → ลอง tag เดิมใหม่ (ต้อง > 8 วิ ของ AS400 timeout) |
| `SEND_RETRY_DELAY` | 10 วิ | คิว A7 / A6 / A2 ลองใหม่ทุกเท่านี้ |
| `PALLET_LOOKUP_RETRY` | 10 วิ | pallet `/lot-by-tag` พลาด → ลองใหม่ |

---

## 6.5 ⭐ Requirement ใหม่ 2026-09-29 — pallet ส่งทันที · A2 ย้ายไป washing

**Requirement (จากหัวหน้า):** pallet ไม่วน track แล้ว เห็น tag → อัปสถานะ + A1 ทันที · tag หายไม่ส่งอะไร · A2 (issue ออกจาก pallet) ย้ายไปส่งตอนล้างครบ lot **ก่อน A3 เสมอ**

```
เดิม   PALLET   ครบ lot → รอ 5 วิ → A1        ·  tag หาย ~75 วิ → A2
       WASHING  ล้างครบ lot → A3 → (5 วิ) → A4

ใหม่   PALLET   เห็น tag → A1 ทันที          ·  tag หาย → ไม่ทำอะไร
       WASHING  ล้างครบ lot → A2 → A3 → (5 วิ) → A4
```

### `service/main_dll.py` — `scan_loop_pallet` เขียนใหม่

| | |
|---|---|
| **แก้อะไร** | loop เดิม **comment ทั้งก้อน** (155 บรรทัด) · loop ใหม่ ~50 บรรทัด: เห็น tag ใหม่ → `POST /pallet` ทันที · ได้ผลชัดเจน (`OK` / `DUPLICATE_LOCATION` / `NOT_READY` / `TRAY_NOT_COMPLETE`) → จบ · error → ลองใหม่หลัง `PALLET_SEND_RETRY` 10 วิ · tag ออกจากระยะแล้วกลับมา → ส่งใหม่ 1 ครั้ง |
| **ทำไมส่งทันทีได้** | SP `lot_update_location` อัป **ทุกถาดของ lot** ตั้งแต่ tag แรก + Node ส่ง A1 · tag ที่เหลือได้ `DUPLICATE_LOCATION` → A1 ครั้งเดียวต่อ lot เหมือนเดิม |
| **ได้อะไร** | โค้ดสั้นลงมาก · A1 เร็วขึ้น (ไม่ต้องรอครบ lot + 5 วิ) · **ปัญหาเดิมหายหมด:** รอ ~75 วิ · reader 2 ตัวแบ่งกันเห็น lot · ยกถาดแล้ววางกลับ pallet เดิม · tag lookup พลาดแล้วหลุดจาก lot |
| **เปลี่ยนพฤติกรรม** | lot เปลี่ยนเป็น `before_washing` ตั้งแต่เห็นถาด**แรก** (เดิมรอครบทุกถาด) · ไม่เรียก `/lot-by-tag` และ `/pallet-lot-out` จาก pallet อีกแล้ว |
| **ผลเสีย** | ย้าย lot ไป pallet อื่น → A1 ที่ pallet ใหม่ แต่**ไม่มี A2 ออกจาก pallet เก่า** (A2 จะออกจาก pallet ล่าสุดตอน washing) — ถ้า AS400 ต้องการ OUT ของ pallet เก่าด้วย ต้องถาม IT |
| **ไม่ได้ใช้แล้ว (เก็บไว้สำหรับย้อนกลับ)** | `PALLET_IN_COOLDOWN`, `PALLET_OUT_COOLDOWN`, `PALLET_LOOKUP_RETRY`, ตัวแปร `tags_on_pallet` / `lot_tags` / ... · คิว `("A2", ...)` ใน `send_retry` |
| **ย้อนกลับ** | เอา comment ก้อน `SCAN LOOP — pallet (เดิม ...)` ออก แล้ว comment ตัวใหม่แทน |

### `backend/routes/rfid.js` — `/washing` เพิ่ม A2 ก่อน A3

| | |
|---|---|
| **แก้อะไร** | ใน background flow หลัง `LOT_WASHED`: เพิ่ม `await axios.post(/pallet-out)` **ก่อน** `/washing` (A3) · location = `tb_rfid_lot.location` (pallet ที่ lot วางล่าสุด) · ไม่มี location → ข้าม A2 + `console.warn` |
| **ลำดับรับประกันยังไง** | `await` = รอ `as400.js` ส่ง AS400 เสร็จ (หรือ timeout 8 วิ) ก่อนเริ่ม A3 |
| **กันส่งซ้ำ** | `as400.js /pallet-out` เช็ค last event = `PALLET_OUT` → `ALREADY_OUT` |
| **ผลเสีย** | A3 ช้าลงเท่าเวลาที่ AS400 ตอบ A2 (ปกติไม่กี่ร้อย ms · สูงสุด 8 วิ) · ⚠️ **กรณีเดียวที่ลำดับกลับ:** AS400 **ปฏิเสธ** A2 (ERROR ไม่ใช่ timeout) → A3/A4 ยังส่งตามปกติ แล้ว `retryErrors` ส่ง A2 ซ้ำภายหลัง → AS400 ได้ A2 หลัง A3 |
| **กระทบโค้ดเดิม** | Python ยังได้คำตอบทันทีเหมือนเดิม (flow อยู่เบื้องหลัง) · route `/pallet-lot-out` ยังอยู่ (ไม่มีใครเรียกแล้ว) |

### `backend/routes/rfid.js` — `/pallet` ย้าย pallet: A2 เก่า → A1 ใหม่

| | |
|---|---|
| **แก้อะไร** | อ่านสถานะ lot (`lot_select_by_tagid`) **ก่อน** SP อัป location · ถ้า SP ตอบ `OK` และ lot เคยเป็น `before_washing` ที่ location อื่น → ส่ง `/pallet-out` (A2 pallet เก่า) **ก่อน** (await) แล้วค่อย `/pallet-in` (A1 pallet ใหม่) · วางครั้งแรก (`registered`) → A1 อย่างเดียวเหมือนเดิม · `axios.post(pallet-in)` เดิม comment ไว้ |
| **ได้อะไร** | AS400 เห็นครบทุกการเคลื่อนย้าย: IN W1 → OUT W1 → IN W2 → (ล้าง) OUT W2 → RUN |
| **ผลเสีย** | `/pallet` เรียก SP เพิ่ม 1 ครั้งต่อ tag · ตอนย้าย pallet A1 ช้าลงเท่าเวลาที่ AS400 ตอบ A2 · กรณี AS400 **ปฏิเสธ** A2 → A1 ยังส่งตาม (เหมือนกรณี washing — ผู้ใช้ตัดสินใจไม่กัน) |
| **กระทบโค้ดเดิม** | Python ได้คำตอบทันทีเหมือนเดิม (AS400 ทำเบื้องหลัง) · result ที่ตอบ Python เหมือนเดิม |
| **เทส** | route จริง + DB / AS400 ปลอม 8/8 (ครั้งแรก, ย้าย, วางซ้ำ, กรณีขอบ, tag ไม่มีใน DB, ลำดับ A2 ก่อน A1) |

> ⏸️ `sql/step2_1_as400_log_pending_by_jobtag.sql` — ออกแบบไว้สำหรับกัน A3 แซง A2 แบบ 100% (FIFO ต่อ lot) · **ผู้ใช้ตัดสินใจว่ายังไม่จำเป็น** · ไม่ต้องรันตอน deploy · as400.js ไม่ได้แก้

**เทส:** Node `/washing` ตัวจริง + DB / AS400 ปลอม 7/7 (ลำดับ A2 → A3 → A4, A3 เริ่มหลัง A2 จบ, ไม่มี location, A2 พลาด, ยังไม่ครบ lot) · Python pallet loop ใหม่ 6/6 · regression เดิมผ่านครบ

---

## 6.6 Dashboard Monitor แยกตามช่วงเวลา (2026-10-05)

| ไฟล์ | แก้อะไร |
|---|---|
| `sql/step3_1_dashboard_monitor_period.sql` | SP ใหม่ `Stored_tb_rfid_dashboard_monitor_period @period` (day / week / month) · summary = ปริมาณที่ **เข้า** แต่ละ sub_process ในช่วงนั้น (จาก `tb_rfid_log`, นับ lot ไม่ซ้ำ) · lots = lot ที่ขยับ **วันนี้** (ทุกสถานะ) · ช่วงเวลาคำนวณใน SQL จาก `GETDATE()` · วันเริ่มเที่ยงคืน · สัปดาห์เริ่มจันทร์ · + index `tb_rfid_log(created_at)` · **SP เดิมไม่แก้** |
| `rfid.js` | route ใหม่ `GET /dashboard/monitor?period=` (วางก่อน `/dashboard/:barcode`) · period แปลก → day |
| `Dashboard.js` | ปุ่ม วันนี้ / สัปดาห์นี้ / เดือนนี้ บน card · เพิ่ม card Completed · card แสดงเฉพาะ Qty · ตาราง "Lots วันนี้" · refresh 3 นาทีตาม period ที่เลือก · ของเดิม comment ไว้ |

**ได้ของแถม:** Monitor เลิกเรียก `/dashboard` (ที่รัน SP history ด้วย NULL ทิ้งทุก 3 นาที — SYSTEM_REVIEW S11)
**⚠️ ลำดับ deploy:** สร้าง SP ก่อน แล้วค่อยขึ้น `rfid.js` / frontend ใหม่ — ไม่งั้นหน้า Monitor ว่าง (route ตอบ 500)
**ยังไม่ยืนยัน:** card Registered พึ่งแถว `sub_process = 'registered'` ใน `tb_rfid_log` ที่ SP `lot_insert` ต้องบันทึกไว้ (ยังไม่เคยเห็น SP นั้น)
**เทส:** route จริง + DB ปลอม 7/7 · `npm run build` ผ่าน · SP ยังไม่ได้รันกับ DB จริง

---

## 7. ไม่ได้แตะ

`server.js` · `start_rfid.py` · `sid_u861.py` · `readers_config.json` · `location_ports.json` · `.env` · หน้าเว็บอื่นทั้งหมด · Stored Procedure อื่นทั้งหมด · reader type washing / completed / register ใน Python

---

## 8. ตัดสินใจไม่ทำ (ประโยชน์น้อย)

| งาน | เหตุผล |
|---|---|
| retry cap (`retry_count`, `FAILED`) | แค่ลดการส่งซ้ำของแถวที่พังถาวร ไม่ได้แก้ข้อมูลหาย |
| แจ้งเตือนแถว PENDING ค้าง | เกิดยาก + แค่ทำให้เห็น · เช็คเองด้วย SQL ใน SYSTEM_REVIEW |
| washing / completed ยิงซ้ำทุก 3 วิ | ยังไม่รู้ว่าถาดค้างหน้า reader จริงไหม |
| outbox ลงไฟล์ | 6.2 ครอบคลุมเกือบหมดแล้ว เหลือแค่กรณี Python restart ระหว่างรอ |
| pallet batch / ลด SP on_machine | ประหยัด request ไม่ได้แก้ปัญหา · A1 ส่งครั้งเดียวต่อ lot อยู่แล้ว |

---

## 9. เทสที่ทำแล้ว

| ส่วน | วิธี | ผล |
|---|---|---|
| `rfid.js` withCache | ฟังก์ชันจริง · 76 request พร้อมกัน · IT ล่ม · cache เก่าเกิน | 10/10 |
| `rfid.js` /status | route จริงบน express + Python ปลอม | 7/7 |
| `as400.js` retry guard | ฟังก์ชันจริง + interval ถี่กว่าเวลาต่อรอบ | 4/4 |
| `as400.js` logToDB | ฟังก์ชันจริง · พลาด 1 ครั้ง / ทุกครั้ง / เขียนไฟล์ไม่ได้ | 7/7 |
| `main_dll.py` 4.1 | loop จริง + Node ปลอม 8 แบบ | 12/12 |
| `main_dll.py` 4.2 | แยกผลส่ง · A6 / A7 retry · timeout ไม่ส่งซ้ำ · ถาดกลับมายกเลิก | 11/11 |
| `main_dll.py` 4.3 | lookup retry · A1 retry · TRAY_NOT_COMPLETE ไม่ลองซ้ำ · A2 retry | 4/4 |
| ~~`main_dll.py` 5.2~~ | ถอดออกแล้ว · หลังถอดรันเทส 4.1-4.3 ซ้ำ ผ่านครบ | 27/27 |
| `main_dll.py` จริง | รันด้วย uvicorn + DLL จริง → `/status` ตอบ | ผ่าน |
| `TagSearch.js` | `npm run build` | ผ่าน |
| ผู้ใช้เทสบน dev | ตาม TEST_PLAN (ก่อนแก้ 4.2 / 4.3 / 5.2) | ผ่าน · ⬜ **ต้องเทส main_dll ซ้ำ** |

---

## 10. ย้อนกลับ

| ต้องการย้อน | ทำ |
|---|---|
| ทีละจุด | เปิดไฟล์ → หา comment `# เดิม:` / `// เดิม:` → เอาโค้ดเดิมที่ comment ไว้กลับ ลบโค้ดใหม่ |
| ทั้งหมดบน server | copy `*_backup_20260928\` กลับ (ดู [`DEPLOY_2026-09-28.md`](DEPLOY_2026-09-28.md) หัวข้อ 7) |
| SQL | `DROP INDEX` ท้ายไฟล์ step1_1 / step1_3 · SP เอาบรรทัด `ROLLBACK TRANSACTION` เดิมกลับ |
