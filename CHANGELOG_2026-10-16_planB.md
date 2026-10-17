# แก้ปัญหา data AS400 — ขั้น 1 + ขั้น 2 (แบบ B on-machine) · 2026-10-16

ไฟล์ก่อนแก้:
- `backup_2026-10-16_before_planB/` = ก่อนขั้น 1
- `backup_2026-10-16_planB_stage2/` = หลังขั้น 1, ก่อนขั้น 2

---

## สรุปสั้น

| ขั้น | ทำอะไร | สถานะ |
|---|---|---|
| 1.1 F5 | AS400 ตอบ `Process/Location different` → REJECTED หยุด retry | ✅ เทสบน dev แล้ว |
| 1.2 | งานด่วนไม่ส่ง A1 PALLET_IN (กัน RH 1201 BF ซ้ำกับ RS) | ✅ เทสบน dev แล้ว |
| 1.3 F1 | OUT ใช้ trackId ของ IN (แก้ข้ามเที่ยงคืน P3) | ✅ เทสบน dev แล้ว |
| Dashboard | Movement งานด่วนเติมแถว Receive 1201 BF (On-Hand ไม่ติดลบ) | ✅ |
| 2 แบบ B | on-machine IN ครั้งเดียว / OUT ที่ completed / checking ครั้งเดียว | ⏳ โค้ดเสร็จ + เทส logic แล้ว · **ยังไม่ได้เทสกับ reader จริง** |

---

## ขั้น 2 — แบบ B อธิบายละเอียด

### ปัญหาเดิม (จาก log วันแรก)
- **P1** ถาดวางนิ่งบนเครื่อง แต่ reader อ่านหลุดเป็นช่วงๆ → Python คิดว่าถาดออก → ส่ง A7 OUT → อ่านเจอใหม่ → ส่ง A5 IN → วนแบบนี้ (G6332797 ถึง 70 รอบ)
- **P5** CHECKING ส่งซ้ำ เพราะ Python จำ "ส่งแล้ว" ไว้แค่ตอน lot อยู่หน้า reader · lot หลุดแล้วกลับมา = ส่งใหม่
- checking N (part ไม่ตรง) ส่งทุกครั้งที่อ่านเจอถาด
- reader completed: ถาดวางกอง → ยิง `/completed` ทุก tag ทุก 3 วิ + tag ที่จบแล้วตอบ NOT_ON_MACHINE → sleep 1 วิ ต่อ tag → loop ช้า

### หลักคิดแบบ B
**"สถานะใน DB เป็นตัวตัดสิน ไม่ใช่การเห็น/ไม่เห็นหน้า reader"**
- ขึ้นเครื่อง (IN) = ครั้งเดียวต่อถาด ตัดสินจาก `tb_rfid_tray.sub_process = on_machine`
- ออกจากเครื่อง (OUT) = ตอนถาดผ่าน reader completed (ซึ่งเปลี่ยน DB เป็น completed ครั้งเดียวอยู่แล้ว)
- reader เครื่อง ใช้แค่ "แสดงผล" qty / alarm ที่หน้า MBR

### flow ใหม่
```
ถาดวางที่เครื่อง M1
  └─ Python: อ่านเจอต่อเนื่อง 10 วิ ─→ POST /on-machine
       └─ Node: เช็ค part กับเครื่อง
            ├─ ไม่ตรง → checking N (ครั้งเดียวต่อ lot ต่อเครื่อง) → Python alarm
            └─ ตรง → SP tray_on_machine
                 ├─ OK                 → A5 IN
                 ├─ LOT_ON_MACHINE     → A5 IN + checking Y (ถาดสุดท้ายของ lot)
                 └─ ALREADY_ON_MACHINE → ไม่ส่งอะไร (ถาดขึ้นไปแล้ว)
  └─ ถาดหายจาก reader 30 วิ → ลด qty ที่แสดงอย่างเดียว (ไม่ส่ง A7 แล้ว)

ถาดผ่าน reader completed
  └─ Python: POST /completed (tag ละครั้ง)
       └─ Node: SP tray_completed
            └─ OK / LOT_COMPLETED → A7 OUT (เครื่อง + trackId จากแถว A5 ของถาดนี้)
```

