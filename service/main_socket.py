from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import threading
import socket
import time
import winsound
import httpx

# =============================================================================
# CONFIG
# =============================================================================
PORT = 6000  # port ทุกตัวใช้เหมือนกัน

READERS = [
    # ── Register ──────────────────────────────────────────────────────────────
    # {"ip": "192.168.1.101", "port": PORT, "type": "register",  "location": None,  "machine_parts": []},
    # ── Pallet ────────────────────────────────────────────────────────────────
    # {"ip": "192.168.1.102", "port": PORT, "type": "pallet",     "location": "W1",  "machine_parts": []},
    # ── Washing ───────────────────────────────────────────────────────────────
    {"ip": "192.168.1.102", "port": PORT, "type": "washing",    "location": None,  "machine_parts": []},
    # ── On Machine ────────────────────────────────────────────────────────────
    {"ip": "192.168.1.101", "port": PORT, "type": "on_machine", "location": "MBR1","machine_parts": ["2SF-608XZZAT-NTP93"]},
]

COOLDOWN         = 3      # วินาที cooldown ป้องกัน tag ซ้ำเร็วเกินไป (register/pallet/washing)
COMPLETED_DELAY  = 10     # วินาที tag ต้องหายออกถึง completed (จริงใช้ 600)
TAG_EXPIRE       = 1.0    # วินาที — ถ้า reader ไม่ส่ง tag นี้มาซ้ำภายในเวลานี้ ถือว่า "หายไปจากหน้า reader แล้ว"
RECV_TIMEOUT     = 0.3    # วินาที — เวลารอ recv() แต่ละรอบ ก่อนวนกลับมาเช็ค snapshot ใหม่
NODE_URL         = "http://localhost:5000/api/rfid"

# =============================================================================
# PARSE TAGS
# format: [length] 00 ee 00 00 [tag_id byte] [EPC bytes] [checksum 2 bytes]
# tag ID จริง = byte 5
# =============================================================================
def parse_tags(data: bytes) -> list:
    tags = []
    seen = set()
    i = 0
    while i < len(data):
        length = data[i]
        if length == 0:
            break
        if i + 5 >= len(data):
            break
        epc = f"{data[i+5]:04X}"
        if epc not in seen:
            tags.append(epc)
            seen.add(epc)
        i += length + 1
    return tags

# =============================================================================
# STATE แยกต่อ reader
# =============================================================================
reader_states = {}
for r in READERS:
    reader_states[r["ip"]] = {
        "connected":        False,
        "ip":               r["ip"],
        "type":             r["type"],
        "location":         r.get("location"),
        "machine_parts":    r.get("machine_parts", []),
        "last_tags":        [],    # ← snapshot tag ที่ "ยังอยู่หน้า reader ตอนนี้" (มี expire)
        "new_tag":          None,
        "on_machine_active":True,
        "tags_on_machine":  {},
        "tags_disappeared": {},
        "rejected_tags":    set(),
        "socket":           None,
    }

# =============================================================================
# ALARM
# =============================================================================
alarm_active = False

def alarm_loop():
    """loop เสียง alarm จนกว่า alarm_active จะเป็น False"""
    while alarm_active:
        winsound.Beep(2000, 500)
        time.sleep(0.1)

def start_alarm():
    """เริ่มเสียง alarm ถ้ายังไม่ดังอยู่"""
    global alarm_active
    if not alarm_active:
        alarm_active = True
        threading.Thread(target=alarm_loop, daemon=True).start()

def stop_alarm():
    """หยุดเสียง alarm"""
    global alarm_active
    alarm_active = False

