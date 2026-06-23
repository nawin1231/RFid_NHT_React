from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import threading
import time
import winsound
import httpx
from sid_u861 import (
    open_net_port,  close_net_port,
    open_com_port,  close_com_port,
    inventory_g2,   set_power,
    get_error_desc, buzzer_and_led
)

# CONFIG
READER_IP              = "192.168.1.101"
READER_PORT            = 6000
READER_POWER           = 20
READER_PALLET_LOCATION = "W1"
MACHINE_NO             = "FFL29"
MACHINE_PART_NO        = ["2SF-608XZZAT-NTP93"]

COOLDOWN        = 3
COMPLETED_DELAY = 10

NODE_URL = "http://localhost:5000/api/rfid"

# STATE
reader_state = {
    "connected":         False,
    "ip":                READER_IP,
    "port":              READER_PORT,
    "port_handle":       -1,
    "last_tags":         [],
    "new_tag":           None,
    "new_tag_washing":   None,
    "on_machine_active": False,
    "new_tag_pallet":    None,
}

scanning    = False
scan_thread = None

tags_on_machine  = {}
tags_disappeared = {}
rejected_tags    = set()

# ALARM
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
        t = threading.Thread(target=alarm_loop, daemon=True)
        t.start()

def stop_alarm():
    """หยุดเสียง alarm"""
    global alarm_active
    alarm_active = False

def alarm_mismatch():
    """เรียกตอน part_no ไม่ตรงกับ machine"""
    start_alarm()

# SCAN LOOP register / washing / machine validate
def scan_loop():
    global scanning
    seen_tags = {}

    while scanning:
        try:
            tags = inventory_g2(reader_state["port_handle"])
            reader_state["last_tags"] = tags
            now = time.time()

            for tag in tags:
                last_seen = seen_tags.get(tag, 0)
                if now - last_seen >= COOLDOWN:
                    seen_tags[tag]          = now
                    reader_state["new_tag"] = tag
                    print(f"[{time.strftime('%H:%M:%S')}] New tag: {tag}")

            seen_tags = {k: v for k, v in seen_tags.items() if k in tags}

        except Exception as ex:
            print(f"[{time.strftime('%H:%M:%S')}] Reader disconnected: {ex}")
            reader_state["connected"]    = False
            reader_state["last_tags"]    = []
            reader_state["port_handle"]  = -1  # ← reset handle ตอนหลุด
            scanning = False
            return

        time.sleep(1)

# SCAN LOOP on_machine
def scan_loop_on_machine():
    global tags_on_machine, tags_disappeared, rejected_tags 

    while True:
        if reader_state["on_machine_active"]:
            try:
                current_tags = set(reader_state["last_tags"])
                now          = time.time()

                # tag ใหม่เข้ามา → เช็ค part_no ก่อน
                new_tags = current_tags - set(tags_on_machine.keys()) - rejected_tags
                for tag in new_tags:
                    print(f"[{time.strftime('%H:%M:%S')}] [on_machine] New tag: {tag}")
                    try:
                        res     = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                        data    = res.json()
                        part_no = data.get("data", {}).get("part_no")

                        # เช็คว่า machine part_no startswith job ticket part_no
                        matched = any(
                            machine_part.startswith(part_no)
                            for machine_part in MACHINE_PART_NO
                        )

                        if not matched:
                            # ไม่ตรง alarm ไม่ให้ on_machine
                            print(f"[alarm] MISMATCH: {tag} part_no={part_no}")
                            rejected_tags.add(tag) 
                            start_alarm()
                        else:
                            # ตรง on_machine
                            stop_alarm()
                            tags_on_machine[tag] = now
                            tags_disappeared.pop(tag, None)
                            httpx.post(f"{NODE_URL}/on-machine", json={"tag_id": tag}, timeout=5)

                    except Exception as ex:
                        print(f"[on_machine] error: {ex}")

                # rejected tag ออกจาก reader stop alarm
                removed_rejected = rejected_tags - current_tags
                if removed_rejected:
                    rejected_tags -= removed_rejected
                    if not rejected_tags:
                        stop_alarm()

                # tag กลับมาก่อน completed reset timer
                returned_tags = current_tags & set(tags_disappeared.keys())
                for tag in returned_tags:
                    print(f"[{time.strftime('%H:%M:%S')}] [on_machine] Tag returned: {tag}")
                    tags_disappeared.pop(tag, None)
                    tags_on_machine[tag] = now

                # tag หายออก เริ่มนับเวลา
                removed_tags = set(tags_on_machine.keys()) - current_tags
                for tag in removed_tags:
                    if tag not in tags_disappeared:
                        tags_disappeared[tag] = now
                        print(f"[{time.strftime('%H:%M:%S')}] [on_machine] Tag disappeared: {tag}")

                # tag หายนานเกิน COMPLETED_DELAY completed
                for tag, disappeared_time in list(tags_disappeared.items()):
                    if now - disappeared_time >= COMPLETED_DELAY:
                        if not reader_state["connected"]:
                            print(f"[{time.strftime('%H:%M:%S')}] [on_machine] Reader disconnected → skip completed")
                            continue
                        print(f"[{time.strftime('%H:%M:%S')}] [on_machine] Tag completed: {tag}")
                        tags_on_machine.pop(tag, None)
                        tags_disappeared.pop(tag, None)
                        try:
                            httpx.post(f"{NODE_URL}/completed", json={"tag_id": tag}, timeout=5)
                        except Exception as ex:
                            print(f"[completed] POST error: {ex}")

                # reader หลุด reset disappeared
                if not reader_state["connected"]:
                    tags_disappeared.clear()

                # update tags_on_machine
                tags_on_machine = {
                    k: v for k, v in tags_on_machine.items()
                    if k in current_tags
                }

                # mismatch tag ออกหมดแล้ว stop alarm
                mismatch_tags = current_tags - set(tags_on_machine.keys())
                if not mismatch_tags:
                    stop_alarm()

            except Exception as ex:
                print(f"[scan_loop_on_machine] Error: {ex}")

        time.sleep(0.5)

