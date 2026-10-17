# HANDOFF — RFID NHT Washing

> ไฟล์ส่งต่องานสำหรับเริ่ม Claude Code chat ใหม่
> ครอบคลุมตั้งแต่ 2026-09-15 ถึง 2026-09-28
> รายละเอียดการแก้ Reader Proxy ดูเพิ่มที่ [`CHANGELOG_2026-09-23.md`](CHANGELOG_2026-09-23.md)

---

## ⚡ TL;DR — อ่านแค่นี้ก็พอ

**สถานะ (2026-09-28):** แก้คอขวด + ข้อมูลหาย **ครบตามแผนแล้ว** (ดูหัวข้อ 3.4) · เทสอัตโนมัติผ่านทั้งหมด · **ยังไม่ได้ deploy และยังไม่ได้ commit**

**ต้องทำต่อ:** deploy ตาม [`DEPLOY_2026-09-28.md`](DEPLOY_2026-09-28.md) (มีขั้นตอน build exe, SQL, copy, ตั้ง Windows Service, ย้อนกลับ)
- ⚠️ ก่อน `npm run build` สลับ `constances.js` จากชุด `localhost` → ชุด `10.120.139.20`
- ⚠️ exe ปัจจุบันเก่า (2026-09-17) ยังมี `NODE_URL = 1001` → ต้อง build ใหม่

**เอกสารรอบนี้:**
- [`CHANGELOG_2026-09-28.md`](CHANGELOG_2026-09-28.md) — **แก้ไฟล์ไหน อะไร ทำไม ได้อะไร ผลเสีย กระทบโค้ดเดิมยังไง** (อ่านอันนี้ก่อน)
- [`SYSTEM_REVIEW_2026-09-28.md`](SYSTEM_REVIEW_2026-09-28.md) — ตรวจทั้งระบบเพื่อขยาย 99 readers (R1-R8 ข้อมูลหาย · S1-S13 คอขวด · O1-O4 operations)
- [`TEST_PLAN_2026-09-28.md`](TEST_PLAN_2026-09-28.md) — เช็คลิสต์เทสบน dev
- [`DEPLOY_2026-09-28.md`](DEPLOY_2026-09-28.md) — ขั้นตอนขึ้น server
- `sql/step1_*.sql` — SQL ที่ต้องรันบน DB server

**ตอบแล้ว:** AS400 **ไม่** dedup trackId + timeout = SUCCESS ถูกต้อง (หัวข้อ 6)

---

## สารบัญ