### แต่ละไฟล์แก้อะไร

**1. `sql/step6_1_tray_on_machine_already.sql`** — ALTER `Stored_tb_rfid_tray_on_machine`
- เพิ่มบล็อกเดียว: ถาดเป็น `on_machine` อยู่แล้ว → `SELECT 'ALREADY_ON_MACHINE'` แล้ว RETURN ไม่ update / ไม่ insert log
- ส่วนอื่นเหมือนเดิมทุกบรรทัด

**2. `sql/step6_2_as400_log_last_in_track_id_add_id.sql`** — ALTER SP step5_2
- เพิ่มคอลัมน์ `id` ใน SELECT อย่างเดียว (ใช้เทียบว่า IN หรือ OUT ใหม่กว่า)

**3. `backend/routes/rfid.js`**
- `sendCheckingNOnce` (บรรทัด ~102): checking N จำไว้ใน memory 12 ชม. ต่อ `jobtag|เครื่อง` · Node restart = ลืม → ส่งซ้ำได้ 1 ครั้ง
- `/on-machine` (~629): SP ตอบ `LOT_ON_MACHINE` → ส่ง checking Y โดยใช้ part ที่ match กับเครื่องจริง (หลัง part convert) → Y และ materialType ถูกตัว
  - เดิม Python ส่ง part_no ดิบ → ถ้า part ต้อง convert จะได้ N ผิดๆ
- `/completed` (~705):
  - ดึง jobtag + tray_qty ก่อน complete (หลัง complete ถาดเป็น status Completed ดึงไม่ได้)
  - SP ตอบ OK / LOT_COMPLETED → ส่ง A7
  - ครั้งต่อไป SP ตอบ NOT_ON_MACHINE → ไม่ส่งซ้ำ

**4. `backend/routes/as400.js`** — `/on-machine-out` (~394)
- `lastLogRow` (~381): ดึงแถว IN และ OUT ล่าสุดของถาด (jobtag + tag_id, ไม่นับ REJECTED)
- ตัวกัน:
  - ไม่มี IN → ไม่ส่ง (`SKIPPED_NO_IN`) · AS400 ไม่มีของให้ issue อยู่แล้ว
  - OUT ล่าสุดใหม่กว่า IN ล่าสุด → ไม่ส่ง (`SKIPPED_ALREADY_OUT`) · กันช่วงเปลี่ยนผ่านที่ Python ตัวเก่าส่ง A7 ไปแล้ว
  - ยังไม่รัน step6_2 / SP พัง → ส่งตามเดิม ไม่พัง
- `machine_no` ไม่ได้ส่งมา → ใช้เครื่องจากแถว IN
- trackId ใช้ของ IN (F1 ขั้น 1)

**5. `service/main_dll.py`**
- ค่าใหม่ (~46): `ON_MACHINE_STAY=10` `ON_MACHINE_LOST=5` `COMPLETED_DONE_TTL=600` `COMPLETED_RETRY_DELAY=30`
- dwell (~321): tag ต้องอ่านเจอต่อเนื่อง 10 วิ (หลุดเกิน 5 วิ = เริ่มนับใหม่) ก่อนยิง `/on-machine`
  - กันถาดที่ถือเดินผ่าน / อ่านชนเครื่องข้างๆ → ไม่ส่ง A5 ผิดเครื่อง ไม่ alarm มั่ว
- `ALREADY_ON_MACHINE` (~417): นับ qty แสดงผลเหมือน OK
- A6 (~439): comment ออก → Node ส่งแทน
- A7 (~532): comment ออก → เหลือแค่ลด qty ที่แสดง
- completed loop (~554): `skip_until` จำ tag
  - OK / LOT_COMPLETED → ไม่ยิงซ้ำ 10 นาที
  - NOT_ON_MACHINE → ลองใหม่ทุก 30 วิ
  - เอา `time.sleep(1)` ออก