# =============================================================================
# SCAN LOOP — ทำงานแยก thread ต่อ reader
# =============================================================================
def scan_loop(reader, state):
    ip        = reader["ip"]
    port      = reader["port"]
    rtype     = reader["type"]
    location  = reader.get("location")
    seen_tags = {}              # cooldown tracker (register/pallet/washing)
    last_seen_window = {}       # ★ เพิ่มใหม่ — tag → เวลาล่าสุดที่ reader ส่งมา (ใช้ทำ snapshot)

    def connect():
        while True:
            try:
                s = socket.socket()
                s.settimeout(5)
                s.connect((ip, port))
                s.settimeout(RECV_TIMEOUT)   # ★ เปลี่ยนจาก None → ใส่ timeout สั้นๆ
                state["socket"]    = s
                state["connected"] = True
                print(f"✅ [{rtype}] Connected: {ip}")
                return s
            except Exception as ex:
                state["connected"] = False
                print(f"❌ [{rtype}] Connect failed: {ip} → {ex}")
                time.sleep(5)

    s = connect()

    while True:
        now = time.time()

        # ── พยายามรับข้อมูลจาก reader (timeout สั้นๆ) ───────────
        try:
            data = s.recv(4096)
            if not data:
                raise ConnectionError("No data")

            tags = parse_tags(data)
            for tag in tags:
                last_seen_window[tag] = now   # ★ บันทึกว่าเพิ่งเห็น tag นี้เมื่อกี้

        except socket.timeout:
            pass   # ★ ไม่มีข้อมูลมาในรอบนี้ ไม่ใช่ error แค่ข้ามไปทำ snapshot ต่อ

        except Exception as ex:
            # reader หลุดจริงๆ → reconnect
            print(f"[{rtype}:{ip}] Disconnected: {ex}")
            state["connected"] = False
            state["last_tags"] = []
            last_seen_window.clear()
            try:
                s.close()
            except:
                pass
            time.sleep(2)
            s = connect()
            continue

        # ── ★ สร้าง snapshot: tag ที่ reader เพิ่งส่งมาภายใน TAG_EXPIRE วิ = ถือว่ายังอยู่ ──
        last_seen_window = {t: v for t, v in last_seen_window.items() if now - v < TAG_EXPIRE}
        tags = list(last_seen_window.keys())
        state["last_tags"] = tags

        # ── register ──────────────────────────────────────────
        if rtype == "register":
            for tag in tags:
                last_seen = seen_tags.get(tag, 0)
                if now - last_seen >= COOLDOWN:
                    seen_tags[tag]   = now
                    state["new_tag"] = tag
                    print(f"[{time.strftime('%H:%M:%S')}] [register] New tag: {tag}")
            seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

        # ── pallet ────────────────────────────────────────────
        elif rtype == "pallet":
            for tag in tags:
                last_seen = seen_tags.get(tag, 0)
                if now - last_seen >= COOLDOWN:
                    seen_tags[tag] = now
                    print(f"[{time.strftime('%H:%M:%S')}] [pallet] New tag: {tag} → {location}")
                    try:
                        res    = httpx.post(f"{NODE_URL}/pallet",
                            json={"tag_id": tag, "location": location},
                            timeout=5)
                        result = res.json().get("result")

                        if result == "TRAY_NOT_COMPLETE":
                            print(f"[pallet] ⚠️ TRAY NOT COMPLETE: {tag}")
                        elif result == "NOT_READY":
                            print(f"[pallet] ⚠️ NOT READY: {tag}")
                        elif result != "OK":
                            print(f"[pallet] ⚠️ {result}: {tag}")
                    except Exception as ex:
                        print(f"[pallet] POST error: {ex}")
            seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

        # ── washing ───────────────────────────────────────────
        elif rtype == "washing":
            for tag in tags:
                last_seen = seen_tags.get(tag, 0)
                if now - last_seen >= COOLDOWN:
                    seen_tags[tag]   = now
                    state["new_tag"] = tag
                    print(f"[{time.strftime('%H:%M:%S')}] [washing] New tag: {tag}")
                    try:
                        httpx.post(f"{NODE_URL}/washing",
                            json={"tag_id": tag},
                            timeout=5)
                    except Exception as ex:
                        print(f"[washing] POST error: {ex}")
            seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

        # ── on_machine → แค่ update last_tags (snapshot ด้านบนทำให้แล้ว) ──
        # logic อยู่ใน scan_loop_on_machine แทน

