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

# โหลด Config ของ reader นี้จาก readers_config.json
with open("readers_config.json") as f:
    ALL_READERS = json.load(f)
READER_INDEX = int(os.environ.get("READER_INDEX", "0"))

if READER_INDEX >= len(ALL_READERS):
    print(f"[ERROR] READER_INDEX={READER_INDEX} out of range (max={len(ALL_READERS)-1})")
    exit(1)
    
CFG = ALL_READERS[READER_INDEX]

# ค่า config ของ reader ตัวนี้
READER_IP              = CFG["ip"]             # IP ของ reader
READER_PORT_TCP        = 6000                  # TCP port reader
READER_POWER           = CFG["power"]          # ระยะติ๊ก tag สูงสุด power 30
READER_TYPE            = CFG["type"]           # register / pallet / washing / on_machine / completed
READER_PALLET_LOCATION = CFG.get("location")   # location
MACHINE_NO             = CFG.get("machine_no") # ชื่อเครื่องจักร ไม่รู้จำเป็นไหม
MACHINE_PART_NO        = CFG.get("machine_parts", []) # part_no on_machine (ใช้กับ on_machine)
MIN_QTY                = CFG.get("min_qty", 0) # จำนวนขั้นต่ำ ถ้าต่ำกว่านี้จะแจ้งเตือน MBR Monitor

COOLDOWN = 10   # วินาที ป้องกันการสแกน tag เดิมซ้ำๆ
PALLET_OUT_COOLDOWN = 10 # วินาที เมื่อ Reader ไม่อ่าน tag ตรง pallet location หลังจาก tag ออกเกินเวลาที่กำหนดจะถือว่า out pallet แล้ว

PROCESS_MAPPING = {
    'washing':    {'process_code': '1201', 'process': 'WATER WASHING 1'},
    'on_machine': {'process_code': '1520', 'process': 'AUTO MATCHING'},
    'completed':  {'process_code': '1520', 'process': 'AUTO MATCHING'},
}

READER_PROCESS_CODE = PROCESS_MAPPING.get(READER_TYPE, {}).get('process_code', '')
READER_PROCESS      = PROCESS_MAPPING.get(READER_TYPE, {}).get('process', '')

NODE_URL = "http://localhost:5000/api/rfid"  # URL ของ Node.js backend

# State
reader_state = {
    "connected":         False,  # เชื่อมต่อ reader อยู่ไหม
    "ip":                READER_IP,
    "port_handle":       -1,     # handle ที่ได้จาก DLL ตอน connect (-1 = ยังไม่ connect)
    "last_tags":         [],     # list ของ tag EPC ที่อยู่หน้า reader ตอนนี้
    "new_tag":           None,   # tag ล่าสุดที่ผ่าน reader (ใช้กับ register/washing)
    "on_machine_active": True,   # เปิด/ปิด logic on_machine ดูไม่ค่อยจำเป็น แต่เก็บไว้ก่อน
}

# ตัวแปร tracking สำหรับ on_machine reader
current_qty     = 0    # จำนวน pcs รวมของทุก tray ที่อยู่หน้า reader
tag_qty         = {}   # เก็บ qty ของแต่ละ tag ที่ on_machine
tags_on_machine = {}   # เก็บ tag ที่อยู่หน้า reader
rejected_tags   = set() # tag ที่ถูก reject part_no ไม่ตรง

# ตัวแปร tracking สำหรับ pallet reader
tags_on_pallet  = {}   # เก็บ tag ที่อยู่หน้า pallet reader
tags_disappeared_pallet = {} # tag หายรอ confirm
lot_tray_count  = {}   # จำนวน tray ทั้งหมดของแต่ละ lot
lot_tags        = {}   # เก็บ tag ทั้งหมดของแต่ละ lot

scanning    = False    # ควบคุม scan_loop ให้หยุดตอน shutdown
scan_thread = None     # thread object ของ scan_loop หลัก

# ALARM — ส่งเสียงเตือนผ่าน
alarm_active = False  # flag ป้องกัน start alarm ซ้อนกัน

def alarm_loop():
    """วนเล่นเสียงตลอดเวลาที่ alarm_active = True"""
    while alarm_active:
        winsound.Beep(2000, 500)
        time.sleep(0.1)

def start_alarm():
    """เริ่ม alarm เล่นเสียง"""
    global alarm_active
    if not alarm_active:
        alarm_active = True
        threading.Thread(target=alarm_loop, daemon=True).start()
        print(f"[{time.strftime('%H:%M:%S')}] [PLC] send '1' -> alarm ON")
        # publish_to_plc("1")  รอข้อมูล MQTT จากวิศวกร PLC
