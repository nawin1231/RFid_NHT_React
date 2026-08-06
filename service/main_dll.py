from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import threading
import time
import winsound
import httpx
import json
import os
import sys
from sid_u861 import (
    open_net_port, close_net_port,
    inventory_g2, set_power,
    get_error_desc
)

# ===== CONFIG =====
with open("readers_config.json") as f:
    ALL_READERS = json.load(f)
READER_INDEX = int(os.environ.get("READER_INDEX", "0"))

if READER_INDEX >= len(ALL_READERS):
    print(f"[ERROR] READER_INDEX={READER_INDEX} out of range")
    exit(1)

CFG                    = ALL_READERS[READER_INDEX]
READER_IP              = CFG["ip"]
READER_PORT_TCP        = 6000
READER_POWER           = CFG["power"]
READER_TYPE            = CFG["type"]           # register / pallet / washing / on_machine / completed
READER_PALLET_LOCATION = CFG.get("location")
MACHINE_NO             = CFG.get("machine_no")
MACHINE_PART_NO        = CFG.get("machine_parts", [])
MIN_QTY                = CFG.get("min_qty", 0)

COOLDOWN             = 0.5  # วิ — กัน scan tag ซ้ำ
PALLET_OUT_COOLDOWN  = 10  # วิ — tag หายจาก pallet reader นานเกินนี้ถือว่าออก
MACHINE_OUT_COOLDOWN = 10  # วิ — tag หายจาก on_machine reader นานเกินนี้ถือว่าออก

PROCESS_MAPPING = {
    'washing':    {'process_code': '1201', 'process': 'WATER WASHING 1'},
    'on_machine': {'process_code': '1520', 'process': 'AUTO MATCHING'},
    'completed':  {'process_code': '1520', 'process': 'AUTO MATCHING'},
}
READER_PROCESS_CODE = PROCESS_MAPPING.get(READER_TYPE, {}).get('process_code', '')
READER_PROCESS      = PROCESS_MAPPING.get(READER_TYPE, {}).get('process', '')

NODE_URL = "http://localhost:5000/api/rfid"

# ===== STATE =====
reader_state = {
    "connected":         False,
    "ip":                READER_IP,
    "port_handle":       -1,
    "last_tags":         [],
    "new_tag":           None,
    "on_machine_active": True,
}

# on_machine tracking
current_qty              = 0
tag_qty                  = {}  # qty ของแต่ละ tag
tag_barcode              = {}  # barcode ของแต่ละ tag
tags_on_machine          = {}  # tag ที่อยู่หน้า reader
rejected_tags            = set()  # tag ที่ถูก reject (part ไม่ตรง)
tags_disappeared_machine = {}  # tag หายรอ cooldown ก่อน out

# pallet tracking
tags_on_pallet           = {}
tags_disappeared_pallet  = {}
lot_tray_count           = {}
lot_tags                 = {}

scanning    = False
scan_thread = None

# ===== ALARM =====
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
        print(f"[{time.strftime('%H:%M:%S')}] [ALARM] ON")
        # publish_to_plc("1")  # รอ MQTT จาก PLC

def stop_alarm():
    global alarm_active
    alarm_active = False
    # publish_to_plc("0")  # รอ MQTT จาก PLC

# ===== SCAN LOOP — register / washing =====
def scan_loop():
    global scanning
    seen_tags = {}

    while scanning:
        try:
            tags = inventory_g2(reader_state["port_handle"])
            reader_state["last_tags"] = tags
            now = time.time()

            if READER_TYPE == "register":
                for tag in tags:
                    if now - seen_tags.get(tag, 0) >= COOLDOWN:
                        seen_tags[tag]          = now
                        reader_state["new_tag"] = tag
                        print(f"[{time.strftime('%H:%M:%S')}] [REGISTER] {tag}")
                        try:
                            httpx.post(f"{NODE_URL}/register-event", json={
                                "tag_id": tag, "location": READER_PALLET_LOCATION
                            }, timeout=5)
                        except Exception as ex:
                            print(f"[register] error: {ex}")
                seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

            elif READER_TYPE == "washing":
                for tag in tags:
                    if now - seen_tags.get(tag, 0) >= COOLDOWN:
                        seen_tags[tag]          = now
                        reader_state["new_tag"] = tag
                        print(f"[{time.strftime('%H:%M:%S')}] [WASHING] {tag}")
                        try:
                            res = httpx.post(f"{NODE_URL}/washing", json={
                                "tag_id":       tag,
                                "location":     READER_PALLET_LOCATION,
                                "machine_no":   READER_PALLET_LOCATION,
                                "process_code": READER_PROCESS_CODE,
                                "process":      READER_PROCESS,
                            }, timeout=5)
                            result = res.json().get("result")
                            if result not in ("OK", "LOT_WASHED"):
                                print(f"[washing] WARNING {result}: {tag}")
                        except Exception as ex:
                            print(f"[washing] error: {ex}")
                seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

        except Exception as ex:
            print(f"[{time.strftime('%H:%M:%S')}] Reader disconnected: {ex}")
            reader_state["connected"]   = False
            reader_state["last_tags"]   = []
            reader_state["port_handle"] = -1
            scanning = False
            return
        time.sleep(1)

