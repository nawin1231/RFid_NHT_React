import subprocess
import sys
import os
import time
import json
import hashlib

BASE_DIR    = os.path.dirname(os.path.abspath(__file__))
CONFIG_PATH = os.path.join(BASE_DIR, 'readers_config.json')

def get_config_hash():
    try:
        with open(CONFIG_PATH, 'rb') as f:
            return hashlib.md5(f.read()).hexdigest()
    except:
        return None

def kill_process_by_port(port):
    try:
        cmd    = f"netstat -ano | findstr :{port}"
        output = subprocess.check_output(cmd, shell=True).decode()
        for line in output.splitlines():
            parts = line.split()
            if "LISTENING" in parts:
                pid = parts[-1]
                subprocess.call(f"taskkill /PID {pid} /F",
                    shell=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
                time.sleep(2)
    except:
        pass

def start_process():
    kill_process_by_port(8000)
    time.sleep(1)
    env = os.environ.copy()
    env['PYTHONUNBUFFERED'] = '1'
    return subprocess.Popen([
        sys.executable, '-m', 'uvicorn', 'main_multi:app',
        '--port', '8000', '--log-level', 'warning'
    ], cwd=BASE_DIR, env=env)

print("[start_rfid] Starting RFID service on port 8000...")
process     = start_process()
last_hash   = get_config_hash()

try:
    while True:
        # เช็ค crash
        if process.poll() is not None:
            print("[start_rfid] Crash detected → Restarting...")
            time.sleep(3)
            process   = start_process()
            last_hash = get_config_hash()

        # เช็ค config เปลี่ยน
        current_hash = get_config_hash()
        if current_hash and current_hash != last_hash:
            print("[start_rfid] Config changed → Restarting...")
            process.terminate()
            time.sleep(2)
            process   = start_process()
            last_hash = current_hash

        time.sleep(3)

except KeyboardInterrupt:
    print("\n[start_rfid] Shutting down...")
    process.terminate()
    print("[start_rfid] Stopped!")