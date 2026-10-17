# บริบทสำหรับเริ่มแชทใหม่: RFID NHT Washing (อัปเดต 2026-10-06)

> วางไฟล์นี้เป็นข้อความแรกในแชทใหม่ เพื่อให้ Claude รู้บริบททั้งหมดโดยไม่ต้องอธิบายซ้ำ

---

## 0. บทบาทและกฎ (สำคัญที่สุด)

**บทบาท:** Senior fullstack programmer ประจำโรงงาน เชี่ยวชาญ RFID มีหน้าที่ช่วยแก้ ปรึกษา และเขียนโปรแกรมในโปรเจ็ค RFID NHT Washing

**กฎที่ต้องทำตามเสมอ:**
1. **ห้ามยุ่งกับไฟล์ `.env` และ `database.js`** ทั้งอ่านและแก้ ถ้าต้องเพิ่มค่า ให้บอกบรรทัดแล้วผู้ใช้จะใส่เอง
2. **ถ้าแก้หรือลบโค้ด ให้ comment โค้ดเก่าไว้ก่อนแล้วค่อยเขียนใหม่** เพื่อกันระบบพัง (ไฟล์ JSON ให้สำรองเป็น `.bak` แทน)
3. **ตอบสั้น** ขึ้นต้นด้วยสรุป ส่วนรายละเอียดยาวๆ ให้ใส่ไฟล์ .md
4. **ข้ามงานที่ประโยชน์น้อยได้เลย** ไม่ต้องถามทีละข้อ
5. **ไอเดียที่ผู้ใช้เสนอให้ถือเป็นการปรึกษาก่อน** ต้องสรุป scope (ไฟล์, SP, พฤติกรรมที่จะเปลี่ยน) แล้วรอคำว่า "ทำเลย" ก่อนแก้หลายไฟล์
6. **ระบบที่ใช้งานอยู่และทำงานได้ อย่าไปแตะ** ถ้าเจอความเสี่ยงที่ยังไม่เกิด ให้รายงานแล้วหยุด "ตอนนี้มันใช้ได้" ถือว่าเป็นคำตอบที่จบแล้ว
7. **แก้ `service/main_dll.py` ต้องถามก่อน** และทุกครั้งที่แก้ต้อง build exe ใหม่ (PyInstaller onedir) ถ้าแก้ไฟล์ .py บน server เฉยๆ จะไม่มีผล

---

## 1. สถาปัตยกรรมระบบ

| ส่วน | เทคโนโลยี | หมายเหตุ |
|---|---|---|
| Backend | Node.js 22 + Express 5 + mssql | port 2002 |
| Reader service | Python FastAPI รัน 1 process ต่อ 1 reader | เรียก `SID_U861.dll` ผ่าน ctypes แล้ว build เป็น exe ด้วย PyInstaller (onedir) |
| Frontend | React (CRA) | ขึ้นบน IIS port 2001 |
| DB | SQL Server | RCSI = OFF |
| ERP | AS400 | ส่งผ่าน `backend/routes/as400.js` |

- Proxy ไป reader: `/reader/:location/*splat`
- `constances.js` ใน frontend: บน dev ใช้ `localhost` **ต้องสลับเป็น `10.120.139.20` ก่อน build ขึ้น server**
- Python ตัวจริงอยู่ที่ `C:\Users\bptk654\AppData\Local\Programs\Python\Python314-32\python.exe` (ถ้าพิมพ์ `python` เปล่าๆ จะไปเจอ Store stub)
- Branch: `FinalRFID_1` · commit ล่าสุดคือ `570cd7f` และ**งานหลังจากนั้นยังไม่ได้ commit**

### AS400 transaction
| รหัส | ความหมาย |
|---|---|
| A1 | pallet-in |
| A2 | pallet-out |
| A3 | washing RUN |
| A4 | production-result |
| A5 | on-machine-in |
| A6 | checking |
| A7 | on-machine-out |

### ข้อเท็จจริงที่ยืนยันแล้ว
- **AS400 ไม่ dedup trackId** ถ้าส่งซ้ำ AS400 จะนับซ้ำ จึงส่งซ้ำได้เฉพาะตอนที่มั่นใจว่ารายการแรกยังไปไม่ถึง
- **timeout = SUCCESS** เป็นพฤติกรรมที่ถูกต้อง (ยืนยันจาก lot G5185798)
- SP `lot_update_location` อัปเดตทั้ง lot ตั้งแต่ tag แรก แล้วตอบ `DUPLICATE_LOCATION` ให้ tag ที่เหลือ ซึ่งเป็นเรื่องปกติ

---

## 2. สิ่งที่แก้ไปแล้ว (แยกตามไฟล์)

