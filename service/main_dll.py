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
    get_error_desc,
    buzzer_and_led,
    set_relay,
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
READER_TYPE            = CFG["type"]      # register / pallet / washing / on_machine / completed
READER_PALLET_LOCATION = CFG.get("location")
MIN_QTY                = CFG.get("min_qty", 0)

# Cooldown settings
COOLDOWN             = 3   # วิ — กัน scan tag ซ้ำ
PALLET_IN_COOLDOWN   = 30    # วิ — รอ tag ครบ lot ก่อน confirm pallet-in
PALLET_OUT_COOLDOWN  = 60    # วิ — tag หาย นานเกินนี้ถือว่าออก
MACHINE_OUT_COOLDOWN = 60    # วิ — tag หาย นานเกินนี้ถือว่าออก
ACCUMULATED_TTL      = 45    # วิ — เก็บ tag ล่าสุดไว้ใน memory นานเท่าไหร่ (สำหรับ on_machine)

# Process code ส่งไปให้ Node.js → Node.js lookup จาก tb_master_process
PROCESS_MAPPING = {
    'washing':    {'process_code': '1201'},
    'on_machine': {'process_code': '1520'},
    'completed':  {'process_code': '1520'},
}
READER_PROCESS_CODE = PROCESS_MAPPING.get(READER_TYPE, {}).get('process_code', '')

# NODE_URL = "http://10.128.17.252:1001/api/rfid"
NODE_URL = "http://localhost:1001/api/rfid"

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
tag_qty                  = {}   # {tag: qty}
tag_barcode              = {}   # {tag: barcode}
tag_part_no              = {}   # {tag: part_no}
tag_rp                   = {}   # {tag: rw_diameter}
tags_on_machine          = {}   # {tag: timestamp} — tag ที่อยู่หน้า reader
rejected_tags            = set()  # tag ที่ถูก reject (part ไม่ตรง)
tags_disappeared_machine = {}   # {tag: timestamp} — รอ cooldown ก่อน out
lot_checked              = set()  # barcode ที่ส่ง A6 checking ไปแล้วในรอบนี้

# pallet tracking
tags_on_pallet           = {}   # {tag: timestamp}
tags_disappeared_pallet  = {}   # {tag: timestamp}
lot_tray_count           = {}   # {barcode: tray_counter}
lot_tags                 = {}   # {barcode: set of tags}
lot_confirmed_time       = {}   # {barcode: timestamp} — รอ PALLET_IN_COOLDOWN
lot_confirmed            = set()  # barcode ที่ส่ง pallet-in แล้ว

scanning    = False
scan_thread = None

# lock กัน 2 thread ยิงคำสั่ง DLL ลง port_handle เดียวกันพร้อมกัน (ทำให้ reader หลุด Communication error)
reader_lock = threading.Lock()

# ===== ALARM =====
alarm_active = False

def alarm_loop():
    """เสียง beep วนซ้ำตราบที่ alarm_active = True"""
    while alarm_active:
        winsound.Beep(2000, 500)
        time.sleep(0.5)

def alarm_status_loop():
    """print สถานะ alarm เป็น 0/1 ต่อเนื่องตลอดเวลา (สำหรับ debug)"""
    while True:
        # print(f"[ALARM] {1 if alarm_active else 0}")
        time.sleep(5)

def start_alarm():
    """เปิด alarm — beep + relay on → PLC สั่งลำโพง"""
    global alarm_active
    if not alarm_active:
        alarm_active = True
        threading.Thread(target=alarm_loop, daemon=True).start()
        with reader_lock:
            set_relay(0x01, reader_state["port_handle"])
        print(f"[ALARM] ON")

def stop_alarm():
    """ปิด alarm — relay off (ยิง DLL เฉพาะตอน alarm เคย active จริง กัน set_relay รัวทุก loop จนชนกับ inventory_g2)"""
    global alarm_active
    if alarm_active:
        alarm_active = False
        with reader_lock:
            set_relay(0x00, reader_state["port_handle"])


