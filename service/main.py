from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import threading
import time
import winsound
import httpx
import os
import sys

from sid_u861 import (
    open_net_port, close_net_port, inventory_g2, set_power, get_error_desc
)

# ==========================================
# 🛠️ CONFIG สำหรับเทส (แก้ตรงนี้เพื่อเปลี่ยนร่าง)
# ==========================================
# READER_TYPE            = "register"
# READER_TYPE            = "pallet"
# READER_TYPE            = "washing"
# READER_TYPE            = "on_machine"
READER_TYPE            = "completed"

READER_IP              = "192.168.1.101"
READER_PORT            = 6000
READER_POWER           = 20
READER_PALLET_LOCATION = "W1"
MACHINE_NO             = "FFL29"
MACHINE_PART_NO        = ["2SF-608XZZAT-NTP93"]
MIN_QTY                = 1000

COOLDOWN = 5
NODE_URL = "http://localhost:5000/api/rfid"

# ==========================================
# 💾 STATE VARIABLES
# ==========================================
reader_state = {
    "connected":         False,
    "ip":                READER_IP,
    "port_handle":       -1,
    "last_tags":         [],
    "new_tag":           None,
    "on_machine_active": True,
}

scanning     = False
alarm_active = False

# State สำหรับ on_machine
tags_on_machine = {}
rejected_tags   = set()
current_qty     = 0
tag_qty         = {}

# State สำหรับ pallet
tags_on_pallet  = {}
lot_tray_count  = {}
lot_tags        = {}

# ==========================================
# 🚨 ALARM LOGIC
# ==========================================
def alarm_loop():
    while alarm_active:
        winsound.Beep(2000, 500)
        time.sleep(0.1)

def start_alarm():
    global alarm_active
    if not alarm_active:
        alarm_active = True
        threading.Thread(target=alarm_loop, daemon=True).start()

def stop_alarm():
    global alarm_active
    alarm_active = False

# ==========================================
# 📡 SCAN LOOPS (แยกตาม Process)
# ==========================================

# 1. Base Loop & (Register / Washing)
def scan_loop_general():
    global scanning
    seen_tags = {}

    while scanning:
        try:
            tags = inventory_g2(reader_state["port_handle"])
            reader_state["last_tags"] = tags
            now = time.time()

            # Logic สำหรับ Register
            if READER_TYPE == "register":
                for tag in tags:
                    if now - seen_tags.get(tag, 0) >= COOLDOWN:
                        seen_tags[tag] = now
                        reader_state["new_tag"] = tag
                        print(f"[{time.strftime('%H:%M:%S')}] [register] New tag: {tag}")
                        try:
                            httpx.post(f"{NODE_URL}/register-event", json={"tag_id": tag, "location": READER_PALLET_LOCATION}, timeout=5)
                        except Exception as ex:
                            print(f"[register error]: {ex}")

            # Logic สำหรับ Washing
            elif READER_TYPE == "washing":
                for tag in tags:
                    if now - seen_tags.get(tag, 0) >= COOLDOWN:
                        seen_tags[tag] = now
                        reader_state["new_tag"] = tag
                        print(f"[{time.strftime('%H:%M:%S')}] [washing] New tag: {tag}")
                        try:
                            res = httpx.post(f"{NODE_URL}/washing", json={"tag_id": tag, "location": READER_PALLET_LOCATION}, timeout=5)
                            if res.json().get("result") == "LOT_NOT_READY":
                                print(f"[washing] [WARNING] LOT NOT READY: {tag} (pallet ไม่ครบ)")
                        except Exception as ex:
                            print(f"[washing error]: {ex}")

            # เคลียร์ tag ที่หมด cooldown สำหรับ Register / Washing
            if READER_TYPE in ["register", "washing"]:
                seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

        except Exception as ex:
            print(f"[{time.strftime('%H:%M:%S')}] Reader disconnected: {ex}")
            reader_state["connected"] = False
            reader_state["port_handle"] = -1
            scanning = False
            return

        time.sleep(0.5)

# 2. On Machine Logic
def scan_loop_on_machine():
    global tags_on_machine, rejected_tags, current_qty, tag_qty
    while True:
        if reader_state["connected"] and reader_state["on_machine_active"]:
            try:
                current_tags = set(reader_state["last_tags"])
                now = time.time()
                new_tags = current_tags - set(tags_on_machine.keys()) - rejected_tags
                
                # ของเข้า
                for tag in new_tags:
                    print(f"[{time.strftime('%H:%M:%S')}] [ON MACHINE] {tag}")
                    try:
                        res = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                        data = res.json().get("data", {})
                        part_no = data.get("part_no")

                        if not part_no or not any(mp.startswith(part_no) for mp in MACHINE_PART_NO):
                            print(f"[alarm] MISMATCH: {tag}")
                            rejected_tags.add(tag)
                            start_alarm()
                        else:
                            stop_alarm()
                            tags_on_machine[tag] = now
                            res = httpx.post(f"{NODE_URL}/on-machine", json={"tag_id": tag}, timeout=5)
                            
                            if res.json().get("result") == "LOT_NOT_READY":
                                print(f"[on_machine] WARNING: LOT NOT READY")
                                tags_on_machine.pop(tag, None)
                                rejected_tags.add(tag)
                                start_alarm()
                            else:
                                raw_qty = data.get("tray_qty", 0)
                                tray_qty_val = raw_qty[0] if isinstance(raw_qty, list) else int(raw_qty or 0)
                                tag_qty[tag] = tray_qty_val
                                current_qty += tray_qty_val
                    except Exception as ex:
                        print(f"[on_machine error]: {ex}")

                # ของออก
                removed_rejected = rejected_tags - current_tags
                if removed_rejected:
                    rejected_tags -= removed_rejected
                    if not rejected_tags: stop_alarm()

                left_tags = set(tags_on_machine.keys()) - current_tags
                for tag in left_tags:
                    qty_removed = tag_qty.pop(tag, 0)
                    current_qty = max(0, current_qty - qty_removed)
                    tags_on_machine.pop(tag, None)

            except Exception as ex:
                pass
        time.sleep(0.5)

