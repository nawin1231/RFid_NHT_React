from fastapi import FastAPI, HTTPException
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

ENABLED_READERS = [r for r in ALL_READERS if r.get("enabled", True)]

COOLDOWN             = 10
PALLET_OUT_COOLDOWN  = 10
MACHINE_OUT_COOLDOWN = 10

PROCESS_MAPPING = {
    'washing':    {'process_code': '1201', 'process': 'WATER WASHING 1'},
    'on_machine': {'process_code': '1520', 'process': 'AUTO MATCHING'},
    'completed':  {'process_code': '1520', 'process': 'AUTO MATCHING'},
}

NODE_URL = "http://localhost:5000/api/rfid"

# ===== STATE — แยกต่อ reader =====
def make_reader_state(cfg):
    return {
        "cfg":                      cfg,
        "connected":                False,
        "port_handle":              -1,
        "last_tags":                [],
        "new_tag":                  None,
        "seen_tags":                {},
        "on_machine_active":        True,
        # on_machine
        "current_qty":              0,
        "tag_qty":                  {},
        "tag_barcode":              {},
        "tags_on_machine":          {},
        "rejected_tags":            set(),
        "tags_disappeared_machine": {},
        # pallet
        "tags_on_pallet":           {},
        "tags_disappeared_pallet":  {},
        "lot_tray_count":           {},
        "lot_tags":                 {},
        # alarm
        "alarm_active":             False,
    }

readers = [make_reader_state(cfg) for cfg in ENABLED_READERS]

# ===== ALARM — แยกต่อ reader =====
def start_alarm(r):
    if not r["alarm_active"]:
        r["alarm_active"] = True
        def _loop():
            while r["alarm_active"]:
                winsound.Beep(2000, 500)
                time.sleep(0.1)
        threading.Thread(target=_loop, daemon=True).start()

def stop_alarm(r):
    r["alarm_active"] = False

# ===== SCAN LOOP — register / washing =====
def scan_loop(r):
    cfg          = r["cfg"]
    reader_type  = cfg["type"]
    location     = cfg.get("location")
    process_code = PROCESS_MAPPING.get(reader_type, {}).get("process_code", "")
    process      = PROCESS_MAPPING.get(reader_type, {}).get("process", "")

    while r["connected"]:
        try:
            tags = inventory_g2(r["port_handle"])
            r["last_tags"] = tags
            now = time.time()

            if reader_type == "register":
                for tag in tags:
                    if now - r["seen_tags"].get(tag, 0) >= COOLDOWN:
                        r["seen_tags"][tag] = now
                        r["new_tag"]        = tag
                        print(f"[{time.strftime('%H:%M:%S')}] [REGISTER] {tag}")
                        try:
                            httpx.post(f"{NODE_URL}/register-event", json={
                                "tag_id": tag, "location": location
                            }, timeout=3)
                        except Exception as ex:
                            print(f"[register] error: {ex}")
                r["seen_tags"] = {k: v for k, v in r["seen_tags"].items() if now - v < COOLDOWN}

            elif reader_type == "washing":
                for tag in tags:
                    if now - r["seen_tags"].get(tag, 0) >= COOLDOWN:
                        r["seen_tags"][tag] = now
                        r["new_tag"]        = tag
                        print(f"[{time.strftime('%H:%M:%S')}] [WASHING] {tag}")
                        try:
                            res = httpx.post(f"{NODE_URL}/washing", json={
                                "tag_id":       tag,
                                "location":     location,
                                "machine_no":   location,
                                "process_code": process_code,
                                "process":      process,
                            }, timeout=3)
                            result = res.json().get("result")
                            if result not in ("OK", "LOT_WASHED"):
                                print(f"[washing] WARNING {result}: {tag}")
                        except Exception as ex:
                            print(f"[washing] error: {ex}")
                r["seen_tags"] = {k: v for k, v in r["seen_tags"].items() if now - v < COOLDOWN}

        except Exception as ex:
            print(f"[{time.strftime('%H:%M:%S')}] Reader disconnected: {ex}")
            r["connected"]   = False
            r["last_tags"]   = []
            r["port_handle"] = -1
            return

        time.sleep(1)