def stop_alarm():
    """หยุด alarm ปิดเสียง """
    global alarm_active
    alarm_active = False
    print(f"[{time.strftime('%H:%M:%S')}] [PLC] send '0' -> alarm OFF")
    # publish_to_plc("0")  รอข้อมูล MQTT จากวิศวกร PLC

# SCAN LOOP อ่าน tag จาก reader ทุก 0.5 วินาที
# ใช้ร่วมกันทุก reader type แต่ logic แตกต่างกันตาม READER_TYPE
def scan_loop():
    global scanning
    seen_tags = {}  # ใช้คำนวณ cooldown

    while scanning:
        try:
            # อ่าน tag ทั้งหมดที่อยู่ในระยะ reader ตอนนี้
            tags = inventory_g2(reader_state["port_handle"])
            reader_state["last_tags"] = tags  # อัพเดท last_tags ให้ทุก scan loop อ่านได้
            now = time.time()

            if READER_TYPE == "register":
                # register: เก็บ new_tag ให้ React poll ผ่าน /new-tag
                # cooldown ป้องกันบันทึกซ้ำถ้าวาง tag ค้างไว้
                for tag in tags:
                    last_seen = seen_tags.get(tag, 0)
                    if now - last_seen >= COOLDOWN:
                        seen_tags[tag]          = now
                        reader_state["new_tag"] = tag
                        print(f"[{time.strftime('%H:%M:%S')}] [register] New tag: {tag} -> {READER_PALLET_LOCATION}")
                        try:
                            httpx.post(f"{NODE_URL}/register-event", json={
                                "tag_id":   tag,
                                "location": READER_PALLET_LOCATION
                            }, timeout=5)
                        except Exception as ex:
                            print(f"[register-event] POST error: {ex}")
                seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

            elif READER_TYPE == "washing":
                # update sub_process = after_washing
                # เก็บ new_tag ให้ MachineValidate poll ผ่าน /new-tag/washing
                for tag in tags:
                    last_seen = seen_tags.get(tag, 0)
                    if now - last_seen >= COOLDOWN:
                        seen_tags[tag]          = now
                        reader_state["new_tag"] = tag
                        print(f"[{time.strftime('%H:%M:%S')}] [washing] New tag: {tag} -> {READER_PALLET_LOCATION}")
                        try:
                            # res    = httpx.post(f"{NODE_URL}/washing", json={
                            #     "tag_id":   tag,
                            #     "location": READER_PALLET_LOCATION
                            # }, timeout=5)
                            res = httpx.post(f"{NODE_URL}/washing", json={
                                "tag_id":       tag,
                                "location":     READER_PALLET_LOCATION,
                                "machine_no":   READER_PALLET_LOCATION,
                                "process_code": READER_PROCESS_CODE,
                                "process":      READER_PROCESS,
                            }, timeout=5)
                            result = res.json().get("result")
                            if result == "LOT_NOT_READY":
                                print(f"[washing] [WARNING] LOT NOT READY: {tag}")
                            elif result not in ("OK",):
                                print(f"[washing] [WARNING] {result}: {tag}")
                        except Exception as ex:
                            print(f"[washing] POST error: {ex}")
                seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

        except Exception as ex:
            # reader หลุด reset state และหยุด loop รอ reconnect_loop จัดการใหม่
            print(f"[{time.strftime('%H:%M:%S')}] Reader disconnected: {ex}")
            reader_state["connected"]   = False
            reader_state["last_tags"]   = []
            reader_state["port_handle"] = -1
            scanning = False
            return
        time.sleep(0.5)

