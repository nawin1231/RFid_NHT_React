from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import threading
import time
import winsound
import httpx
import json
import os
from sid_u861 import (
    open_net_port, close_net_port,
    inventory_g2,  set_power,
    get_error_desc
)

# CONFIG โหลด config ของ reader นี้จาก readers_config.json
# เพิ่มตัวใหม่ที่ readers_config.json ตั้ง index ใหม่ไปด้วย
with open("readers_config.json") as f:
    ALL_READERS = json.load(f)

READER_INDEX = int(os.environ.get("READER_INDEX", "0"))
CFG          = ALL_READERS[READER_INDEX]

READER_IP              = CFG["ip"]
READER_PORT_TCP        = 6000
READER_POWER           = CFG["power"]
READER_TYPE            = CFG["type"]               # register / pallet / washing / on_machine
READER_PALLET_LOCATION = CFG.get("location")
MACHINE_NO             = CFG.get("machine_no")
MACHINE_PART_NO        = CFG.get("machine_parts", [])

COOLDOWN        = 3    # วินาที cooldown ป้องกัน tag ซ้ำเร็วเกินไป
COMPLETED_DELAY = 10   # วินาที tag ต้องหายออกถึง completed
NODE_URL        = "http://localhost:5000/api/rfid"

# STATE
reader_state = {
    "connected":         False,
    "ip":                READER_IP,
    "port_handle":       -1,
    "last_tags":         [],
    "new_tag":           None,
    "on_machine_active": True,
}

scanning    = False
scan_thread = None

tags_on_machine  = {}
tags_disappeared = {}
rejected_tags    = set()

# ALARM
alarm_active = False

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

# SCAN LOOP อ่าน tag ทุก 0.5 วิ (ใช้ร่วมกันทุก type)
def scan_loop():
    global scanning
    seen_tags = {}

    while scanning:
        try:
            tags = inventory_g2(reader_state["port_handle"])
            reader_state["last_tags"] = tags
            now = time.time()

            # register เก็บ new_tag ให้ React poll + POST ไป Node.js
            if READER_TYPE == "register":
                for tag in tags:
                    last_seen = seen_tags.get(tag, 0)
                    if now - last_seen >= COOLDOWN:
                        seen_tags[tag]          = now
                        reader_state["new_tag"] = tag
                        print(f"[{time.strftime('%H:%M:%S')}] [register] New tag: {tag} → {READER_PALLET_LOCATION}")
                        try:
                            httpx.post(f"{NODE_URL}/register-event", json={
                                "tag_id":   tag,
                                "location": READER_PALLET_LOCATION
                            }, timeout=5)
                        except Exception as ex:
                            print(f"[register-event] POST error: {ex}")
                seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

            # pallet POST location อัตโนมัติ
            elif READER_TYPE == "pallet":
                for tag in tags:
                    last_seen = seen_tags.get(tag, 0)
                    if now - last_seen >= COOLDOWN:
                        seen_tags[tag] = now
                        print(f"[{time.strftime('%H:%M:%S')}] [pallet] New tag: {tag} → {READER_PALLET_LOCATION}")
                        try:
                            res    = httpx.post(f"{NODE_URL}/pallet",
                                json={"tag_id": tag, "location": READER_PALLET_LOCATION},
                                timeout=5)
                            result = res.json().get("result")
                            if result not in ("OK",):
                                print(f"[pallet] ⚠️ {result}: {tag}")
                        except Exception as ex:
                            print(f"[pallet] POST error: {ex}")
                seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

            # washing POST washing + เก็บ new_tag
            elif READER_TYPE == "washing":
                for tag in tags:
                    last_seen = seen_tags.get(tag, 0)
                    if now - last_seen >= COOLDOWN:
                        seen_tags[tag]          = now
                        reader_state["new_tag"] = tag
                        print(f"[{time.strftime('%H:%M:%S')}] [washing] New tag: {tag} → {READER_PALLET_LOCATION}")
                        try:
                            res    = httpx.post(f"{NODE_URL}/washing", json={
                                "tag_id":   tag,
                                "location": READER_PALLET_LOCATION
                            }, timeout=5)
                            result = res.json().get("result")
                            if result == "LOT_NOT_READY":
                                print(f"[washing] ⚠️ LOT NOT READY: {tag} → pallet ยังไม่ครบทุก tray")
                            elif result not in ("OK",):
                                print(f"[washing] ⚠️ {result}: {tag}")
                        except Exception as ex:
                            print(f"[washing] POST error: {ex}")
                seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

        except Exception as ex:
            print(f"[{time.strftime('%H:%M:%S')}] Reader disconnected: {ex}")
            reader_state["connected"]   = False
            reader_state["last_tags"]   = []
            reader_state["port_handle"] = -1
            scanning = False
            return

        time.sleep(0.5)

