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
PALLET_IN_COOLDOWN   = 5    # วิ — รอ tag ครบ lot ก่อน confirm pallet-in
PALLET_OUT_COOLDOWN  = 30    # วิ — tag หาย นานเกินนี้ถือว่าออก
MACHINE_OUT_COOLDOWN = 30    # วิ — tag หาย นานเกินนี้ถือว่าออก
ACCUMULATED_TTL      = 30    # วิ — เก็บ tag ล่าสุดไว้ใน memory นานเท่าไหร่ (สำหรับ on_machine)
ON_MACHINE_RETRY_DELAY = 10  # วิ — Node ตอบ error / ต่อไม่ได้ → รอเท่านี้ก่อนลอง tag เดิมใหม่
SEND_RETRY_DELAY       = 10  # วิ — A7 / A6 / A2 ส่งไม่สำเร็จ → เข้าคิว ลองใหม่ทุกเท่านี้
PALLET_LOOKUP_RETRY    = 10  # วิ — pallet: /lot-by-tag พลาด → ลอง tag เดิมใหม่หลังเท่านี้

# Process code ส่งไปให้ Node.js → Node.js lookup จาก tb_master_process
PROCESS_MAPPING = {
    'washing':    {'process_code': '1201'},
    'on_machine': {'process_code': '1520'},
    'completed':  {'process_code': '1520'},
}
READER_PROCESS_CODE = PROCESS_MAPPING.get(READER_TYPE, {}).get('process_code', '')

# NODE_URL = "http://localhost:2002/api/rfid"
NODE_URL = "http://10.128.17.252:2002/api/rfid"
# NODE_URL   = "http://10.120.139.20:2002/api/rfid"

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
on_machine_retry_after   = {}   # {tag: timestamp} — Node ตอบ error → ห้ามลองใหม่ก่อนเวลานี้

# pallet tracking
tags_on_pallet           = {}   # {tag: timestamp}
tags_disappeared_pallet  = {}   # {tag: timestamp}
lot_tray_count           = {}   # {barcode: tray_counter}
lot_tags                 = {}   # {barcode: set of tags}
lot_confirmed_time       = {}   # {barcode: timestamp} — รอ PALLET_IN_COOLDOWN
lot_confirmed            = set()  # barcode ที่ส่ง pallet-in แล้ว
pallet_lookup_retry_after = {}  # {tag: timestamp} — /lot-by-tag พลาด → ห้ามลองใหม่ก่อนเวลานี้

# คิวส่งซ้ำ A7 / A6 / A2 — {key: {"path", "payload", "at", "retry_unknown", "tries"}}
# อยู่ใน memory (Python restart = คิวหาย) · key เช่น ("A7", tag), ("A6", barcode), ("A2", barcode)
send_retry               = {}

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


# ===== SEND + RETRY QUEUE (A7 / A6 / A2) =====
def post_node(path, payload):
    """ยิง Node แล้วคืน (status, detail)
    'OK'       — Node ตอบ 2xx
    'NOT_SENT' — มั่นใจว่า Node ไม่ได้ทำ: ต่อไม่ติด / Node ตอบ error (Node ยิง AS400 หลังงานของตัวเองสำเร็จเท่านั้น)
    'UNKNOWN'  — ส่งไปแล้วแต่รอคำตอบไม่ทัน (timeout) → Node อาจทำไปแล้ว
    """
    try:
        res = httpx.post(f"{NODE_URL}{path}", json=payload, timeout=5)
    except (httpx.ConnectError, httpx.ConnectTimeout) as ex:
        return "NOT_SENT", f"connect: {ex}"
    except Exception as ex:
        return "UNKNOWN", f"{type(ex).__name__}: {ex}"
    if 200 <= res.status_code < 300:
        return "OK", ""
    return "NOT_SENT", f"HTTP {res.status_code}"


