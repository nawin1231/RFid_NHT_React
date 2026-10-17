# สรุปการแก้ไข — 23 กันยายน 2026

> **Reader Proxy** — เลิกพึ่งการขอเปิด port จาก IT
> พร้อมการปรับปรุงหน้า Reader Config และ Master Tray

---

## สารบัญ

1. [ปัญหาที่ต้องแก้](#1-ปัญหาที่ต้องแก้)
2. [แนวทางที่เลือก](#2-แนวทางที่เลือก)
3. [ไฟล์ที่แก้ไขทั้งหมด](#3-ไฟล์ที่แก้ไขทั้งหมด)
4. [วิธีใช้ / คำสั่ง](#4-วิธีใช้--คำสั่ง)
5. [ขั้นตอน Deploy](#5-ขั้นตอน-deploy)
6. [ข้อดี / ข้อเสีย](#6-ข้อดี--ข้อเสีย)
7. [ดีกว่าแบบเก่าอย่างไร](#7-ดีกว่าแบบเก่าอย่างไร)
8. [ปัญหาที่ยังเหลืออยู่](#8-ปัญหาที่ยังเหลืออยู่)
9. [วิธีย้อนกลับ](#9-วิธีย้อนกลับ)

---

## 1. ปัญหาที่ต้องแก้

### อาการ

หน้า Multi Register, Tag Search, Machine Validation **สแกน tag ไม่ได้** เมื่อเปิดเว็บจากเครื่องอื่น (ไม่ใช่จาก server)

### สาเหตุ

Frontend เดิม **ยิงตรงไปที่ Python** โดยแยก reader แต่ละตัวด้วย **port**

```
Browser (วง IT) ──► 10.120.139.20:8000 ──✂── ไม่มี NAT ──► Python REG1
Browser (วง IT) ──► 10.120.139.20:8002 ──✂── ไม่มี NAT ──► Python WS-04
```

Server อยู่**วง OT** ส่วน browser อยู่**วง IT** ต้องผ่าน NAT ของ IT เท่านั้น
ถ้า IT ไม่เปิด port ให้ → browser เข้าถึง Python ไม่ได้ → สแกนไม่ได้

### ทางแก้ชั่วคราวที่ใช้อยู่ก่อนหน้า

ขอ IT เปิด NAT เพิ่ม 2 port (`2003`, `2004`) แล้วแก้ `location_ports.json` ให้ชี้ไปเลขนั้น

```json
{ "REG1": { "port": 2004 }, "W1": { "port": 2003 } }
```

ใช้งานได้ **แต่เป็นภาระถาวร**

### ทำไมทางแก้เดิมไม่ยั่งยืน

| | |
|---|---|
| ทุก location ที่มีหน้าเว็บ | = 1 NAT ที่ต้องขอ IT |
| แผนขยาย register 4 + pallet 10 + washing 8 + MBR 76 + complete 1 = **99 readers** | = ต้องขอเปิดถึง **99 port** |
| เพิ่มหน้าเว็บใหม่ | = ขอ port ใหม่ทุกครั้ง |
| เปิด Python ให้วง IT ยิงได้ตรงๆ | = `/restart`, `/test-relay-on` ที่**ไม่มี auth** ใครก็สั่งปิด reader หรือเปิดไซเรนได้ |

---

## 2. แนวทางที่เลือก

**เปลี่ยนจากแยก reader ด้วย `port` → แยกด้วย `path`** โดยให้ Node.js เป็นตัวกลาง (proxy)

```
เดิม   Browser ──► :2003 (ขอ IT) ──NAT──► :8002 ──► Python

ใหม่   Browser ──► :2002 (มีอยู่แล้ว) ──► Node ──► :8002 ──► Python
                   /api/rfid/reader/WS-04/new-tag       └── ในเครื่องเดียวกัน
```

### หลักการ

Node.js กับ Python **รันอยู่บนเครื่องเดียวกัน (วง OT)** จึงคุยกันผ่าน `localhost` ได้
ข้อมูลไม่ออกจากเครื่อง → **ไม่ผ่าน NAT ไม่ผ่าน firewall ไม่ต้องขออนุญาตใคร**

เหลือด่านที่ IT คุมเพียงด่านเดียว คือ NAT เข้า port **2002** ซึ่งเปิดใช้งานอยู่แล้ว

---

## 3. ไฟล์ที่แก้ไขทั้งหมด

สรุป: **8 ไฟล์ · +316 / -62 บรรทัด** — โค้ดเดิมทุกจุด **comment ไว้** ไม่ได้ลบ

| ไฟล์ | บรรทัด | ประเภท |
|---|---|---|
| `backend/routes/rfid.js` | +108 | เพิ่มล้วน |
| `frontend/src/config/instance.js` | +14 | เพิ่มล้วน |
| `frontend/src/pages/nht_washing/TagSearch.js` | ±47 | ย้ายมาใช้ proxy |
| `frontend/src/pages/nht_washing/MultiRegister.js` | ±41 | ย้ายมาใช้ proxy |
| `frontend/src/pages/nht_washing/MachineValidate.js` | ±41 | ย้ายมาใช้ proxy |
| `frontend/src/pages/nht_washing/ReaderConfig.js` | ±85 | ปรับปรุง UI |
| `frontend/src/pages/nht_washing/Management/MasterTrayTab.js` | ±40 | เพิ่ม search |
| `service/location_ports.json` | ±2 | แก้ค่า config |

---

### 3.1 `backend/routes/rfid.js` — หัวใจของงาน

#### เพิ่ม env variable (บรรทัด 14)

```js
const READER_HOST = process.env.READER_HOST || 'localhost';
```

**คืออะไร** — host ที่ Python รันอยู่
**ทำไมต้องมี** — ไม่ให้มี IP/hostname ฝังในโค้ด ถ้าวันหน้าย้าย Python ไปเครื่อง gateway แยก แก้ที่ `.env` บรรทัดเดียวจบ ไม่ต้องแก้โค้ดและ deploy ใหม่
**ค่า default** — `localhost` ทำให้ใช้งานได้ทันทีโดยไม่ต้องใส่ `.env`

#### เพิ่ม route `READER PROXY`

```js
router.all('/reader/:location/*splat', async (req, res) => { ... });
```

**คืออะไร** — ประตูเดียวที่รับคำขอทุก location แล้วส่งต่อไป Python ตัวที่ถูกต้อง

**การทำงานทีละขั้น**

| ขั้น | ทำอะไร |
|---|---|
| 1 | รับ `location` จาก path เช่น `/reader/WS-04/new-tag` |
| 2 | อ่าน `location_ports.json` + `readers_config.json` เพื่อหา port ของ Python |
| 3 | ต่อ path ที่เหลือ (`new-tag`) ส่งไป `http://localhost:8002/new-tag` |
| 4 | ส่ง response กลับให้ browser ตรงๆ |

**Logic การหา reader**

```
location อยู่ใน location_ports.json ?
├─ มี   → port ในไฟล์ตรงกับ reader จริงใน readers_config.json ?
│         ├─ ตรง    → ใช้ reader ตัวนั้น
│         └─ ไม่ตรง → 404 + บอกว่าไฟล์ใส่ port ผิดชนิด
└─ ไม่มี → เทียบกับ location ของ reader เองตรงๆ  (FL-06, COM ที่ไม่มีหน้าเว็บ)
```

> **ทำไมต้องอ่าน 2 ไฟล์** — ชื่อใน 2 ไฟล์ไม่ตรงกันเสมอ
> `readers_config.json` = "reader ตัวนี้ตั้งอยู่ที่ไหน"
> `location_ports.json` = "location ในเมนูนี้ ใช้ reader ตัวไหน"
> เคยพบเคสจริง: `W1` เป็น location ของ reader **pallet** (8001) แต่ในเมนูหมายถึง reader **washing** (8002)

**รายละเอียดสำคัญในโค้ด 3 จุด**

```js
// 1) Express 5 คืน splat มาเป็น array ต้อง join กลับเป็น path
const subPath = Array.isArray(req.params.splat)
    ? req.params.splat.join('/')
    : req.params.splat;

// 2) GET ต้องไม่แนบ body เพราะ express.json() ใส่ {} มาให้ทุก request
...(req.method === 'GET' ? {} : { data: req.body }),

// 3) Node 22 ต่อไม่สำเร็จจะโยน AggregateError ที่ message ว่างเปล่า ต้องมีตัวสำรอง
const detail = err.message || err.code
    || err.errors?.map(e => e.message || e.code).filter(Boolean).join('; ')
    || 'reader unreachable';
```

⚠️ **Express 5 ต้องใช้ `*splat` ไม่ใช่ `(*)`** — `path-to-regexp` v8 ถอด syntax เก่าออกแล้ว เขียนผิด server จะ crash ทันทีตอน start

---

### 3.2 `frontend/src/config/instance.js`

```js
export const readerApi = (location) =>
    axios.create({ baseURL: `${API.BACKEND}/reader/${encodeURIComponent(location)}` });
```

**คืออะไร** — helper สร้าง axios instance ที่ชี้ไป proxy ของ location นั้น
**ผล** — หน้าเว็บเรียก `deviceApi.get('/new-tag')` ได้เหมือนเดิมทุกตัวอักษร ไม่ต้องแก้ logic ในหน้า

---

### 3.3 หน้าที่สแกน 3 หน้า

| หน้า | endpoint (ไม่เปลี่ยน) | Poll |
|---|---|---|
| `TagSearch.js` | `/tags` | 1000 ms |
| `MultiRegister.js` | `/new-tag` | 300 ms |
| `MachineValidate.js` | `/new-tag/washing` | 1000 ms |

**เปลี่ยนจาก**

```js
backendApi.get('/location-ports').then(res => {
    const config = location ? res.data[location] : null;
    if (config) {
        setDeviceApi(() => axios.create({ baseURL: `${API.PYTHON_BASE}:${config.port}` }));
    } else { setDeviceApi(() => pythonApi); }
    setDeviceReady(true);
}).catch(...)
```

**เป็น**

```js
setDeviceApi(() => (location ? readerApi(location) : pythonApi));
setDeviceReady(true);
```

**ได้ผลพลอยได้** — ไม่ต้องเรียก `/location-ports` อีก เพราะ backend resolve ให้เอง → **ลด network round-trip ตอนเปิดหน้า 1 ครั้ง**

> `Register.js` ไม่ต้องแก้ เพราะไม่ได้ถูก route (import + Route ถูก comment ไว้ใน `App.js`)

---

### 3.4 `ReaderConfig.js` — ปรับปรุง UI

| # | แก้อะไร | ทำไม |
|---|---|---|
| 1 | หัวคอลัมน์ `ID` → `Port` | ค่านี้คือ port ที่ Python ฟังจริง และ backend ใช้ resolve reader ผ่าน proxy — เรียก `ID` ทำให้เข้าใจผิดว่าเป็นเลขลำดับที่แก้ได้ตามใจ |
| 2 | port ซ้ำ → ขอบแดง + tooltip | เห็นก่อนกด Save |
| 3 | **บล็อกการ Save** ถ้ามี port ซ้ำ | `kill_process_by_port()` ใน `start_rfid.py` จะ kill process ที่ใช้ port เดียวกันทิ้ง → **reader ตายเงียบๆ** โดยหน้าเว็บยังบอกว่า config ถูก หาสาเหตุไม่เจอ ยิ่งตอนมี 99 ตัวยิ่งหายาก |
| 4 | Add Location: เอา input พิมพ์ชื่อออก → **dropdown เลือก reader** | เลือกครั้งเดียวได้ทั้งชื่อ location และ port ไม่มีโอกาสพิมพ์ผิด และชื่อกับ port ตรงกันเสมอ |
| 5 | เปลี่ยน type → ล้าง reader ที่เลือก | ไม่ให้ค้างเป็น reader คนละ type |
| 6 | preview `WS-04 → port 8002 · washing` | เห็นผลลัพธ์ก่อนกดปุ่ม |
| 7 | เตือนถ้า location มีอยู่แล้ว | `addLocationPort` เขียนทับของเดิมโดยไม่ถาม |
| 8 | เตือนถ้าไม่มี reader ที่ type ตรง | เดิม dropdown ว่างเปล่าแล้วไม่บอกว่าทำไม |

**ผลข้างเคียงที่ต้องรู้** — ชื่อ location ที่เพิ่มใหม่จะ**เท่ากับ `location` ของ reader ตัวนั้นเสมอ** ตั้งชื่อต่างจาก reader ไม่ได้อีก (ของเดิมที่มีอยู่ยังใช้ได้ปกติ)

---

### 3.5 `MasterTrayTab.js` — เพิ่ม search

| เพิ่มอะไร | ผล |
|---|---|
| ช่อง `Search part no...` + ปุ่ม `✕` | ไม่ต้องเลื่อนหาทีละแถว |
| filter ตัดช่องว่างหัวท้าย + ไม่สน case | part no มักถูก copy/scan มาแล้วติดช่องว่าง |
| `{filteredTrays.length} / {trays.length} records` | ตอนกรองเห็นว่าเจอกี่แถวจากทั้งหมดเท่าไหร่ |
| ข้อความ `No part matching "xxx"` | แยกจาก `No records` — ตารางว่างเพราะไม่มีข้อมูล กับเพราะกรองไม่เจอ คนละเรื่อง |

---

### 3.6 `service/location_ports.json`

```diff
  {
      "REG1": {
-         "port": 2004,          ← port ที่ IT เปิด NAT
+         "port": 8000,          ← port ที่ Python ฟังจริง
          "type": "register"
      },
      "WS-04": {
          "port": 8002,
          "type": "washing"
      }
  }
```

นอกจากนี้ยังเปลี่ยนชื่อ key `W1` → `WS-04` เพื่อให้ตรงกับ `location` ของ reader ตัวจริง **ไม่ให้ชื่อพ้องกับ reader pallet ที่ชื่อ W1 อีก**

> ไฟล์นี้ **สำรองไว้ที่ `service/location_ports.json.bak`** (JSON ใส่ comment ไม่ได้)

---

## 4. วิธีใช้ / คำสั่ง

### รูปแบบ URL

```
http://<host>:2002/api/rfid/reader/<location>/<path ของ Python>
```

| ต้องการ | เรียก |
|---|---|
| สถานะ reader REG1 | `/api/rfid/reader/REG1/status` |
| tag ใหม่จาก REG1 | `/api/rfid/reader/REG1/new-tag` |
| tag ใหม่จาก WS-04 (washing) | `/api/rfid/reader/WS-04/new-tag/washing` |
| tag ทั้งหมดที่ FL-06 เห็น | `/api/rfid/reader/FL-06/tags` |

`<location>` ใช้ค่าจาก `readers_config.json` หรือ `location_ports.json` — ปัจจุบันมี `REG1`, `W1`, `WS-04`, `FL-06`, `COM`

### ใช้ในโค้ด frontend

```js
import { readerApi } from '../../config/instance';

const deviceApi = readerApi('WS-04');
const res = await deviceApi.get('/new-tag/washing');   // path เหมือนเดิมทุกตัวอักษร
```

### ทดสอบด้วย browser

```
http://10.120.139.20:2002/api/rfid/reader/FL-06/status
```

| ผลที่ได้ | ความหมาย |
|---|---|
| JSON สถานะ | ✅ ใช้งานได้ |
| `502` + `{"error":"ECONNREFUSED","location":"..."}` | Python ตัวนั้นไม่ได้รัน (ปกติถ้า `enabled: false`) |
| `404` + `cannot resolve location` | config ชี้ผิด — อ่าน `hint` ใน response |

### ตั้งค่าเพิ่ม (ไม่บังคับ)

ใส่ใน `backend/.env` ถ้าต้องการเปลี่ยน host ที่ Python รันอยู่

```
READER_HOST=localhost
```

---

## 5. ขั้นตอน Deploy

### 5.1 Frontend

```bash
# 1. แก้ frontend/src/config/constances.js
#    BACKEND: 'http://10.120.139.20:2002/api/rfid'    ← ต้องเป็น IP ของ server ไม่ใช่ localhost
cd frontend
npm run build
# 2. เอาโฟลเดอร์ build/ ไปวางที่ IIS (port 2001)
```

> ⚠️ **`BACKEND` คือตัวเดียวที่มีผลตอนนี้** — `PYTHON` / `WASHING` / `PYTHON_BASE` เหลือเป็นแค่ fallback กรณีเปิดหน้าโดยไม่ใส่ `?location=`

### 5.2 Backend

```bash
# copy backend/routes/rfid.js ไปทับ แล้ว restart backend
```

> ถ้า route เขียนผิด Express จะ crash ทันทีตอน start — รู้ผลในวินาทีแรก ไม่ใช่ไปพังตอนใช้งาน

### 5.3 Config

```bash
# copy service/location_ports.json ไปทับ
```

**ไม่ต้อง build exe** — `main_dll.py` เปิดไฟล์เดียวคือ `readers_config.json` (บรรทัด 20) ไม่ได้อ้าง `location_ports.json` เลย มีแต่ backend ที่อ่านไฟล์นี้ และอ่านจากดิสก์ทุกครั้งที่มี request

### 5.4 Python service

🔴 **ต้อง build exe ใหม่** เพราะ `main_dll.py` มีการเปลี่ยนที่ถูก compile ฝังในตัว exe

```diff
- NODE_URL = "http://localhost:1001/api/rfid"
+ NODE_URL = "http://localhost:2002/api/rfid"      ← สำคัญที่สุด backend ฟังที่ 2002

- PALLET_IN_COOLDOWN = 30   PALLET_OUT_COOLDOWN = 60   MACHINE_OUT_COOLDOWN = 60
+ PALLET_IN_COOLDOWN = 10   PALLET_OUT_COOLDOWN = 30   MACHINE_OUT_COOLDOWN = 30
```

> ถ้าไม่ build ใหม่ exe เก่าจะยังยิงหา port **1001** → **reader connect ได้ แต่ไม่มีข้อมูลลง DB เลย**

**ขั้นตอน**

```
1. แก้ start_rfid.py:42     USE_EXE = True          ← ตอนนี้เป็น False
2. แก้ start_rfid.vbs        สลับเป็น path ของ server (ใส่ path เต็มของ python.exe)
3. build:
   cd /d D:\RFid_NHT_Washing\service
   pyinstaller --clean rfid_service.spec
   # ถาม "output directory will be REMOVED! Continue? (y/N)" → ตอบ y
4. บน server: ปิด .vbs / kill process ให้หมด
5. บน server: ลบ rfid_service.exe + _internal\ อันเก่าออกให้หมด
   ⚠️ สำคัญ! PyInstaller onedir ไม่ลบไฟล์เก่าให้ ของเก่าค้างจะทำให้เหมือน "deploy แล้วไม่อัปเดต"
6. copy จาก dist\rfid_service\ → โฟลเดอร์ service บน server
7. copy readers_config.json, location_ports.json, start_rfid.py, start_rfid.vbs ไปทับ
8. รัน .vbs แล้วดู terminal ว่าขึ้น [OK] [<type>] Connected
```

### 5.5 ตารางสรุปว่าอะไรต้อง build ใหม่

| ไฟล์ | build ใหม่ไหม | เหตุผล |
|---|---|---|
| `main_dll.py` | 🔴 **ต้อง** | โค้ดถูก compile เข้า exe |
| `readers_config.json` | ✅ ไม่ต้อง | อ่านจากดิสก์ด้วย relative path (`cwd=BASE_DIR`) |
| `location_ports.json` | ✅ ไม่ต้อง | มีแต่ backend อ่าน |
| `start_rfid.py` / `.vbs` | ✅ ไม่ต้อง | รันเป็น `.py` ตรงๆ |
| `rfid.js` / frontend | ✅ ไม่ต้อง | คนละส่วนกับ exe |

### 5.6 หลัง deploy ผ่านแล้ว

ขอ IT **ปิด NAT 2003 และ 2004 คืน** — ไม่ต้องใช้อีกแล้ว และช่วยปิดช่องที่ Python ถูกยิงจากวง IT ได้

---

## 6. ข้อดี / ข้อเสีย

### ข้อดี

| | |
|---|---|
| **เลิกขอ port จาก IT ถาวร** | เพิ่ม reader อีก 94 ตัว หรือเพิ่มหน้าเว็บอีกกี่หน้า = ขอเพิ่ม **0 port** |
| **ปลอดภัยขึ้นจริง** | ปิด 2003/2004 ได้ → `/restart`, `/test-relay-on` ที่ไม่มี auth ยิงได้จากในเครื่องเท่านั้น |
| **ย้าย port ของ reader ไม่ต้อง build frontend** | แก้ `readers_config.json` แล้ว restart พอ (เดิม port ถูกคอมไพล์เข้า bundle) |
| **เปิดหน้าเร็วขึ้น** | ตัด `/location-ports` ออก 1 round-trip |
| **CORS / auth / log มีที่เดียว** | ถ้าจะใส่ auth วันหลัง ทำที่ Node จุดเดียวครอบทุก reader |
| **error บอกสาเหตุได้** | 502 บอก `location` + `ECONNREFUSED` และ log ที่ server ด้วย |
| **ย้อนกลับง่าย** | โค้ดเดิม comment ไว้ทุกจุด uncomment ทีละหน้าได้ |

### ข้อเสีย

| | จริงแค่ไหน |
|---|---|
| Node ตาย → หน้าเว็บคุย reader ไม่ได้ | **แทบไม่เสียอะไรจริง** ทุกหน้าต้องใช้ Node อยู่แล้ว (`/register-lot`, `/status`, `/lot-by-tag`) Node ตายคือเว็บใช้ไม่ได้ตั้งแต่ต้น |
| เพิ่ม hop 1 ชั้น | loopback ต่ำกว่า 1 ms เทียบกับ poll ทุก 300 ms = มองไม่เห็น |
| โหลด polling ย้ายมาลง Node | 10 จอ ≈ 33 req/s เป็นการส่งต่อเฉยๆ — **เบากว่าปัญหา `/status` ที่มีอยู่แล้วหลายเท่า** |
| ต้อง restart backend ตอน deploy | ครั้งเดียว |

---

## 7. ดีกว่าแบบเก่าอย่างไร

| | เดิม | ใหม่ |
|---|---|---|
| แยก reader ด้วย | **port** (ต้องขออนุญาต) | **path** (ไม่ต้องขอใคร) |
| port ที่ต้องขอ IT | 2001, 2002, **2003, 2004** และเพิ่มเรื่อยๆ | 2001, 2002 — **จบ** |
| ขยายเป็น 99 readers | ขอเปิด **99 port** | ขอเพิ่ม **0** |
| เพิ่มหน้าเว็บใหม่ | ขอ port ใหม่ | ขอเพิ่ม **0** |
| Python ถูกยิงจากวง IT | ได้ (ไม่มี auth) | **ไม่ได้** |
| ย้าย port reader | build frontend ใหม่ | แก้ JSON + restart |
| เปลี่ยนวงเน็ต / IP | แก้ 4 ค่าใน `constances.js` | แก้ **1 ค่า** (`BACKEND`) |
| reader ไม่ตอบ | หน้าเว็บเงียบ ไม่รู้สาเหตุ | 502 + `location` + สาเหตุ + log ที่ server |

### หน้าจอชนกันไหม

**ไม่** — `location` ใน path ทำหน้าที่แยก reader แทน port เป๊ะๆ ปลายทางเป็น Python คนละ process คนละหน่วยความจำเหมือนเดิม

แต่มีการชนที่**มีอยู่แล้วก่อนหน้านี้** และ proxy ไม่ได้ทำให้ดีขึ้นหรือแย่ลง คือ `/new-tag` **อ่านแล้วล้างค่าทันที**

```python
# main_dll.py — 3 endpoint นี้ใช้ตัวแปรเดียวกันทั้งหมด
@app.get("/new-tag")           # MultiRegister
@app.get("/new-tag/washing")   # MachineValidate
@app.get("/new-tag/pallet")    # ไม่มีหน้าใช้
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None      # ใครอ่านก่อนได้ก่อน
```

**กฎที่ต้องรักษา: 1 reader = 1 หน้าจอที่ poll อยู่**
เปิด 2 จอชี้ `location` เดียวกันจะแย่ง tag กัน (เป็นแบบนี้ทั้งก่อนและหลัง)

---

## 8. ปัญหาที่ยังเหลืออยู่

### 8.1 ต้องทำก่อนขยายเป็น 99 readers

| # | ปัญหา | ที่ไหน | แรง | จุดชนวน |
|---|---|---|---|---|
| 1 | **SQL pool = 10 (ค่า default)** พอเต็มแล้ว request เข้าคิวรอ 60 วิ แล้ว `ResourceRequest timed out` — จะโดนตอนเปลี่ยนกะที่ MBR 76 เครื่องโหลดงานพร้อมกัน | `backend/database.js:26` | 2 บรรทัด (`pool: { max: 50 }`) | ก่อนเกิน ~15 readers |
| 2 | **`/status` ยิงหา reader ทุกตัวพร้อมกัน** ต่อ 1 request และหน้าเว็บ poll ทุก 3-5 วิ — ที่ 99 readers + 10 จอ = **198 req/s** ทำให้ Node event loop คั่ง | `backend/routes/rfid.js:158` | ~10 บรรทัด (cache 2 วิ) | ก่อนเกิน ~20 readers หรือเปิด MbrMonitor เกิน 3 จอ |
| 3 | **`retryErrors` ไม่มี cap และไม่กันรอบทับ** AS400 ล่ม 1 ชม. → error ~500 แถว → 1 รอบใช้ 66 นาที แต่รอบใหม่มาทุก 5 นาที = **retry storm ถล่ม AS400 เอง** | `backend/routes/as400.js:328` | ~20 บรรทัด | ก่อนขยาย |

ทั้ง 3 ข้อแก้ที่ **backend ล้วน ไม่ต้องแตะ Python ไม่ต้อง build exe** รวมกันไม่ถึง 35 บรรทัด

### 8.2 ควรทำก่อนขยายจริง

| # | ปัญหา | แรง |
|---|---|---|
| 4 | **tag ที่ `/lot-by-tag` พลาดครั้งเดียวจะหลุดจาก lot ตลอดไป** → lot นั้นไม่ยิง A1 pallet-in เลย ความเสี่ยงโตตามจำนวน tag ต่อ lot (131 tag = เสี่ยงสูง) | ~30 บรรทัด + build exe |
| 5 | **`tb_rfid_as400_log` ไม่มีการ archive** โตไปเรื่อยๆ ทำให้ query หน้า History/Dashboard ช้า (ไม่ใช่เรื่องเพดานขนาดแล้ว เพราะ server ใหม่เป็น SQL Standard) | SQL job |

### 8.3 ทำเมื่อมีเวลา

| # | ปัญหา |
|---|---|
| 6 | `process.exit(1)` ที่ `database.js:31` ไม่ log error → DB ต่อไม่ได้ = server ตายเงียบ ไม่บอกสาเหตุ |
| 7 | `catch { }` ว่างๆ ตามหน้าเว็บ → error หายไปเฉยๆ หาสาเหตุไม่ได้ |
| 8 | Python สร้าง connection ใหม่ทุกครั้ง (15 จุด) ควรใช้ `httpx.Client` ตัวเดียวร่วมกัน |
| 9 | `kill_process_by_port()` เรียก `netstat` 1 ครั้งต่อ reader → ที่ 99 ตัว boot ช้า 2-3 นาที |
| 10 | `urlParameter()` ที่ `instance.js:32` อ้าง `API.LOCATION_PORTS` ซึ่งไม่มีจริง → TypeError ถ้ามีใครเรียก (ตอนนี้ไม่มีใครเรียกแล้ว) |

### 8.4 รอปัจจัยภายนอก

| # | เรื่อง | รออะไร |
|---|---|---|
| 11 | **`trackId` ซ้ำกัน** (A1==A2, A3==A4, A5==A6==A7) | **รอ IT ตอบ** ว่า AS400 ใช้ `trackId` เป็น unique key ไหม — ถ้าใช่ต้องแก้ทันที |
| 12 | **timeout นับเป็น SUCCESS** | ขึ้นกับคำตอบข้อ 11 |
| 13 | **backend ไม่มี auth เลย** ใครเข้าถึง 2002 ได้ ยิง API ได้หมด | ตัดสินใจเชิงธุรกิจ |
| 14 | **SA password อยู่ใน git history** | ควร rotate + ลบ block ที่ comment ไว้ `database.js:14-24` |
| 15 | ขอ VM **8 vCPU / 24 GB RAM** + SQL data/log บน SSD | รอ IT แบ่ง VM |

### 8.5 ปิดเคสแล้ว

| เรื่อง | ทำไมปิด |
|---|---|
| SQL Express เพดาน 10 GB / 1 GB RAM / 4 core | spec server ใหม่เป็น **SQL Server Standard** → เพดานหายทั้งหมด |
| Python วิ่งไปหา reader ไม่ถึงข้ามวง | server อยู่ **วง OT เดียวกับ reader** → ไม่ต้องขอ firewall rule |
| `ACCUMULATED_TTL` ทำให้ out ช้า | ปรับ cooldown 60→30 แล้ว out timing ≈ 75 วิ (จาก ~105 วิ) ใกล้ค่าที่ตั้งใจขึ้น |
| A6 checking ขึ้นสองแถวบนเว็บ | ยืนยันแล้วว่าฝั่งเราส่งครั้งเดียว → เป็นที่ IT |
| ชื่อ `W1` พ้องกัน 2 ความหมาย | เปลี่ยน key ใน `location_ports.json` เป็น `WS-04` แล้ว |

### 8.6 ยังไม่ได้ทดสอบบนเครื่องจริง

การเปลี่ยนแปลงทั้งหมดผ่านการทดสอบเฉพาะบนเครื่อง dev:

- ✅ `node --check` ผ่านทุกไฟล์
- ✅ `npm run build` ผ่าน (warning ที่เหลือเป็นของเดิม)
- ✅ ทดสอบ route จริงกับ Python ปลอม 6 เคส (200 / 502 / 404)
- ✅ ทดสอบ logic resolve กับ config จริงทั้งค่าเก่าและค่าใหม่
- ⬜ **ยังไม่ได้ทดสอบบน server จริงกับ reader จริง**

---

## 9. วิธีย้อนกลับ

### สำรองไว้ 3 ชั้น

| ชั้น | มีอะไร |
|---|---|
| 1 | `service/location_ports.json.bak` |
| 2 | git — **7 ไฟล์ที่แก้ สะอาดหมดตอนเริ่ม** ย้อนได้ 100% |
| 3 | โค้ดเดิม comment ไว้ในไฟล์ทุกจุด → ย้อนทีละหน้าได้ |

### คำสั่งย้อนกลับทั้งหมด

```bash
cd /d/RFid_NHT_Washing
git checkout -- backend/routes/rfid.js \
                frontend/src/config/instance.js \
                frontend/src/pages/nht_washing/TagSearch.js \
                frontend/src/pages/nht_washing/MultiRegister.js \
                frontend/src/pages/nht_washing/MachineValidate.js \
                frontend/src/pages/nht_washing/ReaderConfig.js \
                frontend/src/pages/nht_washing/Management/MasterTrayTab.js
cp service/location_ports.json.bak service/location_ports.json
```

### ⚠️ ห้ามใช้ `git checkout .`

จะลบงานที่แก้ค้างไว้ใน 7 ไฟล์ที่**ไม่ได้ถูกแตะใน session นี้**

```
backend/database.js        frontend/src/components/Sidebar.js
backend/server.js          frontend/src/config/constances.js
service/main_dll.py        service/readers_config.json
service/start_rfid.vbs
```

### ย้อนกลับให้ "สแกนได้เหมือนเดิม" (ใช้ NAT 2003/2004)

```json
{
    "REG1": { "port": 2004, "type": "register" },
    "W1":   { "port": 2003, "type": "washing"  }
}
```

แล้วเปิดหน้า Machine Validation ด้วย `?location=W1` เหมือนเดิม

---

## ภาคผนวก — สถาปัตยกรรมปัจจุบัน

```
┌─ วง OT (ปิด) ──────────────────────────┐        ┌─ วง IT ─────┐
│                                        │        │             │
│  RFID reader 5 ตัว (จะเป็น 99)          │        │   Browser   │
│         │ TCP 6000                     │        │  ทุกเครื่อง  │
│         ▼                              │        │      │      │
│  ┌──────────────────────────────┐      │        │      │      │
│  │ Server (VM)                  │      │  NAT   │      │      │
│  │  Python × N   :8000-80xx  ◄──┼──┐   │ :2001  │      │      │
│  │  Node.js      :2002       ◄──┼──┼───┼────────┼──────┘      │
│  │  IIS (web)    :2001          │  │   │ :2002  │             │
│  │  SQL Server Standard         │  │   │        │             │
│  └──────────────────────────────┘  │   │        └─────────────┘
│              └─ localhost ─────────┘   │
│                 ไม่ผ่าน NAT/firewall     │
└────────────────────────────────────────┘
                     │
                     ▼  AS400 API (A1-A7)
```

| Service | Port | ใครเข้าถึงได้ |
|---|---|---|
| IIS (หน้าเว็บ) | 2001 | browser ทุกเครื่อง (ผ่าน NAT) |
| Node.js (API + Reader Proxy) | 2002 | browser ทุกเครื่อง (ผ่าน NAT) |
| Python (1 process / reader) | 8000-80xx | **เฉพาะในเครื่อง** ผ่าน Node เท่านั้น |
| SQL Server | 1433 | เฉพาะในเครื่อง |
| RFID reader hardware | 6000 | เฉพาะวง OT |