# SCAN LOOP on_machine ใช้เฉพาะ READER_TYPE = "on_machine"
# เช็ค part_no ว่าตรงกับเครื่องนี้ไหม + นับ qty สำหรับ MBR Monitor
def scan_loop_on_machine():
    global tags_on_machine, rejected_tags
    global current_qty, tag_qty

    while True:
        if not reader_state["connected"]:
            time.sleep(0.5)
            continue

        if reader_state["on_machine_active"]:
            try:
                current_tags = set(reader_state["last_tags"])
                now          = time.time()

                new_tags = current_tags - set(tags_on_machine.keys()) - rejected_tags
                for tag in new_tags:
                    print(f"[{time.strftime('%H:%M:%S')}] [ON MACHINE] {tag}")
                    try:
                        res     = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                        data    = res.json()
                        part_no = data.get("data", {}).get("part_no")

                        if not part_no:
                            # ไม่พบ part_no lot ไม่ถูกต้องหรือยังไม่ register
                            print(f"[alarm] part_no is None: {tag}")
                            rejected_tags.add(tag)
                            start_alarm()
                        else:
                            # เช็ค part_no ตรงกับ MACHINE_PART_NO ไหม
                            # ถ้าไม่ตรง ลอง part convert API หา part_no
                            matched = part_no in MACHINE_PART_NO
                            if not matched:
                                try:
                                    res_conv = httpx.get(f"{NODE_URL}/part-convert/{part_no}", timeout=5)
                                    conv_data = res_conv.json()
                                    converted_parts = []
                                    if isinstance(conv_data, list):
                                        converted_parts = [item.get("partConvertTo") for item in conv_data if isinstance(item, dict)]
                                    for cp in converted_parts:
                                        if cp and cp in MACHINE_PART_NO:
                                            matched = True
                                            break
                                except Exception as e:
                                    print(f"[part-convert] error: {e}")

                            if not matched:
                                # part_no ไม่ตรงกับเครื่องนี้ alarm
                                print(f"[alarm] MISMATCH: {tag} part_no={part_no}")
                                rejected_tags.add(tag)
                                start_alarm()
                            else:
                                # part_no ตรง POST on-machine และบวก qty
                                stop_alarm()
                                tags_on_machine[tag] = now
                                # res    = httpx.post(f"{NODE_URL}/on-machine", json={
                                #     "tag_id": tag
                                #     }, timeout=5)
                                res = httpx.post(f"{NODE_URL}/on-machine", json={
                                    "tag_id":       tag,
                                    "machine_no":   MACHINE_NO or READER_PALLET_LOCATION,
                                    "process_code": READER_PROCESS_CODE,
                                    "process":      READER_PROCESS,
                                }, timeout=5)
                                result = res.json().get("result")
                                if result in ("LOT_NOT_READY", "NOT_WASHED"):
                                    # washing ยังไม่ครบทุก tray ยังไม่พร้อม on_machine
                                    print(f"[on_machine] [WARNING] {result}: {tag}")
                                    tags_on_machine.pop(tag, None)
                                    rejected_tags.add(tag)
                                    start_alarm()
                                else:
                                    # on_machine สำเร็จ บวก tray_qty เข้า current_qty
                                    raw_qty      = data.get("data", {}).get("tray_qty", 0)
                                    tray_qty_val = raw_qty[0] if isinstance(raw_qty, list) else int(raw_qty or 0)
                                    tag_qty[tag]  = tray_qty_val
                                    current_qty  += tray_qty_val
                                    print(f"[on_machine] [OK] {tag} qty+={tray_qty_val} current_qty={current_qty}")

                    except Exception as ex:
                        print(f"[on_machine] error: {ex}")

                # rejected tag ออกจาก reader stop alarm ถ้าไม่มี rejected
                removed_rejected = rejected_tags - current_tags
                if removed_rejected:
                    rejected_tags -= removed_rejected
                    if not rejected_tags:
                        stop_alarm()

                # tag ออกจาก reader ลด qty
                # ถ้า tag กลับเข้ามาใหม่ จะถูกจับเป็น new_tags ใหม่อัตโนมัติ
                left_tags = set(tags_on_machine.keys()) - current_tags
                for tag in left_tags:
                    print(f"[{time.strftime('%H:%M:%S')}] [LEFT] {tag}")
                    qty_removed  = tag_qty.pop(tag, 0)
                    current_qty -= qty_removed
                    current_qty  = max(current_qty, 0)
                    print(f"[LEFT] qty-={qty_removed} current_qty={current_qty}")
                    tags_on_machine.pop(tag, None)

                # ถ้าไม่มี tag ที่ rejected เหลืออยู่ stop alarm
                if not (current_tags - set(tags_on_machine.keys())):
                    stop_alarm()

            except Exception as ex:
                print(f"[scan_loop_on_machine] Error: {ex}")

        time.sleep(0.5)