1. [กฎการทำงาน — ต้องทำตาม](#1-กฎการทำงาน--ต้องทำตาม)
2. [ภาพรวมระบบ](#2-ภาพรวมระบบ)
3. [ประวัติการแก้ไข](#3-ประวัติการแก้ไข)
4. [สถานะปัจจุบัน](#4-สถานะปัจจุบัน)
5. [ขั้นตอน deploy ที่ค้างอยู่](#5-ขั้นตอน-deploy-ที่ค้างอยู่)
6. [คำถามที่รอคำตอบ](#6-คำถามที่รอคำตอบ)
7. [แผนงานถัดไป](#7-แผนงานถัดไป)
8. [ปัญหาที่รู้แล้วแต่ยังไม่แก้](#8-ปัญหาที่รู้แล้วแต่ยังไม่แก้)
9. [ข้อเท็จจริงสำคัญ / กับดัก](#9-ข้อเท็จจริงสำคัญ--กับดัก)
10. [แผนที่ไฟล์](#10-แผนที่ไฟล์)

---

## 1. กฎการทำงาน — ต้องทำตาม

| กฎ | รายละเอียด |
|---|---|
| **comment แทนการลบ** | ทุกครั้งที่ลบหรือแก้โค้ด ให้ comment โค้ดเดิมไว้แทนการลบ เพื่อย้อนกลับได้ — JSON ใส่ comment ไม่ได้ ให้สำรองเป็นไฟล์ `.bak` |
| **ห้ามอ่าน / แก้ `.env`** | ตรวจได้ทุกไฟล์ยกเว้น `.env` · ถ้าต้องเพิ่มค่าใน `.env` ให้บอกบรรทัดที่ต้องใส่ ผู้ใช้จะใส่เอง |
| **ไม่แตะของที่ใช้งานได้เพราะความเสี่ยงในทางทฤษฎี** | เจอความเสี่ยงที่ยังไม่เกิดอาการ → รายงาน + เสนอทางเลือก แล้ว **หยุด รอผู้ใช้ตัดสินใจ** · "ตอนนี้ระบบทำงานได้ปกติ" คือคำตอบที่สมบูรณ์ · แต่บั๊กที่เกิดอาการจริงแล้ว ผู้ใช้ต้องการให้แก้เร็ว |
| **ถามก่อนแก้โค้ดใหญ่** | โดยเฉพาะ `main_dll.py` (ต้อง build exe) และอะไรที่กระทบ reader ทุกตัว |
| **ตอบสั้น** | ผู้ใช้บอกว่าคำตอบยาวอ่านแล้วงง → สรุปก่อน รายละเอียดทีหลัง |
| **ทดสอบก่อนบอกว่าเสร็จ** | `node --check`, parse JSX, `npm run build`, เทส logic กับ config จริง — เคยจับบั๊กได้หลายตัวด้วยวิธีนี้ |

---

## 2. ภาพรวมระบบ

### 2.1 สถาปัตยกรรม

```
┌─ วง OT (ปิด) ─────────────────────────┐        ┌─ วง IT ────┐
│                                       │        │            │
│  RFID reader (ตอนนี้ 5 → แผน 99 ตัว)   │        │  Browser   │
│        │ TCP 6000                     │        │     │      │
│        ▼                              │        │     │      │
│  ┌─────────────────────────────┐      │  NAT   │     │      │
│  │ Server (VM)                 │      │ :2001 ─┼─────┤      │
│  │  Python × N  :8000-80xx  ◄──┼──┐   │ :2002 ─┼─────┘      │
│  │  Node.js     :2002       ◄──┼──┼───┤        │            │
│  │  IIS (web)   :2001          │  │   │        └────────────┘
│  │  SQL Server Standard        │  │   │
│  └─────────────────────────────┘  │   │
│         └── localhost ────────────┘   │
└───────────────────────────────────────┘
                   │
                   ▼  AS400 API (A1-A7)
```

- Server อยู่ **วง OT** เดียวกับ reader → Python คุยกับ reader ได้ตรงๆ ไม่ต้องขอ firewall
- Browser อยู่ **วง IT** → ต้องผ่าน NAT ของ IT
- IP ฝั่ง IT: `10.120.139.20` · IP ฝั่ง OT: `10.128.17.252`

### 2.2 ส่วนประกอบ

| ส่วน | เทคโนโลยี | หมายเหตุ |
|---|---|---|
| `backend/` | Node.js 22 + Express **5** + `mssql/msnodesqlv8` | ทุก DB access ผ่าน stored procedure · port 2002 |
| `service/` | Python FastAPI + uvicorn · `SID_U861.dll` ผ่าน ctypes | **1 process ต่อ 1 reader** · build เป็น exe ด้วย PyInstaller onedir |
| `frontend/` | React (CRA) · axios | config compile เข้า bundle ตอน build · IIS port 2001 |

### 2.3 Reader types

| type | ทำอะไร | ส่ง AS400 |
|---|---|---|
| `register` | ลงทะเบียน tag ↔ lot (หน้า MultiRegister) | — |
| `pallet` | ถาดเข้า/ออกพาเลท | A1 pallet-in · A2 pallet-out |
| `washing` | ถาดผ่านเครื่องล้าง | A3 washing · A4 washing-result |
| `on_machine` | ถาดขึ้น/ลงเครื่อง MBR | A5 on-machine-in · A6 checking · A7 on-machine-out |
| `completed` | จบงาน | — |

### 2.4 AS400 integration

- ทุก call ไป AS400 log ลง `tb_rfid_as400_log` สถานะ `PENDING → SUCCESS / ERROR`
- **timeout นับเป็น SUCCESS โดยตั้งใจ** — AS400 มักประมวลผลสำเร็จแม้ตอบช้า · ห้าม "แก้" โดยไม่ถาม
- `AS400_TIMEOUT_MS = 8000` (เพิ่มจาก 3000 เมื่อ 2026-09-15)
- `retryErrors` ส่งแถว `ERROR` ซ้ำทุก 5 นาที
- `trackId = ${process}${location}_${ddmmyyyy}_${jobtag}` — ไม่มีเวลา ไม่มี tag_id

### 2.5 Server ใหม่ (spec ยืนยันแล้ว)

| | |
|---|---|
| Hardware | Lenovo SR650 V4 · Xeon 6517P 16C · **128 GB RAM** · 10GbE × 4 |
| Disk | HDD 4TB 7.2K × 4 + SSD 480GB × 2 · RAID 545-8i (**ไม่มี write cache**) |
| Software | Windows Server 2025 · **SQL Server Standard** (ไม่ใช่ Express) · Hyper-V |
| ที่จะขอ IT | VM **8 vCPU / 24 GB RAM** · SQL data + log บน **SSD** · Node + Python + SQL อยู่ VM เดียวกัน |

### 2.6 แผนขยาย

register 4 · pallet 10 · washing 8 · on_machine (MBR) 76 · completed 1 = **99 readers**

---

## 3. ประวัติการแก้ไข

### 3.1 รอบ 2026-09-15 / 16 — review ทั้งระบบ + แก้บั๊ก

| เรื่อง | แก้อะไร |
|---|---|
| **ON_MACHINE_IN tag ที่ 2 ของ job ไม่ update** | ต้นเหตุ: SP `Stored_tb_rfid_last_on_machine_event` join `tb_rfid_as400_log.jobtag = tb_rfid_tray.barcode` (ระดับ lot) → tag ที่ 2 ถูกมองว่าขึ้นเครื่องแล้ว · **วิธีแก้: เพิ่มคอลัมน์ `tag_id` ใน `tb_rfid_as400_log`** แล้วให้ SP filter ด้วย `tag_id` ตรงๆ · ผู้ใช้แก้ SQL เอง · backend: `logToDB` ส่ง `tag_id`, `/on-machine-in` และ `/on-machine-out` ใส่ `tag_id` ใน payload, `rfid.js /on-machine` ส่ง `tag_id` ไป A5 · (เคยเสนอใช้ `sub_process` แต่ผู้ใช้ปฏิเสธเพราะไม่ต้องการเปลี่ยน process state) |
| **PALLET_IN ขึ้น ERROR ทั้งที่ AS400 รับแล้ว** | มีการเปลี่ยน `isTimeout ? 'SUCCESS' : 'ERROR'` เป็น `'ERROR'` ไว้ทดสอบ retry แล้วลืม → คืนค่าทั้ง 4 จุด |
| AS400 timeout บ่อย | `timeout: 3000` → `AS400_TIMEOUT_MS = 8000` |
| `/washing` บล็อก 5 วิ | เดิม await A3 + sleep 5 วิ + A4 ก่อนตอบ ชน Python timeout 5 วิ → เปลี่ยนเป็น fire-and-forget (background IIFE) |
| retry movement ไม่ส่ง qty | เพิ่ม `qty: row.production_qty` ใน `retryErrors` |
| re-entry on_machine | ความต้องการ: เอา tag ออกแล้วใส่ใหม่ ต้องส่ง receive (A5) / issue (A7) ใหม่ทุกรอบ → รองรับผ่าน `tag_id` ใน log |
| retry ของ A6 checking | ตัดสินใจแล้ว (option B) — รายละเอียดใน transcript session `b248625e` |
| A6 ขึ้น 2 แถวบนเว็บ AS400 | ตรวจแล้ว ฝั่งเราส่งครั้งเดียว → เป็นที่ฝั่ง IT |
| PyInstaller | สร้าง `rfid_service.spec` ใหม่ · build ด้วย `pyinstaller --clean rfid_service.spec` |
| `No module named uvicorn` | PATH เจอ Microsoft Store stub ของ `python.exe` แทนตัวจริง + ตอนนั้น `USE_EXE = False` |
| deploy แล้ว "ไม่อัปเดต" | PyInstaller onedir **ไม่ลบไฟล์เก่า** → ต้องลบ exe + `_internal/` เก่าก่อน copy |
| deploy แล้วสแกนไม่ลง DB | ต้นเหตุ: browser (วง IT) เข้า Python :8000/:8002 ไม่ได้ เพราะ IT เปิด NAT แค่ 2002 → ทางแก้ชั่วคราว: IT เปิด 2003/2004 |

### 3.2 รอบ 2026-09-22 / 23 — Reader Proxy + UI

**รายละเอียดเต็มดูที่ [`CHANGELOG_2026-09-23.md`](CHANGELOG_2026-09-23.md)**

| ไฟล์ | แก้อะไร |
|---|---|
| `backend/routes/rfid.js` | เพิ่ม `READER_HOST` env + route `router.all('/reader/:location/*splat')` — frontend คุยกับ Python ทุกตัวผ่าน Node port 2002 แยกด้วย path แทน port → **เลิกขอ NAT จาก IT ถาวร** |
| `frontend/src/config/instance.js` | เพิ่ม `readerApi(location)` |
| `TagSearch.js`, `MultiRegister.js`, `MachineValidate.js` | ย้ายมาใช้ `readerApi()` · เลิกโหลด `/location-ports` |
| `ReaderConfig.js` | `ID` → `Port` · port ซ้ำขึ้นขอบแดง + **บล็อก Save** · Add Location เป็น dropdown เลือก reader แทนพิมพ์ |
| `MasterTrayTab.js` | เพิ่ม search part no |
| `service/location_ports.json` | `REG1: 2004 → 8000` · ผู้ใช้เปลี่ยน `W1 → WS-04` + `8002` เอง · สำรองที่ `.bak` |

**Logic resolve ของ proxy:**
```
location มีใน location_ports.json ?
├─ มี   → port ตรงกับ reader จริงใน readers_config.json → ใช้ตัวนั้น / ไม่ตรง → 404
└─ ไม่มี → เทียบ location ของ reader เองตรงๆ (FL-06, COM)
```
เคยมีชั้น "เดา reader จาก type" → **ถอดออกแล้ว** เพราะเดาผิดแล้วคุยผิดตัวเงียบๆ

### 3.3 รอบ 2026-09-24 / 28 — วิเคราะห์การขยาย 99 readers + คอขวด

ยังไม่ได้แก้โค้ด · เป็นการวิเคราะห์และวางแผน (ดูหัวข้อ 7, 8)

### 3.4 รอบ 2026-09-28 — แก้คอขวด + ข้อมูลหาย (ทำจริงแล้ว)

**รายละเอียด / เหตุผล / ผลเสียแต่ละข้อ:** [`SYSTEM_REVIEW_2026-09-28.md`](SYSTEM_REVIEW_2026-09-28.md)

| ข้อ | ไฟล์ | แก้อะไร | เทส |
|---|---|---|---|
| 1.1 / 1.3 | `sql/step1_1_*.sql`, `step1_3_*.sql` | index `tb_rfid_as400_log(tag_id)`, `(status)` · `tb_rfid_log(barcode)` | ผู้ใช้รันบน dev แล้ว |
| 1.2 | `sql/step1_2_*.sql` | `IF @@TRANCOUNT > 0 ROLLBACK` ใน CATCH ของ `tray_on_machine`, `tray_after_washing`, `tray_completed` | — |
| 2.1 | `TagSearch.js` | stale closure ยิง `/lot-by-tag` ทุก tag ทุกวิ → ทุก 10 วิต่อ tag (`LOT_REFRESH_MS`) | build ผ่าน |
| 2.2 | `rfid.js` | IT API timeout 8 วิ (**จงใจ > 5 วิของ Python**) · กันยิงซ้อน (`inflight`) · ใช้ cache เก่า ≤ 2 ชม. (`STALE_MAX_MS`) | 10/10 |
| 2.3 | `rfid.js` | `/status` cache 2 วิ + กันยิงซ้อน (`buildStatus()`) | 7/7 |
| 2.4 | `as400.js` | `retryErrors` กันรอบทับ (`retryErrorsOnce` + flag) | 4/4 |
| 2.5 | `as400.js` | `logToDB` ลองใหม่ 3 ครั้ง → พลาดจดลง `backend/logs/as400_failed.jsonl` (**จงใจไม่ส่ง AS400** เมื่อไม่มีแถว log) | 7/7 |
| 2.7 | `database.js` | ผู้ใช้ใส่ `pool: { max: 50 }` เอง | — |
| 4.1 | `main_dll.py` | on_machine: นับสำเร็จเฉพาะ `OK`/`LOT_ON_MACHINE` · error → ลองใหม่หลัง `ON_MACHINE_RETRY_DELAY` 10 วิ (นับจากเวลาที่พลาดจริง) · `last-event` 500 → ไม่ส่ง A5 | 12/12 |
| 4.2 | `main_dll.py` | A7 / A6 / A2 ส่งไม่ถึง → คิว `send_retry` ลองใหม่ทุก 10 วิ · `post_node()` แยก OK / NOT_SENT / UNKNOWN · **UNKNOWN (timeout) ไม่ส่งซ้ำ** ยกเว้น A2 (as400.js กัน ALREADY_OUT) · ถาดกลับมา → ยกเลิก OUT ในคิว (`cancel_out_if_back`) | 11/11 |
| 4.3 | `main_dll.py` | pallet: `/lot-by-tag` พลาด → ลองใหม่ · A1 ทุก tag พลาด → ปลด `lot_confirmed` ให้ส่งใหม่ | 4/4 |
| ~~5.2~~ | `main_dll.py` | ~~log แยกไฟล์ต่อ reader~~ — **ถอดออก 2026-09-29** ผู้ใช้ดูผ่าน DB + pm2/NSSM เก็บ log อยู่แล้ว | — |
| 5.1 | `DEPLOY_2026-09-28.md` | ขั้นตอนตั้ง NSSM service (reader + backend) — ยังไม่ได้ทำบน server | — |

> ⏸️ **สถานะ 2026-09-29: ผู้ใช้ย้อนโค้ด requirement ใหม่ด้านล่างออกจากไฟล์ที่ใช้งานจริงแล้ว** · เก็บไว้ที่ `backend/routes/rfid_backup.js` และ `service/main_backup.py` (มีงาน 09-28 ครบ + requirement ใหม่)
> ไฟล์ที่ใช้งาน (`rfid.js`, `main_dll.py`) = **เวอร์ชัน 09-28** (pallet loop เดิมพร้อม 4.3 · washing A3 → A4 · ไม่มีการจัดการย้าย pallet) · ถ้าจะเอากลับมาใช้ ให้ copy จากไฟล์ backup

**⭐ Requirement ใหม่ 2026-09-29 (ทำแล้ว แต่พักไว้ใน backup):** pallet เห็น tag → `/pallet` ทันที (A1) · tag หายไม่ทำอะไร · **A2 ย้ายไปส่งใน `rfid.js /washing` ก่อน A3 เสมอ** (A2 → A3 → A4) · `scan_loop_pallet` เดิม comment ทั้งก้อน · รายละเอียด CHANGELOG หัวข้อ 6.5 · ข้อ 4.3 ฝั่ง pallet และคิว A2 ใน Python ไม่ได้ใช้แล้ว
- ✅ ย้าย pallet: `rfid.js /pallet` ส่ง A2 pallet เก่า → A1 pallet ใหม่ (อ่านสถานะ lot ก่อน SP อัป · `before_washing` + location ต่าง = ย้าย)
- ✅ ตัดสินใจแล้ว: AS400 **ปฏิเสธ** A2 (ERROR ไม่ใช่ timeout) → A3/A4 (หรือ A1 ตอนย้าย pallet) ยังส่งตาม แล้ว retry ส่ง A2 ทีหลัง = ลำดับกลับได้ในกรณีนี้ · **ผู้ใช้บอกยังไม่จำเป็นต้องกัน** · แบบ FIFO ต่อ lot ออกแบบไว้ใน `sql/step2_1_*.sql` (ยังไม่ใช้)

**ตัดสินใจข้าม (ประโยชน์น้อย):** retry cap (2.4b) · แจ้งเตือน PENDING (2.6 — ใช้ SQL ใน SYSTEM_REVIEW เช็คเอง) · washing/completed ยิงซ้ำ (4.4 — ยังไม่รู้ว่าถาดค้างหน้า reader จริงไหม) · outbox ลงไฟล์ (4.5) · pallet batch · ลด SP on_machine

**หลักการที่ต้องยึด:** AS400 ไม่ dedup → **ส่งซ้ำเฉพาะตอนมั่นใจว่า Node ยังไม่ได้ทำ**

**เทสอยู่ที่ scratchpad ของ session** (ไม่ได้อยู่ใน repo) — ถ้าต้องเทสซ้ำให้เขียนใหม่ตามแนวเดิม: ดึงฟังก์ชันจริงจากไฟล์ + Node ปลอม + stub `sid_u861` / `winsound`
- ⚠️ เทส Python ต้องใช้ `C:\Users\bptk654\AppData\Local\Programs\Python\Python314-32\python.exe` (`python` เปล่า = Store stub) และ **ห้าม chdir ไป `service/`** ไม่งั้น log เทสลง `service/logs` จริง

---

## 4. สถานะปัจจุบัน

### 4.1 Git

- branch: `FinalRFID_v1` · commit ล่าสุด: `0814c69 update16092026`
- **ทุกอย่างยังไม่ commit** — 15 ไฟล์ modified
- ⚠️ **ห้ามใช้ `git checkout .`** — มีงานของผู้ใช้เองปนอยู่ใน `database.js`, `server.js`, `Sidebar.js`, `constances.js`, `main_dll.py`, `readers_config.json`, `start_rfid.vbs`

### 4.2 ค่าสำคัญตอนนี้

| ไฟล์ | ค่า | สถานะ |
|---|---|---|
| `service/main_dll.py` | `NODE_URL = "http://localhost:2002/api/rfid"` | ✅ ถูก (เดิม 1001) |
| `service/main_dll.py` | `COOLDOWN=3` · `PALLET_IN=10` · `PALLET_OUT=30` · `MACHINE_OUT=30` · `ACCUMULATED_TTL=45` | ผู้ใช้ปรับเอง (เดิม 30/60/60) |
| `service/start_rfid.py:42` | `USE_EXE = False` | 🔴 **ต้องเป็น True ก่อนขึ้น server** |
| `service/start_rfid.vbs` | ชี้ `D:\RFid_NHT_Washing\service` (เครื่อง dev) | 🔴 **ต้องสลับเป็น path server** |
| `service/dist/rfid_service/rfid_service.exe` | build 2026-09-17 | 🔴 **เก่า ต้อง build ใหม่** |
| `frontend/src/config/constances.js` | `BACKEND: 'http://10.120.139.20:2002/api/rfid'` | ✅ ถูก · แต่ยังไม่ได้ build |
| `service/location_ports.json` | `REG1: 8000` · `WS-04: 8002` | ✅ port ของ Python จริง |

### 4.3 สิ่งที่ทดสอบแล้ว / ยังไม่ได้ทดสอบ

- ✅ `node --check` · parse JSX · `npm run build` ผ่าน
- ✅ proxy route เทสกับ Python ปลอม 6 เคส (200 / 502 / 404)
- ✅ resolve logic เทสกับ config จริง
- ⬜ **ยังไม่ได้ทดสอบบน server จริงกับ reader จริง**

---

## 5. ขั้นตอน deploy ที่ค้างอยู่

```
1. start_rfid.py:42       USE_EXE = True
2. start_rfid.vbs         สลับเป็น path server + ใช้ path เต็มของ python.exe
                          (python เปล่าๆ อาจไปเจอ Microsoft Store stub)
3. build exe:
     cd /d D:\RFid_NHT_Washing\service
     pyinstaller --clean rfid_service.spec     ← ถาม y/N ตอบ y
4. build frontend:
     cd frontend && npm run build
5. บน server:
     - ปิด .vbs / kill process ให้หมด
     - ลบ rfid_service.exe + _internal\ เก่าออกให้หมด  ⚠️ onedir ไม่ลบไฟล์เก่าให้
     - copy dist\rfid_service\* → โฟลเดอร์ service
     - copy readers_config.json, location_ports.json, start_rfid.py, start_rfid.vbs
     - copy backend/routes/rfid.js → restart backend
     - copy frontend/build → IIS
6. ทดสอบ:
     http://10.120.139.20:2002/api/rfid/reader/FL-06/status    → ต้องได้ JSON
     เปิด ?location=REG1 / ?location=WS-04 แล้วสแกนจริง
7. ผ่าน 1-2 วัน → ขอ IT ปิด NAT 2003 / 2004
```

**อะไรต้อง build exe ใหม่:**

| ไฟล์ | build ใหม่? | เหตุผล |
|---|---|---|
| `main_dll.py` | ✅ ต้อง | compile เข้า exe |
| `readers_config.json` | ❌ | อ่านจากดิสก์ `open("readers_config.json")` relative path + `cwd=BASE_DIR` |
| `location_ports.json` | ❌ | Python ไม่ได้อ่านไฟล์นี้เลย มีแต่ backend |
| `start_rfid.py` / `.vbs` | ❌ | รันเป็น `.py` ตรงๆ |

**ย้อนกลับ:** ดูหัวข้อ 9 ใน `CHANGELOG_2026-09-23.md`

---

## 6. คำถามที่รอคำตอบ

### จาก IT / AS400

| # | คำถาม | ทำไมสำคัญ |
|---|---|---|
| ~~1~~ | ✅ **ตอบแล้ว 2026-09-28: AS400 ไม่ dedup** | ดูจาก `response_msg` — trackId เดียวกันส่ง 6 ครั้งได้ SUCCESS ทุกครั้ง · ข้อมูลตอนนี้ไม่หาย แต่ **ส่งซ้ำ = AS400 นับซ้ำ** · และยืนยันแล้วว่า **timeout = SUCCESS ถูก** (G5185798 PALLET_IN timeout แต่มีบนเว็บ AS400) |
| 2 | AS400 ยอมรับ `pallet-in` ที่จุดใหม่ ก่อน `pallet-out` ที่จุดเดิมไหม | ย้าย pallet W1 → W2: A1 ที่ W2 ออก ~10 วิ แต่ A2 ที่ W1 ออก ~75 วิ → ลำดับกลับกัน |

### จากผู้ใช้

| # | คำถาม | ใช้ทำอะไร |
|---|---|---|
| 3 | ส่ง SP `Stored_tb_rfid_lot_update_location` มาดู | ออกแบบ pallet batch — ต้องทำ SP ใหม่หรือวน SP เดิมใน Node |
| ~~4~~ | ✅ **ตอบแล้ว 2026-09-28** | อ่านซ้ำไม่ส่ง A3/A4 ซ้ำ — ครั้งที่ 2 ถาดเป็น `after_washing` แล้ว SP คืน `NOT_READY` |
| 6 | ถาดยกออกจาก pallet แล้ววางกลับ pallet เดิม เกิดได้ไหม | ถ้าได้: A2 ออกไปแล้ว แต่วางกลับได้ `DUPLICATE_LOCATION` → ไม่มี A1 ใหม่ → AS400 เห็นว่าออกแล้ว |
| 7 | ถาดวางค้างหน้า reader washing / completed ไหม | ตัดสินว่าต้องทำ 4.4 (ยิงซ้ำทุก 3 วิ) หรือไม่ |
| 8 | ถาด part ผิดวางอยู่ แล้วถาดถูกเข้ามา → alarm ดับ (`main_dll.py` success branch) ตั้งใจไหม | ถ้าไม่ตั้งใจ ควรให้ดังจนกว่าถาดผิดออก |
| 5 | reader รุ่นที่ใช้ต่อ antenna หลายต้นได้ไหม | pallet reader ตัวที่ 2 ที่ location เดียวกัน |

---

## 7. แผนงานถัดไป

### 7.1 บทวินิจฉัยหลัก

> **ระบบไม่ได้พังเพราะทำงานพร้อมกัน — มันพังเพราะส่งพลาดแล้วไม่ลองใหม่**

```
ระบบหนัก → ส่งพลาด 1 ครั้ง → Python ลบ state ทิ้ง ไม่ลองใหม่ → ข้อมูลหาย → งาน mix
```

**ลดความถี่สแกนไม่ช่วย** — scan ไม่ได้ไปถึง Node/SQL/AS400 · Node ถูกเรียกเฉพาะตอนถาดเข้า-ออก · `accumulated_tags` (45 วิ) คือ cache ฝั่งสแกนที่มีอยู่แล้ว · ที่ขาดคือ cache ฝั่ง **ส่ง**

### 7.2 จุดที่ข้อมูลหายจริง (ยืนยันจากโค้ดแล้ว)

| จุด | ปัญหา | ที่ |
|---|---|---|
| A7 on-machine-out | `tags_disappeared_machine.pop()` **ก่อน** POST → พลาด = หายถาวร | `main_dll.py:368-380` |
| A2 pallet-lot-out | `lot_tags.pop()` ทำ**ไม่ว่าส่งสำเร็จหรือไม่** | `main_dll.py:535` |
| A6 checking | `lot_checked.add()` **ก่อน** POST | `main_dll.py:329` |
| A1 pallet-in | `lot_confirmed.add()` **ก่อน** วนส่ง | `main_dll.py:499` |
| 500 = สำเร็จ | `res.json().get("result")` ได้ `None` จาก 500 → ตกไป `else` = เส้นทางสำเร็จ → นับ qty ทั้งที่ DB ไม่ได้ update | `main_dll.py:267` |
| ตาข่ายมีรู | `logToDB` ต้องใช้ DB connection → pool เต็ม = เขียน log ไม่ได้ = `retryErrors` มองไม่เห็น | `as400.js:86` |

### 7.3 ตัวจุดชนวน

| จุด | ปัญหา | ที่ |
|---|---|---|
| SQL pool | ไม่ได้ตั้ง → default `max: 10` · เต็มรอ 60 วิ แต่ Python รอ 5 วิ | `database.js:26` |
| IT API | **ไม่มี timeout** (axios default = รอไม่มีกำหนด) · `withCache` ไม่กัน request ซ้อน → cache หมดอายุ = 76 เครื่องยิงพร้อมกัน · IT API ล่ม = ไม่ cache ยิงซ้ำทุก request | `rfid.js:31, 419` |

### 7.4 ✅ ตรวจแล้วไม่เป็นปัญหา

- Node **ไม่รอ AS400** ก่อนตอบ Python — ทุกจุดเป็น fire-and-forget → ไม่มีปัญหา Python timeout 5 วิ < AS400 timeout 8 วิ
- on_machine IN ส่งพลาด **ไม่หาย** — `tags_on_machine` ไม่ถูก set ตอน exception → tick ถัดไปลองใหม่เอง (แต่ติดปัญหา 500 = สำเร็จ)

### 7.5 แผน 3 เฟส

| เฟส | งาน | แก้ที่ | build exe |
|---|---|---|---|
| **1** ตัดตัวจุดชนวน | pool `max: 50` · timeout 5 วิ + กัน cache stampede + ใช้ cache เก่าถ้า IT API ล่ม · `logToDB` พลาด → ตอบ 503 · cache `/status` 2 วิ · `retryErrors` กันรอบทับ + cap | backend | ❌ |
| **2** กันส่งซ้ำ | ตาราง `tb_rfid_event_dedup` + SP · Python แปะ `event_id` (UUID) · Node เช็คก่อนทำ | SQL + backend | ❌ |
| **3** พลาดไม่หาย | **Outbox** ใน Python: คิว + sender thread + เขียนไฟล์ + retry backoff · เช็ค `status_code` · washing/completed ยิงครั้งเดียวต่อรอบ · on_machine ลด SP 4 → 2 · pallet batch | Python | ✅ |

**ลำดับบังคับ: เฟส 2 ต้องเสร็จก่อนเฟส 3** — ไม่งั้น retry แล้วได้ข้อมูลซ้ำแทนข้อมูลหาย

**ผู้ใช้เห็นชอบให้เริ่มเฟส 1 ได้** · เฟส 2-3 รอคำตอบ trackId

### 7.6 Pallet batch — ผู้ใช้ยืนยัน requirement แล้ว

> **A1 ต้องส่งครั้งเดียวต่อ lot หลังจากทุก tag เปลี่ยน sub_process แล้ว**

> ✅ **แก้การวิเคราะห์ 2026-09-28 — ย่อหน้าด้านล่างผิด:** ได้ดู SP `lot_update_location` แล้ว — ครั้งแรก update **ทุกถาดของ lot** ใน transaction เดียวแล้วคืน `OK` → A1 · tag ถัดไปได้ `DUPLICATE_LOCATION` → ไม่ส่ง A1 · **A1 ส่งครั้งเดียวต่อ lot และตรง requirement อยู่แล้ว** · pallet batch เหลือแค่ประหยัด request → ข้ามไปก่อน

**~~โค้ดตอนนี้ทำไม่ตรง~~ (ผิด ดูด้านบน):** วนส่ง `/pallet` ทีละ tag → แต่ละครั้ง update tag + ส่ง A1 → 10 ถาด = **A1 10 ครั้ง** และครั้งแรกออก**ก่อน**ที่ tag อื่นจะ update เสร็จ · ไม่มี dedup ที่ `/pallet-in`

**แบบที่ต้องทำ:**
```
Python:  /pallet-lot  { barcode, location, tags: [...] }   ← 1 ครั้งต่อ lot
Node:    update ทุก tag → ครบค่อยส่ง A1 ครั้งเดียว · พลาดกลางทาง → ไม่ส่ง A1
```
ได้ผล: request 131 → 12 · A1 ถูกต้องตาม requirement · A1 กับ A2 เป็นมาตรฐานเดียวกัน (A2 ทีละ lot อยู่แล้ว) · ลด `/lot-by-tag` 131 ครั้ง → `/lot-by-tags` 1 ครั้งได้ด้วย · เก็บ `/pallet` เดิมไว้ไม่ลบ

**รอ:** SP `Stored_tb_rfid_lot_update_location`

### 7.7 Pallet reader ตัวที่ 2

| กรณี | ใช้ได้ไหม |
|---|---|
| **คนละ location** (W1, W2, W3) | ✅ **ใช้ได้เลย** เพิ่ม entry ใน `readers_config.json` ไม่ต้องแก้โค้ด · ข้อจำกัด: 1 lot ต้องอยู่จุดเดียว · ต้องเว้นระยะไม่ให้อ่านข้ามกัน |
| **location เดียวกัน** | ❌ **A1 ไม่ยิงเลย** เพราะ `lot_tags` แยกต่อ process ไม่มีใครนับครบ · ต้องแก้โค้ด |

ทางเลือกสำหรับ location เดียวกัน (เรียงดีสุด → สำรอง):
1. **ต่อ antenna เพิ่มที่ reader เดิม** — ไม่แก้ logic ถ้ารุ่นรองรับ
2. **1 process ถือ 2 handle** — `sid_u861.py` ไม่มี global state ทุก function รับ `port_handle` เป็น parameter → ออกแบบมาให้ถือหลาย handle ได้ · ~35 บรรทัด · ต้องเทสว่า DLL เปิด 2 handle พร้อมกันได้จริง · ข้อเสีย: แตะ `connect_reader` / `scan_loop` / `reconnect_loop` ที่ reader ทุกตัวใช้
3. **master/slave ผ่าน `/tags`** — ~15 บรรทัด ทำได้แน่ config-gated · ตัวสำรอง

---

## 8. ปัญหาที่รู้แล้วแต่ยังไม่แก้

| # | ปัญหา | ความเร่ง |
|---|---|---|
| 1 | out timing จริง = `ACCUMULATED_TTL` + cooldown ≈ **75 วิ** (ไม่ใช่ 30) — ผู้ใช้รับสภาพ "แก้ไม่ได้" | ปิดเคส |
| 2 | pallet: tag ที่ `/lot-by-tag` พลาดครั้งเดียวหลุดจาก lot ถาวร → lot ไม่ยิง A1 เลย | เฟส 3 |
| 3 | `retryErrors` ไม่มี cap · ไม่มี `retry_count` · ไม่มีสถานะ FAILED | เฟส 1 |
| 4 | `/status` ยิงหา reader ทุกตัวทุก 3-5 วิต่อจอ · `machineRow` คำนวณแต่ไม่ได้ใช้ | เฟส 1 |
| 5 | washing / completed ยิงซ้ำทุก 3 วิขณะถาดค้างหน้า reader | เฟส 3 |
| 6 | on_machine ยิง SP 4 ครั้งต่อถาด (ลดเหลือ 2 ได้) | เฟส 3 |
| 7 | `process.exit(1)` ที่ `database.js` ไม่ log error | ว่างค่อยทำ |
| 8 | `catch { }` ว่างๆ ตามหน้าเว็บ | ว่างค่อยทำ |
| 9 | Python สร้าง httpx connection ใหม่ทุกครั้ง (15 จุด) | ว่างค่อยทำ |
| 10 | `kill_process_by_port()` เรียก netstat ต่อ reader → 99 ตัว boot ช้า 2-3 นาที | ว่างค่อยทำ |
| 11 | `urlParameter()` ใน `instance.js` อ้าง `API.LOCATION_PORTS` ที่ไม่มีจริง (ไม่มีใครเรียกแล้ว) | ว่างค่อยทำ |
| 12 | backend ไม่มี auth เลย | ตัดสินใจเชิงธุรกิจ |
| 13 | SA password อยู่ใน git history (block ที่ comment ไว้ใน `database.js`) | rotate + ลบ |
| 14 | git hygiene: เพิ่ม `service_2/` ใน `.gitignore` · เอา `*.spec` ออกจาก `.gitignore` · สร้าง `backend/.env.example` | ว่างค่อยทำ |
| 15 | `/new-tag` อ่านแล้วล้าง → 2 จอชี้ location เดียวกันแย่ง tag กัน · กฎ: **1 reader = 1 จอ** | รู้ไว้ |

---

## 9. ข้อเท็จจริงสำคัญ / กับดัก

| เรื่อง | รายละเอียด |
|---|---|
| **Express 5 wildcard** | ต้องใช้ `*splat` ไม่ใช่ `(*)` · `req.params.splat` เป็น **array** ต้อง `.join('/')` · เขียนผิด server crash ตอน start |
| **Node 22 + localhost ต่อไม่ได้** | โยน `AggregateError` ที่ `.message` **ว่าง** รายละเอียดอยู่ใน `err.errors` |
| **`localhost` vs `127.0.0.1`** | Node 22 มี autoSelectFamily ลองทั้ง IPv4/IPv6 → `localhost` ใช้ได้ · โค้ดเดิมใช้ `localhost` อยู่แล้ว |
| **Python bind** | exe: `host="0.0.0.0"` · `python -m uvicorn` ไม่มี `--host` = `127.0.0.1` เท่านั้น |
| **ชื่อ W1 พ้องกัน** | `readers_config.json`: W1 = reader **pallet** 8001 · `location_ports.json` เคยใช้ W1 เป็นเมนู washing → เปลี่ยนเป็น WS-04 แล้ว |
| **2 ไฟล์ config ความหมายต่างกัน** | `readers_config.json` = reader ตั้งที่ไหน port ไหน (source of truth) · `location_ports.json` = location ในเมนูใช้ reader ตัวไหน + type กำหนดคอลัมน์ในหน้า Location |
| **reader pallet ไม่เซ็ต `new_tag`** | มีแค่ register / washing ที่เซ็ต → หน้าเว็บชี้ไป reader pallet จะได้ `null` ตลอด |
| **`/new-tag` 3 ตัวใช้ตัวแปรเดียวกัน** | `/new-tag`, `/new-tag/washing`, `/new-tag/pallet` อ่านและล้าง `reader_state["new_tag"]` ตัวเดียวกัน |
| **PyInstaller onedir** | ไม่ลบไฟล์เก่า · โค้ดใน exe คือ snapshot ตอน build |
| **Python PATH** | `python` เปล่าอาจเจอ Microsoft Store stub (WindowsApps) · ใช้ path เต็ม |
| **httpx ไม่ raise 4xx/5xx** | ไม่มี `raise_for_status()` ที่ไหนเลย |
| **axios ไม่มี default timeout** | ไม่ได้ตั้ง `axios.defaults.timeout` → รอไม่มีกำหนด |
| **`Register.js`** | ไม่ได้ใช้แล้ว (Route ถูก comment ใน `App.js`) |
| **Windows Firewall** | ไม่กรอง loopback → `connected: true` จาก server เองไม่ได้พิสูจน์ว่า firewall เปิด |

---

## 10. แผนที่ไฟล์

```
backend/
  server.js                 Express app · port 2002 · setInterval(retryErrors, 5 นาที)
  database.js               mssql pool (ไม่ได้ตั้ง max → 10) · มี SA password comment ไว้
  routes/rfid.js            API หลัก · /status · /on-machine · /pallet · /washing
                            · READER PROXY (/reader/:location/*splat)
  routes/as400.js           A1-A7 · logToDB · sendMovement · retryErrors · AS400_TIMEOUT_MS

service/
  main_dll.py               FastAPI 1 process ต่อ reader · scan_loop + loop ต่อ type
  sid_u861.py               ctypes wrapper ของ SID_U861.dll · stateless · handle-based
  start_rfid.py             spawn + monitor process ทุก reader · USE_EXE
  start_rfid.vbs            launcher
  rfid_service.spec         PyInstaller spec
  readers_config.json       รายการ reader (port, type, ip, power, location, enabled, min_qty)
  location_ports.json       location ในเมนู → port ของ reader
  location_ports.json.bak   สำรองก่อนแก้ REG1

frontend/src/
  config/constances.js      BACKEND URL (ตัวเดียวที่มีผลหลังทำ proxy)
  config/instance.js        backendApi · readerApi(location)
  pages/nht_washing/
    MultiRegister.js        register · poll /new-tag 300ms
    MachineValidate.js      washing · poll /new-tag/washing 1000ms
    TagSearch.js            poll /tags 1000ms
    ReaderConfig.js         แก้ readers_config + location_ports
    Location.js             เมนูเลือก location (อ่าน location_ports)
    MbrMonitor.js           poll /status ทุก 5 วิ
    ReaderStatus.js         poll /status ทุก 3 วิ
    Management/MasterTrayTab.js

sql/
  step1_1_as400_log_index.sql      index tag_id / status
  step1_2_sp_rollback_trancount.sql  IF @@TRANCOUNT ใน 3 SP
  step1_3_rfid_log_index.sql       index tb_rfid_log(barcode)

backend/logs/               as400_failed.jsonl (มีเฉพาะตอน logToDB พลาด · gitignored)

CHANGELOG_2026-09-23.md     รายละเอียดการแก้ Reader Proxy + วิธีย้อนกลับ
SYSTEM_REVIEW_2026-09-28.md ตรวจทั้งระบบสำหรับ 99 readers + ลำดับการแก้
TEST_PLAN_2026-09-28.md     เช็คลิสต์เทสบน dev
DEPLOY_2026-09-28.md        ขั้นตอนขึ้น server + Windows Service (NSSM) + ย้อนกลับ
HANDOFF.md                  ไฟล์นี้
```
