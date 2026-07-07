from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from contextlib import asynccontextmanager
import threading
import time
import httpx
from sid_u861 import (
    open_net_port, close_net_port,
    inventory_g2,  set_power,
    get_error_desc
)

#Config
READER_IP    = "192.168.1.102"
READER_PORT  = 6000
READER_POWER = 5
COOLDOWN     = 3
NODE_URL     = "://localhost:5000/api/rfid"

# STATE
reader_state = {
    "connected":   False,
    "ip":          READER_IP,
    "port":        READER_PORT,
    "port_handle": -1,
    "last_tags":   [],
    "new_tag":      None
}

scanning    = False
scan_thread = None

# SCAN LOOP Washing
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
                    seen_tags[tag] = now
                    print(f"[{time.strftime('%H:%M:%S')}] [washing] New tag: {tag}")
                    try:
                        reader_state["new_tag"] = tag
                        httpx.post(f"{NODE_URL}/washing",
                            json={"tag_id": tag},
                            timeout=5)
                    except Exception as ex:
                        print(f"[washing] POST error: {ex}")
            seen_tags = {k: v for k, v in seen_tags.items() if k in tags}
        except Exception as ex:
            print(f"[{time.strftime('%H:%M:%S')}] Reader disconnected: {ex}")
            reader_state["connected"]   = False
            reader_state["last_tags"]   = []
            reader_state["port_handle"] = -1
            scanning = False
            return
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
    print("Starting washing service...")
    threading.Thread(target=reconnect_loop, daemon=True).start()
    yield
    global scanning
    scanning = False
    if reader_state["port_handle"] != -1:
        close_net_port(reader_state["port_handle"])
    print("Washing service stopped")

# FASTAPI APP
app = FastAPI(lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

# ENDPOINTS

# ดูสถานะการเชื่อมต่อ reader
@app.get("/status")
def status():
    return {"connected": reader_state["connected"], "ip": reader_state["ip"]}

# ดู tag ทั้งหมดที่อยู่ในระยะ reader
@app.get("/tags")
def get_tags():
    return {"tags": reader_state["last_tags"], "count": len(reader_state["last_tags"])}

# ดึง tag washing
@app.get("/new-tag/washing")
def get_new_tag_washing():
    tag = reader_state["new_tag"]
    reader_state["new_tag"] = None
    return {"tag_id": tag}