# SCAN LOOP on_machine (ใช้เฉพาะ type = on_machine)
def scan_loop_on_machine():
    global tags_on_machine, tags_disappeared, rejected_tags

    while True:
        if reader_state["on_machine_active"]:
            try:
                current_tags = set(reader_state["last_tags"])
                now          = time.time()

                # tag ใหม่เข้ามา เช็ค part_no ก่อน
                new_tags = current_tags - set(tags_on_machine.keys()) - rejected_tags
                for tag in new_tags:
                    print(f"[{time.strftime('%H:%M:%S')}] 🔵 ON MACHINE: {tag}")
                    try:
                        res     = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                        data    = res.json()
                        part_no = data.get("data", {}).get("part_no")

                        if not part_no:
                            print(f"[alarm] part_no is None: {tag}")
                            rejected_tags.add(tag)
                            start_alarm()
                        else:
                            matched = any(mp.startswith(part_no) for mp in MACHINE_PART_NO)
                            if not matched:
                                print(f"[alarm] MISMATCH: {tag} part_no={part_no}")
                                rejected_tags.add(tag)
                                start_alarm()
                            else:
                                stop_alarm()
                                tags_on_machine[tag] = now
                                tags_disappeared.pop(tag, None)
                                res    = httpx.post(f"{NODE_URL}/on-machine", json={"tag_id": tag}, timeout=5)
                                result = res.json().get("result")
                                if result == "LOT_NOT_READY":
                                    # washing ยังไม่ครบทุก tray → ไม่ให้ผ่าน on_machine
                                    print(f"[on_machine] ⚠️ LOT NOT READY: {tag} → washing ยังไม่ครบทุก tray")
                                    tags_on_machine.pop(tag, None)
                                    rejected_tags.add(tag)
                                    start_alarm()

                    except Exception as ex:
                        print(f"[on_machine] error: {ex}")

                # rejected tag ออกจาก reader stop alarm
                removed_rejected = rejected_tags - current_tags
                if removed_rejected:
                    rejected_tags -= removed_rejected
                    if not rejected_tags:
                        stop_alarm()

                # tag กลับมาก่อน completed reset timer
                for tag in current_tags & set(tags_disappeared.keys()):
                    print(f"[{time.strftime('%H:%M:%S')}] 🔄 RETURNED: {tag}")
                    tags_disappeared.pop(tag, None)
                    tags_on_machine[tag] = now

                # tag หายออก เริ่มนับเวลา
                for tag in set(tags_on_machine.keys()) - current_tags:
                    if tag not in tags_disappeared:
                        tags_disappeared[tag] = now
                        print(f"[{time.strftime('%H:%M:%S')}] 🔴 LEFT: {tag}")

                # หายนานเกิน COMPLETED_DELAY completed
                for tag, t in list(tags_disappeared.items()):
                    if now - t >= COMPLETED_DELAY:
                        if not reader_state["connected"]:
                            continue
                        print(f"[{time.strftime('%H:%M:%S')}] ✅ COMPLETED: {tag}")
                        tags_on_machine.pop(tag, None)
                        tags_disappeared.pop(tag, None)
                        try:
                            # จะเช็คว่าทุก tray ใน lot นี้ completed ครบหรือยัง
                            res    = httpx.post(f"{NODE_URL}/completed", json={"tag_id": tag}, timeout=5)
                            result = res.json().get("result")
                            if result == "LOT_COMPLETED":
                                # ทุก tray completed ครบ lot จบ tag พร้อมวนใช้ใหม่
                                print(f"[{time.strftime('%H:%M:%S')}] 🎉 LOT Successfully!")
                        except Exception as ex:
                            print(f"[completed] error: {ex}")

                # reader หลุด reset disappeared
                if not reader_state["connected"]:
                    tags_disappeared.clear()

                # update tags_on_machine ให้ตรงกับ current_tags
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

    result, handle = open_net_port(READER_IP, READER_PORT_TCP)
    print(f"Connect result: {get_error_desc(result)}")

    if result == 0:
        reader_state["port_handle"] = handle
        set_power(READER_POWER, handle)
        reader_state["connected"] = True
        scanning    = True
        scan_thread = threading.Thread(target=scan_loop, daemon=True)
        scan_thread.start()
        print(f"✅ [{READER_TYPE}] Connected: {READER_IP}")
    else:
        reader_state["connected"]   = False
        reader_state["port_handle"] = -1
        print(f"❌ Connect failed: {get_error_desc(result)}")

def reconnect_loop():
    while True:
        if not reader_state["connected"]:
            print(f"[{time.strftime('%H:%M:%S')}] Reconnecting...")
            connect_reader()
        time.sleep(5)

# STARTUP / SHUTDOWN
@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"Starting {READER_TYPE} service @ {READER_IP} (index={READER_INDEX})")
    threading.Thread(target=reconnect_loop, daemon=True).start()
    if READER_TYPE == "on_machine":
        threading.Thread(target=scan_loop_on_machine, daemon=True).start()
    yield
    global scanning
    scanning = False
    if reader_state["port_handle"] != -1:
        close_net_port(reader_state["port_handle"])
    print("Service stopped")

# FASTAPI APP
app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ENDPOINTS

# ดูสถานะการเชื่อมต่อ reader
@app.get("/status")
def status():
    return {"connected": reader_state["connected"], "ip": reader_state["ip"], "type": READER_TYPE}

# ดู tag ทั้งหมดที่อยู่ในระยะ reader ตอนนี้
@app.get("/tags")
def get_tags():
    return {"tags": reader_state["last_tags"], "count": len(reader_state["last_tags"])}

# ดึง tag ใหม่ล่าสุด ใช้กับ register
@app.get("/new-tag")
def get_new_tag():
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None
    return {"tag_id": tag}

# ดึง tag ใหม่ล่าสุด ใช้กับ washing reader MachineValidate poll
@app.get("/new-tag/washing")
def get_new_tag_washing():
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None
    return {"tag_id": tag}

# ดึง tag ใหม่ล่าสุด ใช้กับ pallet reader return location ด้วย
@app.get("/new-tag/pallet")
def get_new_tag_pallet():
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None
    return {"tag_id": tag, "location": READER_PALLET_LOCATION}

# ทดสอบเสียง alarm
@app.get("/test-alarm")
def test_alarm():
    threading.Thread(target=start_alarm, daemon=True).start()
    return {"status": "alarm triggered"}