# SCAN LOOP completed ใช้เฉพาะ READER_TYPE = "completed"
def scan_loop_completed():
    seen_tags = {}  # cooldown เพื่อกัน completed ซ้ำถ้า tag ค้างหน้า reader

    while True:
        if not reader_state["connected"]:
            time.sleep(0.5)
            continue

        try:
            tags = reader_state["last_tags"]
            now  = time.time()

            for tag in tags:
                last_seen = seen_tags.get(tag, 0)
                if now - last_seen >= COOLDOWN:
                    seen_tags[tag] = now
                    print(f"[{time.strftime('%H:%M:%S')}] [COMPLETED SCAN] {tag}")
                    try:
                        res = httpx.post(f"{NODE_URL}/completed", json={
                            "tag_id": tag
                            }, timeout=5)
                        result = res.json().get("result")
                        if result == "LOT_COMPLETED":
                            # ทุก tray ใน lot นี้ completed ครบแล้ว tag พร้อมวนใช้ใหม่
                            print(f"[{time.strftime('%H:%M:%S')}] [LOT COMPLETED] tag พร้อมวนใช้ใหม่")
                        elif result == "NOT_ON_MACHINE":
                            # tag นี้ยังไม่เคย on_machine มาก่อน scan ผิดจุด
                            print(f"[completed] [WARNING] NOT_ON_MACHINE: {tag}")
                            start_alarm()
                            time.sleep(1)
                            stop_alarm()
                        elif result not in ("OK",):
                            print(f"[completed] [WARNING] {result}: {tag}")

                    except Exception as ex:
                        print(f"[completed] POST error: {ex}")

            # ล้าง cooldown ของ tag ที่ไม่อยู่หน้า reader แล้ว
            seen_tags = {k: v for k, v in seen_tags.items() if now - v < COOLDOWN}

        except Exception as ex:
            print(f"[scan_loop_completed] Error: {ex}")

        time.sleep(0.5)

# SCAN LOOP pallet ใช้เฉพาะ READER_TYPE = "pallet"
def scan_loop_pallet():
    global tags_on_pallet, lot_tray_count, lot_tags, tags_disappeared_pallet
    while True:
        if not reader_state["connected"]:
            time.sleep(0.5)
            continue
        try:
            current_tags = set(reader_state["last_tags"])
            now          = time.time()
            # tag ใหม่เข้ามา
            new_tags = current_tags - set(tags_on_pallet.keys())
            for tag in new_tags:
                # ถ้า tag เคยหายไปแล้วกลับมา ยกเลิก disappeared
                if tag in tags_disappeared_pallet:
                    print(f"[{time.strftime('%H:%M:%S')}] [PALLET RETURNED] {tag}")
                    tags_disappeared_pallet.pop(tag, None)
                print(f"[{time.strftime('%H:%M:%S')}] [PALLET IN] {tag} -> {READER_PALLET_LOCATION}")
                try:
                    res    = httpx.post(f"{NODE_URL}/pallet",
                        json={"tag_id": tag, "location": READER_PALLET_LOCATION},
                        timeout=5)
                    result = res.json().get("result")
                    if result in ("OK", "DUPLICATE_LOCATION"):
                        tags_on_pallet[tag] = now
                        lot_res      = httpx.get(f"{NODE_URL}/lot-by-tag/{tag}", timeout=5)
                        lot_data     = lot_res.json().get("data", {})
                        barcode      = lot_data.get("barcode")
                        tray_counter = lot_data.get("tray_counter", 0)
                        if barcode:
                            lot_tray_count[barcode] = tray_counter
                            if barcode not in lot_tags:
                                lot_tags[barcode] = set()
                            lot_tags[barcode].add(tag)
                            print(f"[pallet] lot={barcode} tag={tag} ({len(lot_tags[barcode])}/{tray_counter})")
                        if result == "DUPLICATE_LOCATION":
                            print(f"[pallet] same location: {tag}")
                    else:
                        print(f"[pallet] [WARNING] {result}: {tag}")
                except Exception as ex:
                    print(f"[pallet] POST error: {ex}")
            # tag หายออก เริ่มนับ delay
            left_tags = set(tags_on_pallet.keys()) - current_tags
            for tag in left_tags:
                if tag not in tags_disappeared_pallet:
                    print(f"[{time.strftime('%H:%M:%S')}] [PALLET MISSING] {tag} → waiting {PALLET_OUT_COOLDOWN}s")
                    tags_disappeared_pallet[tag] = now
                tags_on_pallet.pop(tag, None)
            # เช็ค tag ที่หายไปนานเกิน delay
            for tag, t in list(tags_disappeared_pallet.items()):
                if now - t >= PALLET_OUT_COOLDOWN:
                    print(f"[{time.strftime('%H:%M:%S')}] [PALLET OUT] {tag} -> {READER_PALLET_LOCATION}")
                    tags_disappeared_pallet.pop(tag, None)

                    barcode = next((b for b, tags in lot_tags.items() if tag in tags), None)
                    if barcode:
                        tray_counter = lot_tray_count.get(barcode, 0)
                        remaining    = lot_tags[barcode] & set(tags_on_pallet.keys())
                        print(f"[pallet] lot={barcode} remaining={len(remaining)}/{tray_counter}")

                        if len(remaining) == 0 and len(lot_tags.get(barcode, set())) >= tray_counter:
                            print(f"[{time.strftime('%H:%M:%S')}] [PALLET LOT OUT] lot={barcode}")
                            try:
                                httpx.post(f"{NODE_URL}/pallet-lot-out", json={
                                    "barcode":  barcode,
                                    "location": READER_PALLET_LOCATION,
                                }, timeout=5)
                            except Exception as ex:
                                print(f"[pallet-lot-out] error: {ex}")
                            lot_tags.pop(barcode, None)
                            lot_tray_count.pop(barcode, None)
            # reader หลุด clear tracking
            if not reader_state["connected"]:
                tags_on_pallet.clear()
                lot_tags.clear()
                lot_tray_count.clear()
                tags_disappeared_pallet.clear()
            # sync tags_on_pallet
            tags_on_pallet = {k: v for k, v in tags_on_pallet.items() if k in current_tags}
        except Exception as ex:
            print(f"[scan_loop_pallet] Error: {ex}")
        time.sleep(0.5)
        