# CONNECT READER
def connect_reader():
    global scanning, scan_thread

    try:
        if reader_state["port_handle"] != -1:
            close_net_port(reader_state["port_handle"])
    except:
        pass

    time.sleep(1)

    result, handle = open_net_port(READER_IP, READER_PORT)
    print(f"Connect result: {get_error_desc(result)}")

    if result == 0:
        reader_state["port_handle"] = handle 
        set_power(READER_POWER, handle)
        reader_state["connected"] = True
        scanning    = True
        scan_thread = threading.Thread(target=scan_loop, daemon=True)
        scan_thread.start()
        print(f"✅ Connected to {READER_IP}:{READER_PORT} handle={handle}")
    else:
        reader_state["connected"]   = False
        reader_state["port_handle"] = -1
        print(f"❌ Connect failed: {get_error_desc(result)}")

# AUTO RECONNECT
def reconnect_loop():
    """วน loop เช็ค connection ถ้าหลุด → reconnect"""
    while True:
        if not reader_state["connected"]:
            print(f"[{time.strftime('%H:%M:%S')}] Reconnecting...")
            connect_reader()
        time.sleep(5)

# STARTUP / SHUTDOWN
@asynccontextmanager
async def lifespan(app: FastAPI):
    print("Starting RFID service...")
    t1 = threading.Thread(target=reconnect_loop, daemon=True)
    t1.start()
    t2 = threading.Thread(target=scan_loop_on_machine, daemon=True)
    t2.start()
    yield
    global scanning
    scanning = False
    if reader_state["port_handle"] != -1:
        close_net_port(reader_state["port_handle"])
    print("RFID service stopped")

# FASTAPI APP
app = FastAPI(lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ENDPOINTS
# ดูสถานะการเชื่อมต่อ reader
@app.get("/status")
def status():
    return {
        "connected":   reader_state["connected"],
        "ip":          reader_state["ip"],
        "port":        reader_state["port"],
        "port_handle": reader_state["port_handle"],
    }

# ดู tag ทั้งหมดที่อยู่ในระยะ reader ตอนนี้
@app.get("/tags")
def get_tags():
    return {
        "tags":  reader_state["last_tags"],
        "count": len(reader_state["last_tags"])
    }

# ดึง tag ใหม่ล่าสุด ใช้กับ register + machine validate
@app.get("/new-tag")
def get_new_tag():
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None
    return {"tag_id": tag}

# ดึง tag ใหม่ล่าสุด ใช้กับ washing reader
@app.get("/new-tag/washing")
def get_new_tag_washing():
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None
    return {"tag_id": tag}

# ดึง tag ใหม่ล่าสุด ใช้กับ on_machine reader
@app.get("/new-tag/on-machine")
def get_new_tag_on_machine():
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None
    return {"tag_id": tag}

# เปิด on_machine reader เริ่ม track tag
@app.post("/on-machine/start")
def start_on_machine():
    reader_state["on_machine_active"] = True
    print(f"[{time.strftime('%H:%M:%S')}] On machine started")
    return {"status": "started"}

# ปิด on_machine reader หยุด track tag
@app.post("/on-machine/stop")
def stop_on_machine():
    reader_state["on_machine_active"] = False
    print(f"[{time.strftime('%H:%M:%S')}] On machine stopped")
    return {"status": "stopped"}

# ดึง tag ใหม่ล่าสุด ใช้กับ pallet reader return location
@app.get("/new-tag/pallet")
def get_new_tag_pallet():
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None
    return {"tag_id": tag, "location": READER_PALLET_LOCATION}

# ทดสอบเสียง alarm
@app.get("/test-alarm")
def test_alarm():
    t = threading.Thread(target=alarm_mismatch, daemon=True)
    t.start()
    return {"status": "alarm triggered"}