# ===== SCAN LOOP — on_machine =====
def scan_loop_on_machine(r):
    cfg          = r["cfg"]
    machine_no   = cfg.get("machine_no")
    location     = cfg.get("location")
    machine_parts = cfg.get("machine_parts", [])
    process_code = PROCESS_MAPPING["on_machine"]["process_code"]
    process      = PROCESS_MAPPING["on_machine"]["process"]

    while True:
        if not r["connected"]:
            time.sleep(1)
            continue

        if r["on_machine_active"]:
            try:
                current_tags = set(r["last_tags"])
                now          = time.time()

                # tag กลับมาก่อน cooldown → ยกเลิก out
                returned_tags = set(r["tags_disappeared_machine"].keys()) & current_tags
                for tag in returned_tags:
                    print(f"[{time.strftime('%H:%M:%S')}] [MACHINE RETURNED] {tag}")
                    r["tags_disappeared_machine"].pop(tag, None)
                    r["tags_on_machine"][tag] = now

                # tag ใหม่เข้ามา
                new_tags = current_tags - set(r["tags_on_machine"].keys()) - r["rejected_tags"]
                for tag in new_tags:
                    print(f"[{time.strftime('%H:%M:%S')}] [ON MACHINE] {tag}")
                    try:
                        res     = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=3)
                        data    = res.json()
                        part_no = data.get("data", {}).get("part_no")

                        if not part_no:
                            print(f"[on_machine] part_no not found: {tag}")
                            r["rejected_tags"].add(tag)
                            start_alarm(r)
                        else:
                            matched = part_no in machine_parts
                            if not matched:
                                try:
                                    res_conv      = httpx.get(f"{NODE_URL}/part-convert/{part_no}", timeout=3)
                                    conv_data     = res_conv.json()
                                    converted_parts = [
                                        item.get("partConvertTo") for item in conv_data
                                        if isinstance(item, dict)
                                    ] if isinstance(conv_data, list) else []
                                    matched = any(cp and cp in machine_parts for cp in converted_parts)
                                except Exception as e:
                                    print(f"[part-convert] error: {e}")

                            if not matched:
                                print(f"[on_machine] MISMATCH: {tag} part={part_no}")
                                r["rejected_tags"].add(tag)
                                start_alarm(r)
                            else:
                                stop_alarm(r)
                                r["tags_on_machine"][tag] = now
                                res    = httpx.post(f"{NODE_URL}/on-machine", json={
                                    "tag_id":       tag,
                                    "machine_no":   machine_no or location,
                                    "process_code": process_code,
                                    "process":      process,
                                }, timeout=3)
                                result = res.json().get("result")
                                if result in ("LOT_NOT_READY", "NOT_WASHED"):
                                    print(f"[on_machine] WARNING {result}: {tag}")
                                    r["tags_on_machine"].pop(tag, None)
                                    r["rejected_tags"].add(tag)
                                    start_alarm(r)
                                else:
                                    raw_qty              = data.get("data", {}).get("tray_qty", 0)
                                    tray_qty_val         = raw_qty[0] if isinstance(raw_qty, list) else int(raw_qty or 0)
                                    r["tag_qty"][tag]    = tray_qty_val
                                    r["tag_barcode"][tag] = data.get("data", {}).get("barcode")
                                    r["current_qty"]     += tray_qty_val
                                    print(f"[on_machine] OK {tag} qty+={tray_qty_val} total={r['current_qty']}")

                    except Exception as ex:
                        print(f"[on_machine] error: {ex}")

                # rejected tag ออก → stop alarm ถ้าไม่มีเหลือ
                removed_rejected = r["rejected_tags"] - current_tags
                if removed_rejected:
                    r["rejected_tags"] -= removed_rejected
                    if not r["rejected_tags"]:
                        stop_alarm(r)

                # tag หายออก → เริ่มนับ cooldown
                left_tags = set(r["tags_on_machine"].keys()) - current_tags
                for tag in left_tags:
                    if tag not in r["tags_disappeared_machine"]:
                        print(f"[{time.strftime('%H:%M:%S')}] [MACHINE MISSING] {tag} waiting {MACHINE_OUT_COOLDOWN}s")
                        r["tags_disappeared_machine"][tag] = now
                    r["tags_on_machine"].pop(tag, None)

                # tag หายเกิน cooldown → ส่ง out
                for tag, t in list(r["tags_disappeared_machine"].items()):
                    if now - t >= MACHINE_OUT_COOLDOWN:
                        qty_removed      = r["tag_qty"].pop(tag, 0)
                        r["current_qty"] = max(r["current_qty"] - qty_removed, 0)
                        r["tags_disappeared_machine"].pop(tag, None)
                        print(f"[{time.strftime('%H:%M:%S')}] [MACHINE OUT] {tag} qty-={qty_removed} total={r['current_qty']}")
                        try:
                            httpx.post(f"{NODE_URL}/on-machine-out", json={
                                "tag_id":     tag,
                                "barcode":    r["tag_barcode"].pop(tag, None),
                                "qty":        qty_removed,
                                "machine_no": machine_no or location,
                            }, timeout=3)
                        except Exception as ex:
                            print(f"[on-machine-out] error: {ex}")

                if not (current_tags - set(r["tags_on_machine"].keys())):
                    stop_alarm(r)

            except Exception as ex:
                print(f"[scan_loop_on_machine] error: {ex}")

        time.sleep(1)

        # ===== SCAN LOOP — completed =====