# CONNECT READER เชื่อมต่อ reader ผ่าน TCP/IP และเริ่ม scan_loop
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
    print(f"Connect result: {get_error_desc(result)}")

    if result == 0:
        reader_state["port_handle"] = handle
        set_power(READER_POWER, handle)
        reader_state["connected"] = True
        scanning    = True
        scan_thread = threading.Thread(target=scan_loop, daemon=True)
        scan_thread.start()
        print(f"[OK] [{READER_TYPE}] Connected: {READER_IP}")
    else:
        reader_state["connected"]   = False
        reader_state["port_handle"] = -1
        print(f"[FAIL] Connect failed: {get_error_desc(result)}")
# def connect_reader():
#     global scanning, scan_thread
#     try:
#         # ปิด connection เดิมก่อน
#         if reader_state["port_handle"] != -1:
#             close_net_port(reader_state["port_handle"])
#     except:
#         pass
#     time.sleep(1)

#     result, handle = open_net_port(READER_IP, READER_PORT_TCP)
#     print(f"Connect result: {get_error_desc(result)}")

#     if result == 0:
#         reader_state["port_handle"] = handle
#         set_power(READER_POWER, handle)  # ตั้งค่ากำลังส่งสัญญาณ
#         reader_state["connected"] = True
#         scanning    = True
#         scan_thread = threading.Thread(target=scan_loop, daemon=True)
#         scan_thread.start()
#         print(f"[OK] [{READER_TYPE}] Connected: {READER_IP}")
#     else:
#         reader_state["connected"]   = False
#         reader_state["port_handle"] = -1
#         print(f"[FAIL] Connect failed: {get_error_desc(result)}")

def reconnect_loop():
    fail_count = 0
    while True:
        if not reader_state["connected"]:
            print(f"[{time.strftime('%H:%M:%S')}] Reconnecting...")
            connect_reader()
            
            if not reader_state["connected"]:
                fail_count += 1
                print(f"[FAIL] attempt {fail_count}")
                if fail_count >= 3:
                    print(f"[FAIL] Too many retries → exiting for restart")
                    os._exit(1) 
            else:
                fail_count = 0
        time.sleep(5)
# def reconnect_loop():
#     """วน loop ตลอดเวลา ถ้า reader หลุดจะ reconnect ทุก 5 วินาที"""
#     while True:
#         if not reader_state["connected"]:
#             print(f"[{time.strftime('%H:%M:%S')}] Reconnecting...")
#             connect_reader()
#         time.sleep(5)

# LIFESPAN — รันตอน startup และ shutdown ของ FastAPI
@asynccontextmanager
async def lifespan(app: FastAPI):
    print(f"Starting {READER_TYPE} service @ {READER_IP} (index={READER_INDEX})")
    # เริ่ม reconnect_loop ทุก reader type
    threading.Thread(target=reconnect_loop, daemon=True).start()
    # เริ่ม scan loop แยกตาม reader type
    if READER_TYPE == "on_machine":
        threading.Thread(target=scan_loop_on_machine, daemon=True).start()
    if READER_TYPE == "pallet":
        threading.Thread(target=scan_loop_pallet, daemon=True).start()
    if READER_TYPE == "completed":
        threading.Thread(target=scan_loop_completed, daemon=True).start()
    yield
    # Shutdown หยุด scan และปิด connection
    global scanning
    scanning = False
    if reader_state["port_handle"] != -1:
        close_net_port(reader_state["port_handle"])
    print("Service stopped")

