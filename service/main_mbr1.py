from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import threading
import time
import winsound
import httpx
from sid_u861 import (
    open_net_port, close_net_port,
    inventory_g2,  set_power,
    get_error_desc
)

#Config
READER_IP       = "192.168.1.102"
READER_PORT     = 6000
READER_POWER    = 5
MACHINE_NO      = "FFL29"                   # ← แก้ตรงนี้
MACHINE_PART_NO = ["2SF-608XZZAT-NTP93"]    # ← แก้ตรงนี้
COOLDOWN        = 3
COMPLETED_DELAY = 10                        # 10 นาที production
NODE_URL        = "http://localhost:5000/api/rfid"

#State
reader_state = {
    "connected":         False,
    "ip":                READER_IP,
    "port":              READER_PORT,
    "port_handle":       -1,
    "last_tags":         [],
    "on_machine_active": True,
}

scanning    = False
scan_thread = None

tags_on_machine  = {}
tags_disappeared = {}
rejected_tags    = set()

# ALARM
alarm_active = False

#Scan loop แจ้งเตือน loop เสียง alarm จนกว่า alarm_active จะเป็น False
def alarm_loop():
    while alarm_active:
        winsound.Beep(2000, 500)
        time.sleep(0.1)

#เริ่มเสียง alarm
def start_alarm():
    global alarm_active
    if not alarm_active:
        alarm_active = True
        threading.Thread(target=alarm_loop, daemon=True).start()

#หยุดเสียง alarm
def stop_alarm():
    global alarm_active
    alarm_active = False

# SCAN LOOP หา tag
def scan_loop():
    global scanning
    while scanning:
        try:
            tags = inventory_g2(reader_state["port_handle"])
            reader_state["last_tags"] = tags
        except Exception as ex:
            print(f"[{time.strftime('%H:%M:%S')}] Reader disconnected: {ex}")
            reader_state["connected"]   = False
            reader_state["last_tags"]   = []
            reader_state["port_handle"] = -1
            scanning = False
            return
        time.sleep(0.5)
        
# SCAN LOOP OnMachine อัตโนมัติ
def scan_loop_on_machine():
    global tags_on_machine, tags_disappeared, rejected_tags
    while True:
        if reader_state["on_machine_active"]:
            try:
                current_tags = set(reader_state["last_tags"])
                now          = time.time()

                # tag ใหม่เข้ามา → เช็ค part_no
                new_tags = current_tags - set(tags_on_machine.keys()) - rejected_tags
                for tag in new_tags:
                    print(f"[{time.strftime('%H:%M:%S')}] [on_machine] New tag: {tag}")
                    try:
                        res     = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                        data    = res.json()
                        part_no = data.get("data", {}).get("part_no")
                        matched = any(mp.startswith(part_no) for mp in MACHINE_PART_NO)
                        if not matched:
                            print(f"[alarm] MISMATCH: {tag} part_no={part_no}")
                            rejected_tags.add(tag)
                            start_alarm()
                        else:
                            stop_alarm()
                            tags_on_machine[tag] = now
                            tags_disappeared.pop(tag, None)
                            httpx.post(f"{NODE_URL}/on-machine", json={"tag_id": tag}, timeout=5)
                    except Exception as ex:
                        print(f"[on_machine] error: {ex}")

                # rejected tag ออก stop alarm
                removed_rejected = rejected_tags - current_tags
                if removed_rejected:
                    rejected_tags -= removed_rejected
                    if not rejected_tags:
                        stop_alarm()

                # tag กลับมาก่อน completed reset
                for tag in current_tags & set(tags_disappeared.keys()):
                    tags_disappeared.pop(tag, None)
                    tags_on_machine[tag] = now

                # tag หายออก นับเวลา
                for tag in set(tags_on_machine.keys()) - current_tags:
                    if tag not in tags_disappeared:
                        tags_disappeared[tag] = now
                        print(f"[{time.strftime('%H:%M:%S')}] [on_machine] Tag disappeared: {tag}")

                # หายนาน completed
                for tag, t in list(tags_disappeared.items()):
                    if now - t >= COMPLETED_DELAY:
                        if not reader_state["connected"]:
                            continue
                        print(f"[{time.strftime('%H:%M:%S')}] [on_machine] Tag completed: {tag}")
                        tags_on_machine.pop(tag, None)
                        tags_disappeared.pop(tag, None)
                        try:
                            httpx.post(f"{NODE_URL}/completed", json={"tag_id": tag}, timeout=5)
                        except Exception as ex:
                            print(f"[completed] error: {ex}")

                # reader หลุด reset
                if not reader_state["connected"]:
                    tags_disappeared.clear()

                # update tags_on_machine
                tags_on_machine = {k: v for k, v in tags_on_machine.items() if k in current_tags}

                # mismatch ออกหมด stop alarm
                if not (current_tags - set(tags_on_machine.keys())):
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
        print(f"✅ Connected to {READER_IP}:{READER_PORT}")
    else:
        reader_state["connected"]   = False
        reader_state["port_handle"] = -1
        print(f"❌ Connect failed: {get_error_desc(result)}")

# AUTO RECONNECT
def reconnect_loop():
    while True:
        if not reader_state["connected"]:
            print(f"[{time.strftime('%H:%M:%S')}] Reconnecting...")
            connect_reader()
        time.sleep(5)

# STARTUP / SHUTDOWN
@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"Starting MBR service... machine={MACHINE_NO}")
    threading.Thread(target=reconnect_loop, daemon=True).start()
    threading.Thread(target=scan_loop_on_machine, daemon=True).start()
    yield
    global scanning
    scanning = False
    if reader_state["port_handle"] != -1:
        close_net_port(reader_state["port_handle"])
    print("MBR service stopped")

# FASTAPI APP
app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ENDPOINTS
# ดูสถานะการเชื่อมต่อ reader
@app.get("/status")
def status():
    return {
        "connected":  reader_state["connected"],
        "ip":         reader_state["ip"],
        "machine_no": MACHINE_NO,
    }

# ดู tag ทั้งหมดที่อยู่ในระยะ reader
@app.get("/tags")
def get_tags():
    return {"tags": reader_state["last_tags"], "count": len(reader_state["last_tags"])}

# # เปิด on_machine 
# @app.post("/on-machine/start")
# def start_on_machine():
#     reader_state["on_machine_active"] = True
#     print(f"[{time.strftime('%H:%M:%S')}] On machine started")
#     return {"status": "started"}

# # ปิด on_machine
# @app.post("/on-machine/stop")
# def stop_on_machine():
#     reader_state["on_machine_active"] = False
#     print(f"[{time.strftime('%H:%M:%S')}] On machine stopped")
#     return {"status": "stopped"}

# ทดสอบเสียง alarm
@app.get("/test-alarm")
def test_alarm():
    threading.Thread(target=start_alarm, daemon=True).start()
    return {"status": "alarm triggered"}