def scan_loop_completed(r):
    while True:
        if not r["connected"]:
            time.sleep(1)
            continue
        try:
            tags = r["last_tags"]
            now  = time.time()
            for tag in tags:
                if now - r["seen_tags"].get(tag, 0) >= COOLDOWN:
                    r["seen_tags"][tag] = now
                    print(f"[{time.strftime('%H:%M:%S')}] [COMPLETED] {tag}")
                    try:
                        res    = httpx.post(f"{NODE_URL}/completed", json={"tag_id": tag}, timeout=3)
                        result = res.json().get("result")
                        if result == "NOT_ON_MACHINE":
                            print(f"[completed] WARNING NOT_ON_MACHINE: {tag}")
                            start_alarm(r)
                            time.sleep(1)
                            stop_alarm(r)
                        elif result not in ("OK", "LOT_COMPLETED"):
                            print(f"[completed] WARNING {result}: {tag}")
                    except Exception as ex:
                        print(f"[completed] error: {ex}")
            r["seen_tags"] = {k: v for k, v in r["seen_tags"].items() if now - v < COOLDOWN}
        except Exception as ex:
            print(f"[scan_loop_completed] error: {ex}")
        time.sleep(1)

# ===== SCAN LOOP — pallet =====
def scan_loop_pallet(r):
    while True:
        if not r["connected"]:
            time.sleep(1)
            continue
        try:
            location     = r["cfg"].get("location")
            current_tags = set(r["last_tags"])
            now          = time.time()

            # tag กลับมาก่อน cooldown → ยกเลิก out
            new_tags = current_tags - set(r["tags_on_pallet"].keys())
            for tag in new_tags:
                if tag in r["tags_disappeared_pallet"]:
                    print(f"[{time.strftime('%H:%M:%S')}] [PALLET RETURNED] {tag}")
                    r["tags_disappeared_pallet"].pop(tag, None)

                print(f"[{time.strftime('%H:%M:%S')}] [PALLET IN] {tag} -> {location}")
                try:
                    res    = httpx.post(f"{NODE_URL}/pallet",
                        json={"tag_id": tag, "location": location}, timeout=3)
                    result = res.json().get("result")
                    if result in ("OK", "DUPLICATE_LOCATION"):
                        r["tags_on_pallet"][tag] = now
                        lot_res      = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=3)
                        lot_data     = lot_res.json().get("data", {})
                        barcode      = lot_data.get("barcode")
                        tray_counter = lot_data.get("tray_counter", 0)
                        if barcode:
                            r["lot_tray_count"][barcode] = tray_counter
                            r["lot_tags"].setdefault(barcode, set()).add(tag)
                            print(f"[pallet] lot={barcode} ({len(r['lot_tags'][barcode])}/{tray_counter})")
                    else:
                        print(f"[pallet] WARNING {result}: {tag}")
                except Exception as ex:
                    print(f"[pallet] error: {ex}")

            # tag หายออก → เริ่มนับ cooldown
            left_tags = set(r["tags_on_pallet"].keys()) - current_tags
            for tag in left_tags:
                if tag not in r["tags_disappeared_pallet"]:
                    print(f"[{time.strftime('%H:%M:%S')}] [PALLET MISSING] {tag} waiting {PALLET_OUT_COOLDOWN}s")
                    r["tags_disappeared_pallet"][tag] = now
                r["tags_on_pallet"].pop(tag, None)

            # tag หายเกิน cooldown → ส่ง out
            for tag, t in list(r["tags_disappeared_pallet"].items()):
                if now - t >= PALLET_OUT_COOLDOWN:
                    print(f"[{time.strftime('%H:%M:%S')}] [PALLET OUT] {tag}")
                    r["tags_disappeared_pallet"].pop(tag, None)
                    barcode = next((b for b, tags in r["lot_tags"].items() if tag in tags), None)
                    if barcode:
                        remaining = r["lot_tags"][barcode] & set(r["tags_on_pallet"].keys())
                        if len(remaining) == 0 and len(r["lot_tags"].get(barcode, set())) >= r["lot_tray_count"].get(barcode, 0):
                            print(f"[{time.strftime('%H:%M:%S')}] [PALLET LOT OUT] lot={barcode}")
                            try:
                                httpx.post(f"{NODE_URL}/pallet-lot-out", json={
                                    "barcode": barcode, "location": location
                                }, timeout=3)
                            except Exception as ex:
                                print(f"[pallet-lot-out] error: {ex}")
                            r["lot_tags"].pop(barcode, None)
                            r["lot_tray_count"].pop(barcode, None)

            if not r["connected"]:
                r["tags_on_pallet"].clear()
                r["lot_tags"].clear()
                r["lot_tray_count"].clear()
                r["tags_disappeared_pallet"].clear()

            r["tags_on_pallet"] = {k: v for k, v in r["tags_on_pallet"].items() if k in current_tags}

        except Exception as ex:
            print(f"[scan_loop_pallet] error: {ex}")
        time.sleep(1)