### สถานการณ์ที่เช็คแล้ว (เทส logic)
| สถานการณ์ | ผล |
|---|---|
| reader อ่านหลุดแล้วอ่านใหม่ (P1) | A5 ครั้งเดียว ไม่มี A7 กลางทาง |
| ถาดถือผ่านไม่ถึง 10 วิ | ไม่ส่งอะไร ไม่ alarm |
| lot ครบบนเครื่อง | checking Y 1 ครั้ง · lot หลุดแล้วกลับมาก็ไม่ส่งซ้ำ |
| part ไม่ตรง อ่านซ้ำหลายรอบ | checking N 1 ครั้ง · alarm ยังดังทุกครั้ง |
| ถาดผ่าน completed | A7 1 แถว เครื่อง + trackId ตรงกับ IN |
| ถาดวางกองค้างที่ completed | ยิง /completed tag ละครั้ง |
| ถาดเก่าที่ Python ตัวเก่าส่ง A7 ไปแล้ว | ไม่ส่ง A7 ซ้ำ |
| ยังไม่รัน step6_2 / SP พัง | ส่ง A7 ตามเดิม ไม่พัง |

### ข้อจำกัดที่รู้อยู่
- ถาดไม่ผ่าน reader completed = ไม่มี A7 (หน้างานยืนยันว่าผ่านเสมอ)
- ถาดต้องวางนิ่ง 10 วิ ถึงนับ (ปรับ `ON_MACHINE_STAY`)
- ถ้ามีถาดของ lot ไป completed ก่อนถาดสุดท้ายขึ้นเครื่อง → SP ไม่ตอบ LOT_ON_MACHINE → ไม่มี checking Y (ไม่น่าเกิดในงานจริง)
- เครื่องผิดแต่ part เดียวกัน: dwell + ปรับ power reader ช่วยได้ แต่ระบบแยกไม่ออก 100%

---

## Deploy (ต้องทำพร้อมกัน)
1. SSMS บน server: `step5_2` (ถ้ายังไม่ได้รัน) → `step6_1` → `step6_2`
2. วาง `as400.js` + `rfid.js` → `pm2 restart 0`
3. build exe ใหม่จาก `main_dll.py` → หยุด service → วางทับ → start
4. frontend build ใหม่ (Dashboard Movement)

⚠️ Python ตัวเก่า + SP ใหม่ = เจอ `ALREADY_ON_MACHINE` แล้ว retry วนทุก 10 วิ (ไม่ส่งอะไรออก แต่ log รก) → อย่าทิ้งไว้นาน

## ย้อนกลับ
- SQL: ALTER `tray_on_machine` ด้วยตัวเดิม (ไม่มีบล็อก ALREADY_ON_MACHINE)
- โค้ด: copy จาก `backup_2026-10-16_planB_stage2/` ทับ แล้ว restart / build exe ใหม่

---

## ที่ยังเหลือ
- **ขั้น 0 (หน้างาน):** operator เลิกยิง A4 / 1201 ซ้ำ · ทดสอบ power reader อ่านชนเครื่องข้างๆ · ทดสอบกองถาดที่ completed
- **ขั้น 3 (รอ IT):**
  - production result ตัด issue 1201 BF ให้เองไหม → ถ้าใช่ ลบ A2 งานด่วน (+ Dashboard ต้องเติมแถว Issue เสมือน)
  - API location ปัจจุบัน → กันผูก tag กับ jobtag ที่ไป STOR BF / MBR แล้ว
  - แสดงเหตุผล alarm บนหน้า MBR (ทำพร้อม build exe รอบหน้า)
- **อื่นๆ:** สแกนเนอร์ยิงไปติดหน้าเว็บ (รอข้อมูล) · git commit (ยังไม่ได้ commit ตั้งแต่ 570cd7f)