# FASTAPI APP
app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# Endpoints

@app.get("/status")
def status():
    """สถานะ reader + qty info สำหรับ MBR Monitor"""
    global current_qty
    return {
        "connected":   reader_state["connected"],
        "ip":          reader_state["ip"],
        "type":        READER_TYPE,
        "location":    READER_PALLET_LOCATION,
        "current_qty": current_qty,   # จำนวน pcs รวมที่อยู่หน้า on_machine reader
        "min_qty":     MIN_QTY,       # threshold ที่กำหนดใน readers_config.json
        "low_qty":     MIN_QTY > 0 and current_qty < MIN_QTY,  # true = ต่ำกว่ากำหนด
    }

@app.get("/tags")
def get_tags():
    """ดู tag ทั้งหมดที่อยู่ในระยะ reader ตอนนี้ (real-time)"""
    return {"tags": reader_state["last_tags"], "count": len(reader_state["last_tags"])}

@app.get("/new-tag")
def get_new_tag():
    """ดึง tag ล่าสุดที่ผ่าน register reader React poll endpoint นี้"""
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None  # clear หลังดึงแล้ว
    return {"tag_id": tag}

@app.get("/new-tag/washing")
def get_new_tag_washing():
    """ดึง tag ล่าสุดที่ผ่าน washing reader MachineValidate poll endpoint นี้"""
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None
    return {"tag_id": tag}

@app.get("/new-tag/pallet")
def get_new_tag_pallet():
    """ดึง tag ล่าสุดที่ผ่าน pallet reader พร้อม location"""
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None
    return {"tag_id": tag, "location": READER_PALLET_LOCATION}

@app.get("/test-alarm")
def test_alarm():
    """ทดสอบ alarm — เรียกจาก browser ได้เลย"""
    threading.Thread(target=start_alarm, daemon=True).start()
    return {"status": "alarm triggered"}

@app.get("/restart")
def restart_reader():
    """
    Restart reader process นี้ เรียกจาก ReaderConfig หน้าเว็บ
    """
    def do_restart():
        time.sleep(0.5)
        os.execv(sys.executable, [
            sys.executable, '-m', 'uvicorn',
            'main_dll:app',
            '--port', str(CFG['port']),
            '--log-level', 'warning'
        ])
    threading.Thread(target=do_restart, daemon=True).start()
    return {"result": "OK"}

# =============================================================================
# MQTT — ส่งสัญญาณ alarm ไปหา PLC
# รอข้อมูลจากวิศวกร PLC: IP broker, topic, payload format
# ติดตั้งก่อน: pip install paho-mqtt
# =============================================================================

# import paho.mqtt.client as mqtt
#
# MQTT_BROKER      = "192.168.1.xxx"  # IP ของ MQTT broker
# MQTT_PORT        = 1883              # port มาตรฐานของ MQTT
# MQTT_TOPIC       = "plc/alarm"      # topic ที่ PLC subscribe อยู่
# MQTT_PAYLOAD_ON  = "1"              # PLC รับแล้วเปิดลำโพง
# MQTT_PAYLOAD_OFF = "0"              # PLC รับแล้วปิดลำโพง
#
# def publish_to_plc(payload: str):
#     """ส่ง MQTT message ไปหา PLC"""
#     try:
#         client = mqtt.Client()
#         client.connect(MQTT_BROKER, MQTT_PORT, keepalive=5)
#         client.publish(MQTT_TOPIC, payload)
#         client.disconnect()
#         print(f"[MQTT] Published: {payload} -> {MQTT_TOPIC}")
#     except Exception as ex:
#         print(f"[MQTT] Error: {ex}")
#
# def start_alarm():
#     global alarm_active
#     if not alarm_active:
#         alarm_active = True
#         threading.Thread(target=alarm_loop, daemon=True).start()
#         publish_to_plc(MQTT_PAYLOAD_ON)
#
# def stop_alarm():
#     global alarm_active
#     alarm_active = False
#     publish_to_plc(MQTT_PAYLOAD_OFF)