def send_or_queue(key, path, payload, retry_unknown, tags=()):
    """ส่งทันที · ไม่สำเร็จ → เข้าคิว send_retry
    retry_unknown=True เฉพาะ endpoint ที่ปลายทางกันซ้ำเองได้ (A2: as400.js เช็ค ALREADY_OUT)
    tags = tag ของถาดที่เป็นเจ้าของ event (ใช้ยกเลิก OUT ที่ค้างคิว เมื่อถาดกลับมาหน้า reader)
    """
    status, detail = post_node(path, payload)
    if status == "OK":
        return
    if status == "UNKNOWN" and not retry_unknown:
        print(f"[{time.strftime('%H:%M:%S')}] [SEND UNCERTAIN] {key} {detail} → ไม่ส่งซ้ำ (กัน AS400 นับซ้ำ)")
        return
    send_retry[key] = {"path": path, "payload": payload, "at": time.time() + SEND_RETRY_DELAY,
                       "retry_unknown": retry_unknown, "tries": 1, "tags": set(tags)}
    print(f"[{time.strftime('%H:%M:%S')}] [SEND QUEUED] {key} {detail} → retry in {SEND_RETRY_DELAY}s")


def cancel_out_if_back(kind, present_tags):
    """OUT (A7 / A2) ที่ค้างคิว แต่ถาดกลับมาอยู่หน้า reader แล้ว → ยกเลิก
    ต้องเรียกก่อน flush_send_retry — ไม่งั้นรอบที่ถาดกลับมาพอดี flush จะส่ง OUT ออกไปก่อนรู้ว่าถาดกลับมา
    (OUT ไม่เคยถึง AS400 → AS400 ยังเห็น IN อยู่ = ตรงกับความจริง)
    """
    for key, item in list(send_retry.items()):
        if key[0] == kind and item.get("tags") and (item["tags"] & present_tags):
            send_retry.pop(key, None)
            print(f"[{time.strftime('%H:%M:%S')}] [SEND CANCELLED] {key} — ถาดกลับมาหน้า reader")