# ===== SCAN LOOP — register / washing =====
def scan_loop():
    """Loop หลักสำหรับ reader type: register และ washing
    scan ทุก 1 วิ ส่ง event ไป Node.js ทันทีที่เห็น tag ใหม่
    """
    global scanning
    seen_tags = {}

    while scanning:
        try:
            with reader_lock:
                tags = inventory_g2(reader_state["port_handle"])
            now  = time.time()
            acc  = reader_state.get("accumulated_tags", {})
            for tag in tags:
                acc[tag] = now
            acc = {t: ts for t, ts in acc.items() if now - ts < ACCUMULATED_TTL}
            reader_state["accumulated_tags"] = acc
            reader_state["last_tags"]        = list(acc.keys())
            now = time.time()

            if READER_TYPE == "register":
                for tag in tags:
                    if now - seen_tags.get(tag, 0) >= COOLDOWN:
                        seen_tags[tag] = now
                        reader_state["new_tag"] = tag
                        print(f"[{time.strftime('%H:%M:%S')}] [REGISTER] {tag}")
                seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

            elif READER_TYPE == "washing":
                for tag in tags:
                    if now - seen_tags.get(tag, 0) >= COOLDOWN:
                        seen_tags[tag] = now
                        reader_state["new_tag"] = tag
                        print(f"[{time.strftime('%H:%M:%S')}] [WASHING] {tag}")
                        try:
                            res = httpx.post(f"{NODE_URL}/washing", json={
                                "tag_id":       tag,
                                "location":     READER_PALLET_LOCATION,
                                "process_code": READER_PROCESS_CODE,
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
        time.sleep(0.5)


# ===== SCAN LOOP — on_machine =====
def scan_loop_on_machine():
    """Loop สำหรับ reader type: on_machine
    - tag เข้า → validate part กับ machine API → update DB → ส่ง A5 (move in)
    - tag ครบ lot ครั้งแรก → ส่ง A6 checking
    - tag ออกเกิน cooldown → ส่ง A7 (move out) + reset A6 tracking
    - part ไม่ตรง → alarm
    """
    global tags_on_machine, rejected_tags, current_qty, tag_qty, lot_checked

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
                    print(f"[{time.strftime('%H:%M:%S')}] [MACHINE RETURNED] {tag}")
                    tags_disappeared_machine.pop(tag, None)
                    tags_on_machine[tag] = now

                # tag ใหม่เข้ามา
                # new_tags = current_tags - set(tags_on_machine.keys()) - rejected_tags
                # for tag in new_tags:
                #     print(f"[{time.strftime('%H:%M:%S')}] [ON MACHINE] {tag}")
                #     try:
                #         check_res  = httpx.get(f"{NODE_URL}/last-on-machine-event/{tag}", timeout=5)
                #         last_event = check_res.json().get("event_type", "")

                #         if last_event == "ON_MACHINE_IN":
                #             # restore memory ไม่ส่ง AS400 ซ้ำ
                #             tags_disappeared_machine.pop(tag, None)
                #             tags_on_machine[tag] = now
                #             try:
                #                 lot_res  = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                #                 lot_data = lot_res.json()
                #                 qty      = lot_data.get("data", {}).get("tray_qty", 0)
                #                 tag_qty[tag]     = int(qty or 0)
                #                 tag_barcode[tag] = lot_data.get("data", {}).get("barcode")
                #                 tag_part_no[tag] = lot_data.get("data", {}).get("part_no")
                #                 tag_rp[tag]      = lot_data.get("data", {}).get("rw_diameter")
                #                 current_qty     += int(qty or 0)
                #                 print(f"[on_machine] RESTORED {tag} qty={qty}")
                #             except:
                #                 pass
                #             continue
                accumulated_tags = set(reader_state.get("accumulated_tags", {}).keys())
                new_tags = accumulated_tags - set(tags_on_machine.keys()) - rejected_tags
                for tag in new_tags:
                    print(f"[{time.strftime('%H:%M:%S')}] [ON MACHINE] {tag}")
                    try:
                        #------------------------------------------------------
                        check_res  = httpx.get(f"{NODE_URL}/last-on-machine-event/{tag}", timeout=5)
                        last_event = check_res.json().get("event_type", "")
                        #------------------------------------------------------
                        if last_event == "ON_MACHINE_IN":
                            # restore memory ไม่ส่ง AS400 ซ้ำ
                            tags_disappeared_machine.pop(tag, None)
                            tags_on_machine[tag] = now
                            try:
                                lot_res  = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                                lot_data = lot_res.json()
                                qty      = lot_data.get("data", {}).get("tray_qty", 0)
                                tag_qty[tag]     = int(qty or 0)
                                tag_barcode[tag] = lot_data.get("data", {}).get("barcode")
                                tag_part_no[tag] = lot_data.get("data", {}).get("part_no")
                                tag_rp[tag]      = lot_data.get("data", {}).get("rw_diameter")
                                current_qty     += int(qty or 0)
                                print(f"[on_machine] RESTORED {tag} qty={qty}")
                            except:
                                pass
                            continue
                        #------------------------------------------------------
                        res = httpx.post(f"{NODE_URL}/on-machine", json={
                            "tag_id":       tag,
                            "location":     READER_PALLET_LOCATION,
                            "process_code": READER_PROCESS_CODE,
                        }, timeout=5)

                        result = res.json().get("result")
                        if result == "PART_MISMATCH":
                            print(f"[on_machine] MISMATCH: {tag}")
                            try:
                                lot_res          = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                                lot_data         = lot_res.json()
                                mismatch_barcode = lot_data.get("data", {}).get("barcode", "")
                                mismatch_part    = lot_data.get("data", {}).get("part_no", "")
                            except:
                                mismatch_barcode = ""
                                mismatch_part    = ""
                            rejected_tags.add(tag)
                            reader_state["alarm"]         = True
                            reader_state["alarm_tag"]     = tag
                            reader_state["alarm_barcode"] = mismatch_barcode
                            reader_state["alarm_part"]    = mismatch_part
                            start_alarm()
                        elif result in ("LOT_NOT_READY", "NOT_WASHED", "NOT_FOUND"):
                            print(f"[on_machine] WARNING {result}: {tag}")
                            try:
                                lot_res          = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                                lot_data         = lot_res.json()
                                mismatch_barcode = lot_data.get("data", {}).get("barcode", "")
                                mismatch_part    = lot_data.get("data", {}).get("part_no", "")
                            except:
                                mismatch_barcode = ""
                                mismatch_part    = ""
                            rejected_tags.add(tag)
                            reader_state["alarm"]         = True
                            reader_state["alarm_tag"]     = tag
                            reader_state["alarm_barcode"] = mismatch_barcode
                            reader_state["alarm_part"]    = mismatch_part
                            start_alarm()
                        else:
                            reader_state["alarm"] = False
                            stop_alarm()
                            tags_on_machine[tag] = now
                            raw_qty  = 0
                            lot_data = {}
                            try:
                                lot_res  = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                                lot_data = lot_res.json()
                                raw_qty  = lot_data.get("data", {}).get("tray_qty", 0)
                                
                            except:
                                pass

                            tray_qty_val     = raw_qty[0] if isinstance(raw_qty, list) else int(raw_qty or 0)
                            tag_qty[tag]     = tray_qty_val
                            tag_barcode[tag] = lot_data.get("data", {}).get("barcode") if lot_data else None
                            tag_part_no[tag] = lot_data.get("data", {}).get("part_no") if lot_data else None
                            tag_rp[tag]      = lot_data.get("data", {}).get("rw_diameter") if lot_data else None
                            current_qty     += tray_qty_val
                            print(f"[on_machine] OK {tag} qty+={tray_qty_val} total={current_qty}")

                            # เช็คว่า tag ครบ lot ไหม → ส่ง A6 checking ครั้งเดียว
                            barcode      = tag_barcode.get(tag)
                            tray_counter = lot_data.get("data", {}).get("tray_counter", 0) if lot_data else 0
                            if barcode and tray_counter > 0:
                                tags_of_lot = {t for t, b in tag_barcode.items() if b == barcode and t in tags_on_machine}
                                if len(tags_of_lot) >= tray_counter and barcode not in lot_checked:
                                    lot_checked.add(barcode)
                                    print(f"[{time.strftime('%H:%M:%S')}] [A6 CHECKING] lot={barcode} → sending")
                                    try:
                                        httpx.post(f"{NODE_URL}/on-machine-checking", json={
                                            "barcode":  barcode,
                                            "location": READER_PALLET_LOCATION,
                                            "part_no":  tag_part_no.get(tag),
                                        }, timeout=5)
                                    except Exception as ex:
                                        print(f"[checking] error: {ex}")

                    except Exception as ex:
                        print(f"[on_machine] error: {ex}")

                # rejected tag ออก → stop alarm ถ้าไม่มีเหลือ
                removed_rejected = rejected_tags - current_tags
                if removed_rejected:
                    rejected_tags -= removed_rejected
                    if not rejected_tags:
                        reader_state["alarm"]         = False
                        reader_state["alarm_tag"]     = ""
                        reader_state["alarm_barcode"] = ""
                        reader_state["alarm_part"]    = ""
                        stop_alarm()

                # tag หายออก → เริ่มนับ cooldown
                left_tags = set(tags_on_machine.keys()) - set(reader_state.get("accumulated_tags", {}).keys())
                for tag in left_tags:
                    if tag not in tags_disappeared_machine:
                        print(f"[{time.strftime('%H:%M:%S')}] [MACHINE MISSING] {tag} waiting {MACHINE_OUT_COOLDOWN}s")
                        tags_disappeared_machine[tag] = now
                    tags_on_machine.pop(tag, None)

                # tag หายเกิน cooldown → ส่ง A7 out
                for tag, t in list(tags_disappeared_machine.items()):
                    if now - t >= MACHINE_OUT_COOLDOWN:
                        qty_removed = tag_qty.pop(tag, 0)
                        barcode     = tag_barcode.get(tag)
                        tag_part_no.pop(tag, None)
                        tag_rp.pop(tag, None)
                        current_qty = max(current_qty - qty_removed, 0)
                        tags_disappeared_machine.pop(tag, None)
                        print(f"[{time.strftime('%H:%M:%S')}] [MACHINE OUT] {tag} qty-={qty_removed} total={current_qty}")

                        # ถ้า tag ทั้งหมดของ lot ออกไปหมด → reset A6 tracking
                        if barcode:
                            tags_of_lot = {t for t, b in tag_barcode.items() if b == barcode and t in tags_on_machine}
                            if len(tags_of_lot) == 0:
                                lot_checked.discard(barcode)
                                print(f"[on_machine] A6 reset for lot={barcode}")

                        try:
                            httpx.post(f"{NODE_URL}/on-machine-out", json={
                                "tag_id":   tag,
                                "barcode":  tag_barcode.pop(tag, None),
                                "qty":      qty_removed,
                                "location": READER_PALLET_LOCATION,
                            }, timeout=5)
                        except Exception as ex:
                            print(f"[on-machine-out] error: {ex}")

                if not (current_tags - set(tags_on_machine.keys())):
                    stop_alarm()

            except Exception as ex:
                print(f"[scan_loop_on_machine] error: {ex}")

        time.sleep(0.5)


# ===== SCAN LOOP — completed =====
def scan_loop_completed():
    """Loop สำหรับ reader type: completed
    scan tag → ส่ง completed event ทีละ tray
    """
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
                            time.sleep(1)
                        elif result not in ("OK",):
                            print(f"[completed] WARNING {result}: {tag}")
                    except Exception as ex:
                        print(f"[completed] error: {ex}")

            seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

        except Exception as ex:
            print(f"[scan_loop_completed] error: {ex}")

        time.sleep(0.5)


# ===== SCAN LOOP — pallet =====
def scan_loop_pallet():
    """Loop สำหรับ reader type: pallet
    - tag เข้า → track จำนวนต่อ lot
    - tag ครบ lot และอยู่นาน PALLET_IN_COOLDOWN วิ → ส่ง pallet-in ทุก tag
    - tag หายเกิน PALLET_OUT_COOLDOWN วิ และออกหมด lot → ส่ง pallet-lot-out
    """
    global tags_on_pallet, lot_tray_count, lot_tags, tags_disappeared_pallet
    global lot_confirmed_time, lot_confirmed

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

                print(f"[{time.strftime('%H:%M:%S')}] [PALLET SCAN] {tag} -> {READER_PALLET_LOCATION}")
                tags_on_pallet[tag] = now

                try:
                    lot_res      = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                    lot_data     = lot_res.json().get("data", {})
                    barcode      = lot_data.get("barcode")
                    tray_counter = lot_data.get("tray_counter", 0)
                    if barcode:
                        lot_tray_count[barcode] = tray_counter
                        lot_tags.setdefault(barcode, set()).add(tag)
                        print(f"[pallet] lot={barcode} ({len(lot_tags[barcode])}/{tray_counter})")
                except Exception as ex:
                    print(f"[pallet] lot-by-tag error: {ex}")

            # เช็ค lot ครบ → เริ่มนับ PALLET_IN_COOLDOWN
            for barcode, tags in lot_tags.items():
                if barcode in lot_confirmed:
                    continue
                tags_present = tags & (current_tags | set(tags_disappeared_pallet.keys()))
                tray_counter = lot_tray_count.get(barcode, 0)
                if len(tags_present) >= tray_counter and tray_counter > 0:
                    if barcode not in lot_confirmed_time:
                        print(f"[{time.strftime('%H:%M:%S')}] [PALLET FULL] lot={barcode} waiting {PALLET_IN_COOLDOWN}s")
                        lot_confirmed_time[barcode] = now
                else:
                    if barcode in lot_confirmed_time:
                        print(f"[{time.strftime('%H:%M:%S')}] [PALLET RESET] lot={barcode} tag missing")
                        lot_confirmed_time.pop(barcode, None)

            # lot รอครบ timeout → ส่ง pallet-in
            for barcode, t in list(lot_confirmed_time.items()):
                if now - t >= PALLET_IN_COOLDOWN:
                    lot_confirmed_time.pop(barcode, None)
                    lot_confirmed.add(barcode)
                    print(f"[{time.strftime('%H:%M:%S')}] [PALLET CONFIRMED] lot={barcode}")
                    for tag in lot_tags.get(barcode, set()):
                        try:
                            res    = httpx.post(f"{NODE_URL}/pallet",
                                json={"tag_id": tag, "location": READER_PALLET_LOCATION}, timeout=5)
                            result = res.json().get("result")
                            print(f"[pallet] tag={tag} result={result}")
                        except Exception as ex:
                            print(f"[pallet] error: {ex}")

            # tag หายออก → เริ่มนับ cooldown
            left_tags = set(tags_on_pallet.keys()) - current_tags
            for tag in left_tags:
                if tag not in tags_disappeared_pallet:
                    print(f"[{time.strftime('%H:%M:%S')}] [PALLET MISSING] {tag} waiting {PALLET_OUT_COOLDOWN}s")
                    tags_disappeared_pallet[tag] = now
                tags_on_pallet.pop(tag, None)

            # tag หายเกิน cooldown + ออกหมด lot → ส่ง pallet-lot-out
            for tag, t in list(tags_disappeared_pallet.items()):
                if now - t >= PALLET_OUT_COOLDOWN:
                    print(f"[{time.strftime('%H:%M:%S')}] [PALLET OUT] {tag}")
                    tags_disappeared_pallet.pop(tag, None)
                    barcode = next((b for b, tags in lot_tags.items() if tag in tags), None)
                    if barcode:
                        remaining = lot_tags[barcode] & set(tags_on_pallet.keys())
                        print(f"[pallet] lot={barcode} remaining={len(remaining)}/{lot_tray_count.get(barcode, 0)}")
                        if len(remaining) == 0 and barcode in lot_confirmed:
                            print(f"[{time.strftime('%H:%M:%S')}] [PALLET LOT OUT] lot={barcode}")
                            try:
                                httpx.post(f"{NODE_URL}/pallet-lot-out", json={
                                    "barcode": barcode, "location": READER_PALLET_LOCATION
                                }, timeout=5)
                            except Exception as ex:
                                print(f"[pallet-lot-out] error: {ex}")
                            lot_tags.pop(barcode, None)
                            lot_tray_count.pop(barcode, None)
                            lot_confirmed.discard(barcode)

            # reader disconnect → clear state
            if not reader_state["connected"]:
                tags_on_pallet.clear()
                lot_tags.clear()
                lot_tray_count.clear()
                tags_disappeared_pallet.clear()
                lot_confirmed_time.clear()
                lot_confirmed.clear()

            tags_on_pallet = {k: v for k, v in tags_on_pallet.items() if k in current_tags}

        except Exception as ex:
            print(f"[scan_loop_pallet] error: {ex}")

        time.sleep(0.5)


# ===== CONNECT & RECONNECT =====
def connect_reader():
    """เชื่อมต่อ reader ผ่าน TCP และเริ่ม scan_loop"""
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
        with reader_lock:
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
    """วน reconnect ถ้า reader หลุด exit หลัง fail 3 ครั้ง → start_rfid.py จะ restart"""
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
    threading.Thread(target=alarm_status_loop, daemon=True).start()
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
    unique_parts = list(set(v for v in tag_part_no.values() if v))
    unique_rps   = list(set(v for v in tag_rp.values() if v))
    return {
        "connected":   reader_state["connected"],
        "ip":          reader_state["ip"],
        "type":        READER_TYPE,
        "location":    READER_PALLET_LOCATION,
        "current_qty": current_qty,
        "min_qty":     MIN_QTY,
        "low_qty":     MIN_QTY > 0 and current_qty < MIN_QTY,
        "parts":       unique_parts,
        "rps":         unique_rps,
        "alarm":       reader_state.get("alarm", False),
        "alarm_tag":     reader_state.get("alarm_tag", ""),
        "alarm_barcode": reader_state.get("alarm_barcode", ""),
        "alarm_part":    reader_state.get("alarm_part", ""),
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


@app.get("/restart")
def restart_reader():
    """Restart uvicorn process ของ reader ตัวนี้"""
    def do_restart():
        time.sleep(1)
        # os.execv(sys.executable, [
        #     sys.executable, '-m', 'uvicorn',
        #     'main_dll:app', '--port', str(CFG['port']), '--log-level', 'warning'
        # ])
        os._exit(0)
    threading.Thread(target=do_restart, daemon=True).start()
    return {"result": "OK"}

@app.get("/alarm")
def get_alarm():
    return {
        "alarm":   reader_state.get("alarm", False),
        "location": READER_PALLET_LOCATION,
        "tag":     reader_state.get("alarm_tag", ""),
        "barcode": reader_state.get("alarm_barcode", ""),
        "part":    reader_state.get("alarm_part", ""),
    }

@app.get("/test-relay-on")
def test_relay_on():
    with reader_lock:
        result = set_relay(0x01, reader_state["port_handle"])
    return {"status": 1, "result": result}

@app.get("/test-relay-off")
def test_relay_off():
    with reader_lock:
        result = set_relay(0x00, reader_state["port_handle"])
    return {"status": 0, "result": result}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=CFG['port'], log_level="warning")