### SQL (`sql/`)
| ไฟล์ | ทำอะไร | สถานะ |
|---|---|---|
| `step1_1_as400_log_index.sql` | เพิ่ม index ให้ตาราง AS400 log | รันแล้ว |
| `step1_2_sp_rollback_trancount.sql` | ใส่ `IF @@TRANCOUNT > 0 ROLLBACK` ใน SP | รันแล้ว |
| `step1_3_rfid_log_index.sql` | เพิ่ม index ให้ `tb_rfid_log` | รันแล้ว |
| `step2_1_as400_log_pending_by_jobtag.sql` | FIFO ที่ผู้ใช้ปฏิเสธไป | **ไม่ต้องรัน** (เก็บไว้เฉยๆ) |
| `step3_1_dashboard_monitor_period.sql` | SP ใหม่ `Stored_tb_rfid_dashboard_monitor_period` + index `Index_tb_rfid_log_created_at` | ผู้ใช้ต้องรันเอง |

**SP `Stored_tb_rfid_dashboard_monitor_period @period = 'day'|'week'|'month'`**
- recordset 1 คือ summary ตาม sub_process (lot_count, total_qty) จาก `tb_rfid_log` ช่วง `@from` ถึง `@tomorrow`
- recordset 2 คือรายการ lot จาก `tb_rfid_lot`
- เดิมรายการ lot แสดง "วันนี้เสมอ" (`>= @today`) **ผู้ใช้ขอให้เปลี่ยนตาม period** โดยเปลี่ยนเป็น `WHERE l.updated_at >= @from AND l.updated_at < @tomorrow` แล้ว ALTER (ได้ snippet ไปใส่เองแล้ว)
- week นับจากวันจันทร์ (`DATEDIFF(DAY,'19000101',@today) % 7`) ส่วน month นับจากวันที่ 1

### `backend/routes/rfid.js`
- `withCache`: ใช้ `IT_API_TIMEOUT_MS` 8000, มี inflight dedup, ให้ใช้ข้อมูลเก่าได้ (`STALE_MAX_MS`) ไม่เกิน 2 ชม.
- `buildStatus` + cache `/status` 2 วินาที
- route ใหม่ `GET /dashboard/monitor?period=day|week|month` คืน `{ period, summary, lots }` **ต้องอยู่ก่อน `/dashboard/:barcode`**
- ⚠️ **ผู้ใช้ comment route `/dashboard` ไว้เอง** แต่แท็บ History ใน `Dashboard.js` ยังเรียก `/dashboard` อยู่ ดังนั้นหลัง restart แท็บ History จะพัง (เสนอให้คืน route แบบดึงเฉพาะ history แล้ว แต่ยังไม่ได้คำตอบ)
- งาน req 09-29 (A2 ที่ washing, ย้าย pallet) **ถูกย้อนออกแล้ว** เก็บไว้ที่ `rfid_backup.js`

### `backend/routes/as400.js`
- `logToDBOnce` + `logToDB`: ถ้าเขียน DB ไม่ได้จะลองใหม่ที่ [500ms, 1500ms] ถ้ายังพลาดอีกจะจดลง `backend/logs/as400_failed.jsonl`
- `retryErrorsOnce` + `retryErrors`: มี flag กันรอบ retry ทับกัน
- FIFO ต่อ jobtag **ไม่ได้ทำ** (ผู้ใช้บอก "ยังไม่จำเป็นขนาดนั้น")

### `service/main_dll.py` (เวอร์ชัน commit 570cd7f / 09-28)
- `ON_MACHINE_RETRY_DELAY` / `SEND_RETRY_DELAY` / `PALLET_LOOKUP_RETRY` = 10
- `post_node` / `send_or_queue` / `cancel_out_if_back` / `flush_send_retry`
- on_machine whitelist: `OK` / `LOT_ON_MACHINE`
- pallet loop แบบเดิม + 4.3 (`lot_answered`)
- ฟีเจอร์เขียน log file (5.2) **ถอดออกแล้ว** เพราะผู้ใช้ดูทุกอย่างผ่าน database
- pallet v2 (pallet ไม่สแกน loop) **ย้อนออกแล้ว** เก็บไว้ที่ `main_backup.py`

### `frontend/src/pages/nht_washing/TagSearch.js`
- `LOT_REFRESH_MS` = 10 วินาที, `lastFetchRef`
- เพิ่มช่องค้นหา Job/Barcode (`jobSearch`, `visibleTags`, `jobSummary` แสดงถาดที่เจอและถาดที่หายไป, `loadingCount`)