# =============================================================================
# SCAN LOOP ON MACHINE — ทำงานแยก thread ต่อ reader
# =============================================================================
def scan_loop_on_machine(state):
    """on_machine logic แยก thread ต่อ reader — ใช้ snapshot จาก state['last_tags']"""
    while True:
        if not state["on_machine_active"]:
            time.sleep(0.5)
            continue
        try:
            current_tags  = set(state["last_tags"])   # ← ตอนนี้เป็น snapshot ที่แม่นยำแล้ว
            now           = time.time()
            om_tags       = state["tags_on_machine"]
            disappeared   = state["tags_disappeared"]
            rejected      = state["rejected_tags"]
            machine_parts = state["machine_parts"]

            # tag ใหม่เข้ามา → เช็ค part_no
            new_tags = current_tags - set(om_tags.keys()) - rejected
            for tag in new_tags:
                print(f"[{time.strftime('%H:%M:%S')}] 🔵 ON MACHINE: {tag}")
                try:
                    res     = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                    data    = res.json()
                    part_no = data.get("data", {}).get("part_no")

                    if not part_no:
                        print(f"[alarm] part_no is None: {tag}")
                        rejected.add(tag)
                        start_alarm()
                    else:
                        matched = any(mp.startswith(part_no) for mp in machine_parts)
                        if not matched:
                            print(f"[alarm] MISMATCH: {tag} part_no={part_no}")
                            rejected.add(tag)
                            start_alarm()
                        else:
                            stop_alarm()
                            om_tags[tag] = now
                            disappeared.pop(tag, None)
                            httpx.post(f"{NODE_URL}/on-machine", json={"tag_id": tag}, timeout=5)

                except Exception as ex:
                    print(f"[on_machine] error: {ex}")

            # rejected tag ออก → stop alarm
            removed_rejected = rejected - current_tags
            if removed_rejected:
                rejected -= removed_rejected
                if not rejected:
                    stop_alarm()

            # tag กลับมาก่อน completed → reset
            for tag in current_tags & set(disappeared.keys()):
                print(f"[{time.strftime('%H:%M:%S')}] 🔄 RETURNED: {tag}")
                disappeared.pop(tag, None)
                om_tags[tag] = now

            # tag หายออก → นับเวลา
            for tag in set(om_tags.keys()) - current_tags:
                if tag not in disappeared:
                    disappeared[tag] = now
                    print(f"[{time.strftime('%H:%M:%S')}] 🔴 LEFT: {tag}")

            # หายนาน → completed
            for tag, t in list(disappeared.items()):
                if now - t >= COMPLETED_DELAY:
                    if not state["connected"]:
                        continue
                    print(f"[{time.strftime('%H:%M:%S')}] ✅ COMPLETED: {tag}")
                    om_tags.pop(tag, None)
                    disappeared.pop(tag, None)
                    try:
                        httpx.post(f"{NODE_URL}/completed", json={"tag_id": tag}, timeout=5)
                    except Exception as ex:
                        print(f"[completed] error: {ex}")

            # reader หลุด → reset
            if not state["connected"]:
                disappeared.clear()

            # update tags_on_machine
            state["tags_on_machine"] = {
                k: v for k, v in om_tags.items() if k in current_tags
            }

            # mismatch ออกหมด → stop alarm
            if not (current_tags - set(state["tags_on_machine"].keys())):
                stop_alarm()

        except Exception as ex:
            print(f"[scan_loop_on_machine] Error: {ex}")

        time.sleep(0.3)   # ★ เร็วขึ้นจาก 0.5 → 0.3 ให้ตามทัน snapshot ที่ update ถี่ขึ้น

# =============================================================================
# STARTUP
# =============================================================================
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting RFID socket service...")
    for reader in READERS:
        state = reader_states[reader["ip"]]

        t = threading.Thread(target=scan_loop, args=(reader, state), daemon=True)
        t.start()
        print(f"Started: {reader['type']} → {reader['ip']}")

        if reader["type"] == "on_machine":
            t2 = threading.Thread(target=scan_loop_on_machine, args=(state,), daemon=True)
            t2.start()
            print(f"Started: on_machine loop → {reader['ip']}")

    yield
    for state in reader_states.values():
        try:
            if state["socket"]:
                state["socket"].close()
        except:
            pass
    print("RFID socket service stopped")

# =============================================================================
# FASTAPI APP
# =============================================================================
app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# =============================================================================
# ENDPOINTS
# =============================================================================

@app.get("/status")
def status():
    return {
        "connected": any(s["connected"] for s in reader_states.values()),
        "readers": [
            {"ip": s["ip"], "type": s["type"], "connected": s["connected"]}
            for s in reader_states.values()
        ]
    }

@app.get("/tags")
def get_tags():
    return [
        {
            "ip":   s["ip"],
            "type": s["type"],
            "tags": s["last_tags"],
        }
        for s in reader_states.values()
    ]

@app.get("/new-tag")
def get_new_tag():
    for s in reader_states.values():
        if s["type"] == "register" and s["new_tag"]:
            tag, s["new_tag"] = s["new_tag"], None
            return {"tag_id": tag}
    return {"tag_id": None}

@app.get("/new-tag/washing")
def get_new_tag_washing():
    for s in reader_states.values():
        if s["type"] == "washing" and s["new_tag"]:
            tag          = s["new_tag"]
            s["new_tag"] = None
            return {"tag_id": tag}
    return {"tag_id": None}

@app.get("/new-tag/pallet")
def get_new_tag_pallet():
    for s in reader_states.values():
        if s["type"] == "pallet" and s["new_tag"]:
            tag, s["new_tag"] = s["new_tag"], None
            return {"tag_id": tag, "location": s["location"]}
    return {"tag_id": None}

@app.get("/test-alarm")
def test_alarm():
    threading.Thread(target=start_alarm, daemon=True).start()
    return {"status": "alarm triggered"}