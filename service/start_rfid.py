import subprocess
import json
import os
import time
import sys

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, 'readers_config.json')

def kill_process_by_port(port):
    """
    ปิด process ที่ใช้ port นี้อยู่ก่อน start ใหม่
    ป้องกัน "port already in use" ถ้ามี process เก่าค้างอยู่
    """
    try:
        cmd    = f"netstat -ano | findstr :{port}"
        output = subprocess.check_output(cmd, shell=True).decode()
        for line in output.splitlines():
            parts = line.split()
            if "LISTENING" in parts:
                pid = parts[-1]
                subprocess.call(f"taskkill /PID {pid} /F",
                    shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                time.sleep(3)
    except:
        pass

def start_reader_process(index, reader):
    """
    Spawn uvicorn process สำหรับ reader ตัวนี้
    ส่ง READER_INDEX ผ่าน environment variable ให้ main_dll.py รู้ว่าตัวเองคือ reader ไหน
    """
    port = reader['port']
    kill_process_by_port(port)

    env = os.environ.copy()
    env['READER_INDEX']     = str(index)   # บอก main_dll.py ว่าตัวเองเป็น index ไหน
    env['PYTHONUNBUFFERED'] = '1'

    cmd = [
        sys.executable, '-m', 'uvicorn', 'main_dll:app',
        '--port', str(port), '--log-level', 'warning'
    ]
    return subprocess.Popen(cmd, cwd=BASE_DIR, env=env)

# เก็บ process แต่ละตัว อ้างอิงตาม port
# {port: {process, index, type, port, reader}}
processes = {}

try:
    while True:
        # อ่าน config ใหม่ทุกรอบ detect การเปลี่ยนแปลงจาก ReaderConfig หน้าเว็บได้ทันที
        with open(CONFIG_PATH, 'r') as f:
            all_readers = json.load(f)

        # port ที่ควรรันอยู่ตาม config ปัจจุบัน
        active_ports_in_config = [r['port'] for r in all_readers if r.get('enabled', True)]

        # ปิด process ที่ถูก disable
        ports_to_remove = []
        for port, item in processes.items():
            if port not in active_ports_in_config:
                print(f"[start_rfid] Disabling reader-{item['type']} [Port: {port}]")
                try:
                    item['process'].terminate()
                except:
                    pass
                ports_to_remove.append(port)

        if ports_to_remove:
            for port in ports_to_remove:
                del processes[port]
            # รอให้ reader คืน TCP connection ก่อน start ใหม่
            print("[start_rfid] Waiting for connections to release...")
            time.sleep(2)

        # เปิด process ใหม่ หรือเช็ค crash
        for index, reader in enumerate(all_readers):
            port       = reader['port']
            is_enabled = reader.get('enabled', True)  # ถ้าไม่มี field enabled ถือว่า true

            if is_enabled:
                if port not in processes:
                    # enabled แต่ยังไม่มี process start ใหม่
                    print(f"[start_rfid] Starting reader-{reader['type']}-{index} [Port: {port}]")
                    p = start_reader_process(index, reader)
                    processes[port] = {
                        'process': p,
                        'index':   index,
                        'type':    reader['type'],
                        'port':    port,
                        'reader':  reader,
                    }
                else:
                    # มี process แล้ว เช็คว่า crash ไหม
                    item = processes[port]
                    if item['process'].poll() is not None:
                        # poll() ไม่ใช่ None = process จบแล้ว (crash)
                        print(f"[start_rfid] Crash detected: reader-{item['type']}-{item['index']} → Restarting...")
                        time.sleep(3)  # รอก่อน restart ป้องกัน restart loop เร็วเกินไป
                        item['process'] = start_reader_process(index, reader)
                        item['reader']  = reader
                        item['index']   = index

        time.sleep(3)  # เช็ค config และ process status ทุก 3 วินาที

except KeyboardInterrupt:
    # ปิด process ทั้งหมดก่อน exit
    print("\n[start_rfid] Shutting down all readers...")
    for port, item in processes.items():
        try:
            item['process'].terminate()
        except:
            pass
    print("[start_rfid] All readers stopped!")