### `frontend/src/pages/nht_washing/Dashboard.js` (แท็บ Monitor)
- `STEP_COLOR.completed = 'text-gray-300'`, `CARD_STEPS = [...STEPS, 'completed']`
- `PERIODS` = วันนี้ / สัปดาห์นี้ / เดือนนี้ และมี state `period`
- `fetchMonitor(p = period)` เรียก `/dashboard/monitor` แล้ว refresh ทุก 3 นาที (useEffect ตาม `[period]`)
- card แสดงแค่ Qty (ผู้ใช้ไม่อยากให้แสดงจำนวน lot)
- หัวตารางกับข้อความตอนตารางว่างเปลี่ยนตาม period: `Lots {PERIODS.find(p => p.key === period)?.label}` (ได้ snippet ไปใส่เองแล้ว)

### เอกสารใน repo
`HANDOFF.md`, `CHANGELOG_2026-09-23.md`, `CHANGELOG_2026-09-28.md` (6.5 คืองาน 09-29 ที่ย้อนออกแล้ว, 6.6 คือ Dashboard), `SYSTEM_REVIEW_2026-09-28.md`, `TEST_PLAN_2026-09-28.md` (มี C2, P4), `DEPLOY_2026-09-28.md` (NSSM)

---

## 3. ปัญหาที่รู้แล้วแต่ตั้งใจยังไม่แก้
- จังหวะเวลา pallet ซ้อนกัน (pallet timing stack)
- ช่องว่างตอน retry หา lot (lot-resolve retry gap)
- ยังไม่มีเพดานจำนวน retry (retry cap)
- pallet เดียวกันที่ location เดียวกันแต่คนละ IP: ผู้ใช้วาง reader ห่างกันและไม่ได้สแกน lot เดียวกันพร้อมกัน จึง**ไม่ต้องแก้**

---

## 4. งานค้างและคำถามที่รอคำตอบ

**ผู้ใช้ต้องทำเอง**
- [ ] รัน `sql/step3_1_dashboard_monitor_period.sql` แล้ว ALTER ส่วนรายการ lot เป็น `@from`
- [ ] restart backend (ถ้าไม่ restart, `/dashboard/monitor` จะไปเข้า `/dashboard/:barcode` แล้วได้ `{"lot":null,"rows":[]}`)
- [ ] deploy ตาม `DEPLOY_2026-09-28.md`
- [ ] commit งานหลัง `570cd7f`
- [ ] สลับ `constances.js` เป็น IP server ก่อน build frontend

**คำถามที่ยังไม่ได้คำตอบ**
1. จะคืน route `/dashboard` (เฉพาะ history) ไหม? ถ้าไม่คืน แท็บ History จะพัง
2. ให้ `constances.js` สลับ localhost/server อัตโนมัติด้วย `NODE_ENV` ไหม
3. จะใช้ pm2 หรือ NSSM
4. alarm ดับเมื่อมีถาดที่ถูกเข้ามา ทั้งที่ถาดผิด part ยังวางอยู่ ตั้งใจให้เป็นแบบนี้ไหม
5. มีถาดวางค้างหน้า reader washing/completed ไหม
6. ขอ SP `lot_insert` (เพื่อตรวจว่า card Registered มีข้อมูลไหม เพราะต้องพึ่งแถว `registered` ใน `tb_rfid_log` และใช้ไล่เรื่อง mockup)

**เรื่อง mockup**
- ผูก tag ไม่ได้เพราะได้ `PART_NOT_FOUND` น่าจะเป็นเพราะ part ไม่อยู่ใน `tb_master_tray`
- MultiRegister เรียก IT job-ticket ก่อนเสมอ
- ⚠️ ข้อมูล mockup จะถูกส่งไป AS400 จริง ให้เช็ค AS400 URL ใน `.env` ก่อน

---

## 5. ประวัติการตัดสินใจ (สั้นๆ)
- เรื่องคอขวดตอนมี 100 reader: ทำขั้น 1 (index, rollback, cache, logToDB retry) แล้ว ส่วนขั้น 0 เลื่อนไปก่อน
- FIFO ใน as400.js: ผู้ใช้ปฏิเสธ
- ความต้องการใหม่ 09-29 (pallet ไม่สแกน loop, ส่ง A2 ตอนเข้า washing ก่อน A3/A4, เปลี่ยน pallet = ส่ง issue แล้ว receive ที่ location ใหม่): ทำไปแล้ว**แต่ผู้ใช้ย้อนกลับเอง** โค้ดใหม่อยู่ในไฟล์ `_backup`
- log file ใน main_dll: ถอดออกเพราะผู้ใช้ดูผ่าน DB และไม่ได้ตามดู pm2 log
- TagSearch: เลือกแบบ A (ช่องค้นหาช่องเดียว)
- Dashboard Monitor: card ตาม period, ตารางเปลี่ยนตาม period ด้วย, ไม่แสดงจำนวน lot บน card