# ===== CONNECT & RECONNECT =====
def connect_reader(r):
    cfg = r["cfg"]
    for _ in range(3):
        try:
            close_net_port(r["port_handle"])
        except:
            pass
        time.sleep(1)

    r["port_handle"] = -1
    time.sleep(2)

    result, handle = open_net_port(cfg["ip"], 6000)
    if result == 0:
        r["port_handle"] = handle
        set_power(cfg["power"], handle)
        r["connected"] = True
        threading.Thread(target=scan_loop, args=(r,), daemon=True).start()
        print(f"[{time.strftime('%H:%M:%S')}] [OK] [{cfg['type']}] Connected: {cfg['ip']}")
    else:
        r["connected"]   = False
        r["port_handle"] = -1
        print(f"[{time.strftime('%H:%M:%S')}] [FAIL] {cfg['ip']}: {get_error_desc(result)}")

def reconnect_loop(r):
    fail_count = 0
    while True:
        if not r["connected"]:
            print(f"[{time.strftime('%H:%M:%S')}] Reconnecting {r['cfg']['ip']}...")
            connect_reader(r)
            if not r["connected"]:
                fail_count += 1
                if fail_count >= 3:
                    print(f"[FAIL] {r['cfg']['ip']} too many retries → stopping")
                    return  # หยุดแค่ reader นี้ ไม่ exit ทั้ง process
            else:
                fail_count = 0
        time.sleep(5)