# ===== SCAN LOOP — on_machine =====
def scan_loop_on_machine():
    global tags_on_machine, rejected_tags
    global current_qty, tag_qty

    while True:
        if not reader_state["connected"]:
            time.sleep(1)
            continue

        if reader_state["on_machine_active"]:
            try:
                current_tags = set(reader_state["last_tags"])
                now          = time.time()

                # tag กลับมาก่อน cooldown → ยกเลิก out
                returned_tags = set(tags_disappeared_machine.keys()) & current_tags
                for tag in returned_tags:
                    print(f"[MACHINE RETURNED] {tag} barcode={tag_barcode.get(tag)} qty={tag_qty.get(tag)}")
                    print(f"[{time.strftime('%H:%M:%S')}] [MACHINE RETURNED] {tag}")
                    tags_disappeared_machine.pop(tag, None)
                    tags_on_machine[tag] = now

                # tag ใหม่เข้ามา
                new_tags = current_tags - set(tags_on_machine.keys()) - rejected_tags
                for tag in new_tags:
                    print(f"[{time.strftime('%H:%M:%S')}] [ON MACHINE] {tag}")
                    try:
                        res     = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                        data    = res.json()
                        part_no = data.get("data", {}).get("part_no")

                        if not part_no:
                            print(f"[on_machine] part_no not found: {tag}")
                            rejected_tags.add(tag)
                            start_alarm()
                        else:
                            matched = part_no in MACHINE_PART_NO
                            if not matched:
                                try:
                                    res_conv      = httpx.get(f"{NODE_URL}/part-convert/{part_no}", timeout=5)
                                    conv_data     = res_conv.json()
                                    converted_parts = [
                                        item.get("partConvertTo") for item in conv_data
                                        if isinstance(item, dict)
                                    ] if isinstance(conv_data, list) else []
                                    matched = any(cp and cp in MACHINE_PART_NO for cp in converted_parts)
                                except Exception as e:
                                    print(f"[part-convert] error: {e}")

                            if not matched:
                                print(f"[on_machine] MISMATCH: {tag} part={part_no}")
                                rejected_tags.add(tag)
                                start_alarm()
                            else:
                                stop_alarm()
                                tags_on_machine[tag] = now
                                res    = httpx.post(f"{NODE_URL}/on-machine", json={
                                    "tag_id":       tag,
                                    "machine_no":   MACHINE_NO or READER_PALLET_LOCATION,
                                    "process_code": READER_PROCESS_CODE,
                                    "process":      READER_PROCESS,
                                }, timeout=5)
                                result = res.json().get("result")
                                if result in ("LOT_NOT_READY", "NOT_WASHED"):
                                    print(f"[on_machine] WARNING {result}: {tag}")
                                    tags_on_machine.pop(tag, None)
                                    rejected_tags.add(tag)
                                    start_alarm()
                                else:
                                    raw_qty          = data.get("data", {}).get("tray_qty", 0)
                                    tray_qty_val     = raw_qty[0] if isinstance(raw_qty, list) else int(raw_qty or 0)
                                    tag_qty[tag]     = tray_qty_val
                                    tag_barcode[tag] = data.get("data", {}).get("barcode")
                                    print(f"[on_machine] tag={tag} barcode={tag_barcode[tag]}")
                                    current_qty     += tray_qty_val
                                    print(f"[on_machine] OK {tag} qty+={tray_qty_val} total={current_qty}")

                    except Exception as ex:
                        print(f"[on_machine] error: {ex}")

                # rejected tag ออก → stop alarm ถ้าไม่มีเหลือ
                removed_rejected = rejected_tags - current_tags
                if removed_rejected:
                    rejected_tags -= removed_rejected
                    if not rejected_tags:
                        stop_alarm()

                # tag หายออก → เริ่มนับ cooldown
                left_tags = set(tags_on_machine.keys()) - current_tags
                for tag in left_tags:
                    if tag not in tags_disappeared_machine:
                        print(f"[{time.strftime('%H:%M:%S')}] [MACHINE MISSING] {tag} waiting {MACHINE_OUT_COOLDOWN}s")
                        tags_disappeared_machine[tag] = now
                    tags_on_machine.pop(tag, None)

                # tag หายเกิน cooldown → ส่ง out
                for tag, t in list(tags_disappeared_machine.items()):
                    if now - t >= MACHINE_OUT_COOLDOWN:
                        qty_removed  = tag_qty.pop(tag, 0)
                        current_qty  = max(current_qty - qty_removed, 0)
                        tags_disappeared_machine.pop(tag, None)
                        print(f"[{time.strftime('%H:%M:%S')}] [MACHINE OUT] {tag} qty-={qty_removed} total={current_qty}")
                        try:
                            httpx.post(f"{NODE_URL}/on-machine-out", json={
                                "tag_id":     tag,
                                "barcode":    tag_barcode.pop(tag, None),
                                "qty":        qty_removed,
                                "machine_no": MACHINE_NO or READER_PALLET_LOCATION,
                            }, timeout=5)
                        except Exception as ex:
                            print(f"[on-machine-out] error: {ex}")

                if not (current_tags - set(tags_on_machine.keys())):
                    stop_alarm()

            except Exception as ex:
                print(f"[scan_loop_on_machine] error: {ex}")

        time.sleep(1)