# 3. Pallet Logic
def scan_loop_pallet():
    global tags_on_pallet, lot_tray_count, lot_tags
    while True:
        if reader_state["connected"]:
            try:
                current_tags = set(reader_state["last_tags"])
                now = time.time()
                new_tags = current_tags - set(tags_on_pallet.keys())
                
                # ของเข้า Pallet
                for tag in new_tags:
                    try:
                        res = httpx.post(f"{NODE_URL}/pallet", json={"tag_id": tag, "location": READER_PALLET_LOCATION}, timeout=5)
                        if res.json().get("result") in ("OK", "DUPLICATE_LOCATION"):
                            tags_on_pallet[tag] = now
                            lot_data = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5).json().get("data", {})
                            barcode = lot_data.get("barcode")
                            tray_counter = lot_data.get("tray_counter", 0)
                            if barcode:
                                lot_tray_count[barcode] = tray_counter
                                if barcode not in lot_tags: lot_tags[barcode] = set()
                                lot_tags[barcode].add(tag)
                    except: pass

                # ของออกจาก Pallet
                left_tags = set(tags_on_pallet.keys()) - current_tags
                for tag in left_tags:
                    tags_on_pallet.pop(tag, None)
                    barcode = next((b for b, tags in lot_tags.items() if tag in tags), None)
                    if barcode:
                        remaining = lot_tags[barcode] & set(tags_on_pallet.keys())
                        if len(remaining) == 0 and len(lot_tags.get(barcode, set())) >= lot_tray_count.get(barcode, 0):
                            lot_tags.pop(barcode, None)
                            lot_tray_count.pop(barcode, None)

                tags_on_pallet = {k: v for k, v in tags_on_pallet.items() if k in current_tags}
            except: pass
        time.sleep(0.5)

# 4. Completed Logic
def scan_loop_completed():
    seen_tags = {}
    while True:
        if reader_state["connected"]:
            try:
                tags = reader_state["last_tags"]
                now = time.time()
                for tag in tags:
                    if now - seen_tags.get(tag, 0) >= COOLDOWN:
                        seen_tags[tag] = now
                        print(f"[{time.strftime('%H:%M:%S')}] [COMPLETED SCAN] {tag}")
                        try:
                            res = httpx.post(f"{NODE_URL}/completed", json={
                                "tag_id": tag
                                }, timeout=5)
                            if res.json().get("result") == "NOT_ON_MACHINE":
                                print(f"[completed] WARNING: NOT ON MACHINE")
                                start_alarm()
                                time.sleep(1)
                                stop_alarm()
                        except: pass
                seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}
            except: pass
        time.sleep(0.5)


# ==========================================
# 🔌 CONNECTION & LIFESPAN
# ==========================================
def connect_reader():
    global scanning
    time.sleep(1)
    result, handle = open_net_port(READER_IP, READER_PORT)
    if result == 0:
        reader_state.update({"port_handle": handle, "connected": True})
        set_power(READER_POWER, handle)
        scanning = True
        threading.Thread(target=scan_loop_general, daemon=True).start()
        print(f"[OK] [{READER_TYPE}] Connected: {READER_IP}")
    else:
        reader_state["connected"] = False

def reconnect_loop():
    while True:
        if not reader_state["connected"]:
            connect_reader()
        time.sleep(5)

@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"Starting {READER_TYPE} service (TEST MODE)")
    threading.Thread(target=reconnect_loop, daemon=True).start()
    
    # เลือกรัน Loop เพิ่มเติมตาม Type
    if READER_TYPE == "on_machine":
        threading.Thread(target=scan_loop_on_machine, daemon=True).start()
    elif READER_TYPE == "pallet":
        threading.Thread(target=scan_loop_pallet, daemon=True).start()
    elif READER_TYPE == "completed":
        threading.Thread(target=scan_loop_completed, daemon=True).start()
        
    yield
    global scanning
    scanning = False
    if reader_state["port_handle"] != -1:
        close_net_port(reader_state["port_handle"])

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ==========================================
# 🌐 API ENDPOINTS
# ==========================================
@app.get("/status")
def status():
    global current_qty
    return {
        "connected":   reader_state["connected"],
        "ip":          reader_state["ip"],
        "type":        READER_TYPE,
        "location":    READER_PALLET_LOCATION,
        "current_qty": current_qty,
        "min_qty":     MIN_QTY,
        "low_qty":     MIN_QTY > 0 and current_qty < MIN_QTY,
    }

@app.get("/tags")
def get_tags():
    return {"tags": reader_state["last_tags"], "count": len(reader_state["last_tags"])}

@app.get("/new-tag")
def get_new_tag():
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None
    return {"tag_id": tag}

@app.get("/new-tag/washing")
def get_new_tag_washing():
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None
    return {"tag_id": tag}

@app.get("/new-tag/pallet")
def get_new_tag_pallet():
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None
    return {"tag_id": tag, "location": READER_PALLET_LOCATION}

@app.get("/test-alarm")
def test_alarm():
    threading.Thread(target=start_alarm, daemon=True).start()
    return {"status": "alarm triggered"}