def flush_send_retry():
    """ลองส่งรายการในคิวที่ถึงเวลาแล้ว — เรียกจาก loop ของ on_machine / pallet ทุกรอบ"""
    now = time.time()
    for key, item in list(send_retry.items()):
        if now < item["at"]:
            continue
        status, detail = post_node(item["path"], item["payload"])
        item["tries"] += 1
        if status == "OK":
            send_retry.pop(key, None)
            print(f"[{time.strftime('%H:%M:%S')}] [SEND RETRY OK] {key} (ครั้งที่ {item['tries']})")
        elif status == "UNKNOWN" and not item["retry_unknown"]:
            send_retry.pop(key, None)
            print(f"[{time.strftime('%H:%M:%S')}] [SEND UNCERTAIN] {key} {detail} → หยุดส่งซ้ำ (กัน AS400 นับซ้ำ)")
        else:
            item["at"] = time.time() + SEND_RETRY_DELAY
            print(f"[{time.strftime('%H:%M:%S')}] [SEND RETRY] {key} ครั้งที่ {item['tries']} ไม่สำเร็จ ({detail}) → retry in {SEND_RETRY_DELAY}s")


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
        # ส่ง A7 / A6 ที่ค้างในคิว — ทำแม้ reader หลุด เพราะเป็นการคุยกับ Node ไม่ใช่ reader
        try:
            cancel_out_if_back("A7", set(reader_state.get("accumulated_tags", {}).keys()))
            flush_send_retry()
        except Exception as ex:
            print(f"[send_retry] error: {ex}")

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
                # tag ที่เพิ่งพลาด ยังไม่ถึงเวลาลองใหม่ → ข้ามไปก่อน
                for t in [t for t, ts in on_machine_retry_after.items() if now >= ts]:
                    on_machine_retry_after.pop(t, None)
                new_tags = new_tags - set(on_machine_retry_after.keys())
                for tag in new_tags:
                    print(f"[{time.strftime('%H:%M:%S')}] [ON MACHINE] {tag}")
                    # ถาดกลับมาขึ้นเครื่อง ขณะ A7 รอบก่อนยังค้างในคิว → ยกเลิก A7
                    # (A7 ไม่เคยถึง AS400 → AS400 ยังเห็น IN อยู่ = ตรงกับความจริง · last-event จะพาเข้า RESTORE ไม่ส่ง A5 ซ้ำ)
                    if send_retry.pop(("A7", tag), None):
                        print(f"[on_machine] A7 ที่ค้างในคิวถูกยกเลิก — {tag} กลับขึ้นเครื่อง")
                    try:
                        #------------------------------------------------------
                        check_res  = httpx.get(f"{NODE_URL}/last-on-machine-event/{tag}", timeout=5)
                        # เดิม: 500 → json ได้ {"error":...} → event_type = "" → ถือว่า tag ใหม่ → ส่ง A5 ซ้ำได้
                        #       ทั้งที่ tag อาจขึ้นเครื่องไปแล้ว (เช่น Python เพิ่ง restart)
                        if check_res.status_code != 200:
                            print(f"[on_machine] last-event HTTP {check_res.status_code}: {tag} → retry in {ON_MACHINE_RETRY_DELAY}s")
                            # นับจากเวลาที่พลาดจริง ไม่ใช่ now (ต้นรอบ loop) — รอบที่มีหลาย tag / request ค้าง timeout จะทำให้เว้นสั้นเกิน
                            on_machine_retry_after[tag] = time.time() + ON_MACHINE_RETRY_DELAY
                            continue
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
                        # else:
                        # เดิม: ทุกอย่างที่ไม่ใช่ข้างบน = สำเร็จ รวมถึง 500 (result=None) และข้อความ error จาก SP
                        #       → นับ qty แล้ว แต่ DB ไม่ได้ update + ไม่ได้ส่ง A5 → ถาดไป completed ไม่ได้ (งานค้าง)
                        elif result in ("OK", "LOT_ON_MACHINE"):
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
                                    # try:
                                    #     httpx.post(f"{NODE_URL}/on-machine-checking", json={
                                    #         "barcode":  barcode,
                                    #         "location": READER_PALLET_LOCATION,
                                    #         "part_no":  tag_part_no.get(tag),
                                    #     }, timeout=5)
                                    # except Exception as ex:
                                    #     print(f"[checking] error: {ex}")
                                    # เดิม: lot_checked.add ก่อนส่ง + พลาดแล้วแค่ print → A6 ไม่ถูกส่งอีกเลย
                                    # ตอนนี้: พลาดแบบมั่นใจว่าไม่ถึง → เข้าคิวส่งซ้ำ · timeout (ไม่แน่ใจ) → ไม่ส่งซ้ำ กัน A6 ขึ้น 2 แถว
                                    send_or_queue(("A6", barcode), "/on-machine-checking", {
                                        "barcode":  barcode,
                                        "location": READER_PALLET_LOCATION,
                                        "part_no":  tag_part_no.get(tag),
                                    }, retry_unknown=False)

                        else:
                            # Node ตอบ error (500 / SP rollback / ข้อความที่ไม่รู้จัก) → DB ไม่ได้ update และ Node ไม่ได้ส่ง A5
                            # → ยังไม่นับว่าขึ้นเครื่อง ลองใหม่ภายหลัง (ส่งซ้ำได้ปลอดภัย เพราะ A5 ยังไม่ออก)
                            print(f"[on_machine] NOT CONFIRMED (HTTP {res.status_code}) result={result}: {tag} → retry in {ON_MACHINE_RETRY_DELAY}s")
                            on_machine_retry_after[tag] = time.time() + ON_MACHINE_RETRY_DELAY

                    except Exception as ex:
                        print(f"[on_machine] error: {ex}")
                        # ต่อ Node ไม่ได้ / timeout → เดิมลองใหม่ทุก 0.5 วิ · ตอนนี้เว้น ON_MACHINE_RETRY_DELAY
                        # (timeout = ไม่รู้ว่า Node ทำไปแล้วหรือยัง · รอให้ผล A5 ลง log ก่อน รอบหน้าจะเข้า RESTORE แทนส่งซ้ำ)
                        on_machine_retry_after[tag] = time.time() + ON_MACHINE_RETRY_DELAY

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
                                send_retry.pop(("A6", barcode), None)   # lot ออกหมดแล้ว A6 ที่ค้างไม่มีความหมาย
                                print(f"[on_machine] A6 reset for lot={barcode}")

                        # try:
                        #     httpx.post(f"{NODE_URL}/on-machine-out", json={
                        #         "tag_id":   tag,
                        #         "barcode":  tag_barcode.pop(tag, None),
                        #         "qty":      qty_removed,
                        #         "location": READER_PALLET_LOCATION,
                        #     }, timeout=5)
                        # except Exception as ex:
                        #     print(f"[on-machine-out] error: {ex}")
                        # เดิม: state ถูก pop ไปแล้วก่อนส่ง + พลาดแล้วแค่ print → A7 หายถาวร AS400 ไม่ได้ MOVE_OUT
                        # ตอนนี้: state ยัง clear เหมือนเดิม (ถาดออกไปแล้วจริง) แต่ A7 ที่ส่งไม่ถึงเข้าคิวส่งซ้ำ
                        send_or_queue(("A7", tag), "/on-machine-out", {
                            "tag_id":   tag,
                            "barcode":  tag_barcode.pop(tag, None),
                            "qty":      qty_removed,
                            "location": READER_PALLET_LOCATION,
                        }, retry_unknown=False, tags=(tag,))

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
        # ส่ง A2 ที่ค้างในคิว — ทำแม้ reader หลุด เพราะเป็นการคุยกับ Node ไม่ใช่ reader
        try:
            cancel_out_if_back("A2", set(reader_state.get("last_tags", [])))
            flush_send_retry()
        except Exception as ex:
            print(f"[send_retry] error: {ex}")

        if not reader_state["connected"]:
            time.sleep(1)
            continue

        try:
            current_tags = set(reader_state["last_tags"])
            now          = time.time()

            # tag ใหม่เข้ามา
            new_tags = current_tags - set(tags_on_pallet.keys())
            # tag ที่ /lot-by-tag เพิ่งพลาด ยังไม่ถึงเวลาลองใหม่ → ข้ามไปก่อน
            for t in [t for t, ts in pallet_lookup_retry_after.items() if now >= ts]:
                pallet_lookup_retry_after.pop(t, None)
            new_tags = new_tags - set(pallet_lookup_retry_after.keys())
            for tag in new_tags:
                if tag in tags_disappeared_pallet:
                    print(f"[{time.strftime('%H:%M:%S')}] [PALLET RETURNED] {tag}")
                    tags_disappeared_pallet.pop(tag, None)

                print(f"[{time.strftime('%H:%M:%S')}] [PALLET SCAN] {tag} -> {READER_PALLET_LOCATION}")
                tags_on_pallet[tag] = now

                # เดิม: tag ถูกใส่ tags_on_pallet ไปแล้วก่อน lookup → lookup พลาดครั้งเดียว tag ไม่ถูกมองว่าใหม่อีก
                #       → tag หลุดจาก lot ถาวร → lot ไม่ครบ → A1 ไม่ถูกส่งเลย
                # ตอนนี้: lookup พลาด (ต่อไม่ได้ / Node error) → เอา tag ออกจาก tags_on_pallet ให้รอบหลังลองใหม่
                #       (tag ที่ไม่มีใน DB → Node ตอบ 200 found:false → ไม่ถือว่าพลาด เหมือนเดิม)
                try:
                    lot_res      = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                    if lot_res.status_code != 200:
                        raise RuntimeError(f"HTTP {lot_res.status_code}")
                    lot_data     = lot_res.json().get("data", {})
                    barcode      = lot_data.get("barcode")
                    tray_counter = lot_data.get("tray_counter", 0)
                    if barcode:
                        # lot กลับมาที่ pallet นี้ ขณะ A2 รอบก่อนยังค้างในคิว → ยกเลิก A2 (AS400 ยังเห็น IN = ถูกต้อง)
                        if send_retry.pop(("A2", barcode), None):
                            print(f"[pallet] A2 ที่ค้างในคิวถูกยกเลิก — lot={barcode} กลับมาที่ pallet")
                        lot_tray_count[barcode] = tray_counter
                        lot_tags.setdefault(barcode, set()).add(tag)
                        print(f"[pallet] lot={barcode} ({len(lot_tags[barcode])}/{tray_counter})")
                except Exception as ex:
                    print(f"[pallet] lot-by-tag error: {ex} → retry {tag} in {PALLET_LOOKUP_RETRY}s")
                    tags_on_pallet.pop(tag, None)
                    pallet_lookup_retry_after[tag] = time.time() + PALLET_LOOKUP_RETRY

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
                    # SP lot_update_location: tag แรกที่สำเร็จ update ทั้ง lot + Node ส่ง A1 · tag ที่เหลือได้ DUPLICATE_LOCATION
                    # → ขอแค่ "มีอย่างน้อย 1 tag ที่ SP ตอบผลชัดเจน" ก็ถือว่า lot นี้จบ
                    lot_answered = False
                    for tag in lot_tags.get(barcode, set()):
                        try:
                            res    = httpx.post(f"{NODE_URL}/pallet",
                                json={"tag_id": tag, "location": READER_PALLET_LOCATION}, timeout=5)
                            result = res.json().get("result")
                            print(f"[pallet] tag={tag} result={result}")
                            # ผลที่ SP ตอบชัดเจน (รวม TRAY_NOT_COMPLETE — เดิมก็ไม่ลองใหม่) · นอกนั้น = error → ลองใหม่
                            if res.status_code == 200 and result in ("OK", "DUPLICATE_LOCATION", "NOT_READY", "TRAY_NOT_COMPLETE"):
                                lot_answered = True
                        except Exception as ex:
                            print(f"[pallet] error: {ex}")
                    # เดิม: lot_confirmed.add ไปแล้วด้านบน → ทุก tag พลาด (Node ล่ม / SP error) = A1 ไม่ถูกส่งอีกเลย
                    # ตอนนี้: ไม่มี tag ไหนได้ผลชัดเจน → ปลด lot_confirmed → รอบหน้า lot ยังครบ → นับ PALLET_IN_COOLDOWN แล้วส่งใหม่
                    # ส่งซ้ำปลอดภัย: ถ้า SP เคยทำไปแล้ว จะได้ DUPLICATE_LOCATION → Node ไม่ส่ง A1 ซ้ำ
                    if not lot_answered:
                        lot_confirmed.discard(barcode)
                        print(f"[{time.strftime('%H:%M:%S')}] [PALLET NOT CONFIRMED] lot={barcode} → retry after {PALLET_IN_COOLDOWN}s")

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
                            # try:
                            #     httpx.post(f"{NODE_URL}/pallet-lot-out", json={
                            #         "barcode": barcode, "location": READER_PALLET_LOCATION
                            #     }, timeout=5)
                            # except Exception as ex:
                            #     print(f"[pallet-lot-out] error: {ex}")
                            # เดิม: พลาดแล้วแค่ print + lot_tags ถูก pop ด้านล่าง → A2 หายถาวร
                            # ตอนนี้: ส่งไม่ถึง → เข้าคิวส่งซ้ำ · retry_unknown=True เพราะ as400.js /pallet-out
                            #        เช็ค last event = PALLET_OUT แล้วตอบ ALREADY_OUT → ส่งซ้ำไม่ทำให้ AS400 นับซ้ำ
                            send_or_queue(("A2", barcode), "/pallet-lot-out", {
                                "barcode": barcode, "location": READER_PALLET_LOCATION
                            }, retry_unknown=True, tags=tuple(lot_tags.get(barcode, ())))
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