# ===== SCAN LOOP — completed =====
def scan_loop_completed():
    seen_tags = {}

    while True:
        if not reader_state["connected"]:
            time.sleep(1)
            continue

        try:
            tags = reader_state["last_tags"]
            now  = time.time()

            for tag in tags:
                if now - seen_tags.get(tag, 0) >= COOLDOWN:
                    seen_tags[tag] = now
                    print(f"[{time.strftime('%H:%M:%S')}] [COMPLETED] {tag}")
                    try:
                        res    = httpx.post(f"{NODE_URL}/completed", json={"tag_id": tag}, timeout=5)
                        result = res.json().get("result")
                        if result == "LOT_COMPLETED":
                            print(f"[completed] LOT COMPLETED: {tag}")
                        elif result == "NOT_ON_MACHINE":
                            print(f"[completed] WARNING NOT_ON_MACHINE: {tag}")
                            start_alarm()
                            time.sleep(1)
                            stop_alarm()
                        elif result not in ("OK",):
                            print(f"[completed] WARNING {result}: {tag}")
                    except Exception as ex:
                        print(f"[completed] error: {ex}")

            seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

        except Exception as ex:
            print(f"[scan_loop_completed] error: {ex}")

        time.sleep(1)

# ===== SCAN LOOP — pallet =====
def scan_loop_pallet():
    global tags_on_pallet, lot_tray_count, lot_tags, tags_disappeared_pallet

    while True:
        if not reader_state["connected"]:
            time.sleep(1)
            continue

        try:
            current_tags = set(reader_state["last_tags"])
            now          = time.time()

            # tag ใหม่เข้ามา
            new_tags = current_tags - set(tags_on_pallet.keys())
            for tag in new_tags:
                if tag in tags_disappeared_pallet:
                    print(f"[{time.strftime('%H:%M:%S')}] [PALLET RETURNED] {tag}")
                    tags_disappeared_pallet.pop(tag, None)

                print(f"[{time.strftime('%H:%M:%S')}] [PALLET IN] {tag} -> {READER_PALLET_LOCATION}")
                try:
                    res    = httpx.post(f"{NODE_URL}/pallet",
                        json={"tag_id": tag, "location": READER_PALLET_LOCATION}, timeout=5)
                    result = res.json().get("result")
                    if result in ("OK", "DUPLICATE_LOCATION"):
                        tags_on_pallet[tag] = now
                        lot_res      = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                        lot_data     = lot_res.json().get("data", {})
                        barcode      = lot_data.get("barcode")
                        tray_counter = lot_data.get("tray_counter", 0)
                        if barcode:
                            lot_tray_count[barcode] = tray_counter
                            lot_tags.setdefault(barcode, set()).add(tag)
                            print(f"[pallet] lot={barcode} ({len(lot_tags[barcode])}/{tray_counter})")
                    else:
                        print(f"[pallet] WARNING {result}: {tag}")
                except Exception as ex:
                    print(f"[pallet] error: {ex}")

            # tag หายออก → เริ่มนับ cooldown
            left_tags = set(tags_on_pallet.keys()) - current_tags
            for tag in left_tags:
                if tag not in tags_disappeared_pallet:
                    print(f"[{time.strftime('%H:%M:%S')}] [PALLET MISSING] {tag} waiting {PALLET_OUT_COOLDOWN}s")
                    tags_disappeared_pallet[tag] = now
                tags_on_pallet.pop(tag, None)

            # tag หายเกิน cooldown → ส่ง out
            for tag, t in list(tags_disappeared_pallet.items()):
                if now - t >= PALLET_OUT_COOLDOWN:
                    print(f"[{time.strftime('%H:%M:%S')}] [PALLET OUT] {tag}")
                    tags_disappeared_pallet.pop(tag, None)
                    barcode = next((b for b, tags in lot_tags.items() if tag in tags), None)
                    if barcode:
                        remaining = lot_tags[barcode] & set(tags_on_pallet.keys())
                        print(f"[pallet] lot={barcode} remaining={len(remaining)}/{lot_tray_count.get(barcode, 0)}")
                        if len(remaining) == 0 and len(lot_tags.get(barcode, set())) >= lot_tray_count.get(barcode, 0):
                            print(f"[{time.strftime('%H:%M:%S')}] [PALLET LOT OUT] lot={barcode}")
                            try:
                                httpx.post(f"{NODE_URL}/pallet-lot-out", json={
                                    "barcode": barcode, "location": READER_PALLET_LOCATION
                                }, timeout=5)
                            except Exception as ex:
                                print(f"[pallet-lot-out] error: {ex}")
                            lot_tags.pop(barcode, None)
                            lot_tray_count.pop(barcode, None)

            if not reader_state["connected"]:
                tags_on_pallet.clear()
                lot_tags.clear()
                lot_tray_count.clear()
                tags_disappeared_pallet.clear()

            tags_on_pallet = {k: v for k, v in tags_on_pallet.items() if k in current_tags}

        except Exception as ex:
            print(f"[scan_loop_pallet] error: {ex}")

        time.sleep(1)