# ===== FASTAPI =====
@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"Starting {len(readers)} readers...")
    for i, r in enumerate(readers):
        cfg = r["cfg"]
        threading.Thread(target=reconnect_loop, args=(r,), daemon=True).start()
        if cfg["type"] == "on_machine":
            threading.Thread(target=scan_loop_on_machine, args=(r,), daemon=True).start()
        if cfg["type"] == "pallet":
            threading.Thread(target=scan_loop_pallet, args=(r,), daemon=True).start()
        if cfg["type"] == "completed":
            threading.Thread(target=scan_loop_completed, args=(r,), daemon=True).start()
        print(f"  [{i}] {cfg['type']} @ {cfg['ip']} location={cfg.get('location')}")
    yield
    print("Shutting down...")

app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ===== ROUTES =====
@app.get("/status/all")
def status_all():
    return {"readers": [
        {
            "index":       i,
            "type":        r["cfg"]["type"],
            "ip":          r["cfg"]["ip"],
            "location":    r["cfg"].get("location"),
            "port":        r["cfg"]["port"],
            "connected":   r["connected"],
            "current_qty": r["current_qty"],
            "min_qty":     r["cfg"].get("min_qty", 0),
            "low_qty":     r["cfg"].get("min_qty", 0) > 0 and r["current_qty"] < r["cfg"].get("min_qty", 0),
        }
        for i, r in enumerate(readers)
    ]}

@app.get("/status/{index}")
def status(index: int):
    if index >= len(readers):
        raise HTTPException(status_code=404, detail="Reader not found")
    r = readers[index]
    return {
        "index":       index,
        "connected":   r["connected"],
        "type":        r["cfg"]["type"],
        "ip":          r["cfg"]["ip"],
        "location":    r["cfg"].get("location"),
        "current_qty": r["current_qty"],
        "min_qty":     r["cfg"].get("min_qty", 0),
        "low_qty":     r["cfg"].get("min_qty", 0) > 0 and r["current_qty"] < r["cfg"].get("min_qty", 0),
    }

@app.get("/tags/{index}")
def get_tags(index: int):
    if index >= len(readers):
        raise HTTPException(status_code=404, detail="Reader not found")
    r = readers[index]
    return {"tags": r["last_tags"], "count": len(r["last_tags"])}

@app.get("/new-tag/{index}")
def get_new_tag(index: int):
    if index >= len(readers):
        raise HTTPException(status_code=404, detail="Reader not found")
    r = readers[index]
    tag          = r["new_tag"]
    r["new_tag"] = None
    return {"tag_id": tag}

@app.get("/new-tag-washing/{index}")
def get_new_tag_washing(index: int):
    if index >= len(readers):
        raise HTTPException(status_code=404, detail="Reader not found")
    r = readers[index]
    tag          = r["new_tag"]
    r["new_tag"] = None
    return {"tag_id": tag, "location": r["cfg"].get("location")}

@app.get("/test-alarm/{index}")
def test_alarm(index: int):
    if index >= len(readers):
        raise HTTPException(status_code=404, detail="Reader not found")
    threading.Thread(target=start_alarm, args=(readers[index],), daemon=True).start()
    return {"status": "alarm triggered"}

@app.post("/restart/{index}")
def restart_reader(index: int):
    if index >= len(readers):
        raise HTTPException(status_code=404, detail="Reader not found")
    def do_restart():
        time.sleep(1)
        os.execv(sys.executable, [
            sys.executable, '-m', 'uvicorn',
            'main_dll:app', '--port', '8000', '--log-level', 'warning'
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