# ===== CONNECT & RECONNECT =====
def connect_reader():
    global scanning, scan_thread
    for _ in range(3):
        try:
            close_net_port(reader_state["port_handle"])
        except:
            pass
        time.sleep(1)

    reader_state["port_handle"] = -1
    time.sleep(2)

    result, handle = open_net_port(READER_IP, READER_PORT_TCP)
    if result == 0:
        reader_state["port_handle"] = handle
        set_power(READER_POWER, handle)
        reader_state["connected"] = True
        scanning    = True
        scan_thread = threading.Thread(target=scan_loop, daemon=True)
        scan_thread.start()
        print(f"[{time.strftime('%H:%M:%S')}] [OK] [{READER_TYPE}] Connected: {READER_IP}")
    else:
        reader_state["connected"]   = False
        reader_state["port_handle"] = -1
        print(f"[{time.strftime('%H:%M:%S')}] [FAIL] Connect failed: {get_error_desc(result)}")

def reconnect_loop():
    fail_count = 0
    while True:
        if not reader_state["connected"]:
            print(f"[{time.strftime('%H:%M:%S')}] Reconnecting...")
            connect_reader()
            if not reader_state["connected"]:
                fail_count += 1
                if fail_count >= 3:
                    print(f"[FAIL] Too many retries → exiting")
                    os._exit(1)
            else:
                fail_count = 0
        time.sleep(5)

# ===== FASTAPI =====
@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"Starting [{READER_TYPE}] @ {READER_IP} (index={READER_INDEX})")
    threading.Thread(target=reconnect_loop, daemon=True).start()
    if READER_TYPE == "on_machine":
        threading.Thread(target=scan_loop_on_machine, daemon=True).start()
    if READER_TYPE == "pallet":
        threading.Thread(target=scan_loop_pallet, daemon=True).start()
    if READER_TYPE == "completed":
        threading.Thread(target=scan_loop_completed, daemon=True).start()
    yield
    global scanning
    scanning = False
    if reader_state["port_handle"] != -1:
        close_net_port(reader_state["port_handle"])
    print("Service stopped")

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

@app.get("/status")
def status():
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

@app.get("/restart")
def restart_reader():
    def do_restart():
        time.sleep(1)
        os.execv(sys.executable, [
            sys.executable, '-m', 'uvicorn',
            'main_dll:app', '--port', str(CFG['port']), '--log-level', 'warning'
        ])
    threading.Thread(target=do_restart, daemon=True).start()
    return {"result": "OK"}

# ===== MQTT (รอข้อมูล PLC) =====
# import paho.mqtt.client as mqtt
# MQTT_BROKER = "192.168.1.xxx"
# MQTT_PORT   = 1883
# MQTT_TOPIC  = "plc/alarm"
# def publish_to_plc(payload: str):
#     try:
#         client = mqtt.Client()
#         client.connect(MQTT_BROKER, MQTT_PORT, keepalive=5)
#         client.publish(MQTT_TOPIC, payload)
#         client.disconnect()
#     except Exception as ex:
#         print(f"[MQTT] error: {ex}")