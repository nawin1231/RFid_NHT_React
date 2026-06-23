import httpx
import time
import os

NODE_URL = "http://localhost:5000/api/rfid"

def clear():
    os.system('cls')

while True:
    try:
        # ดึง log on_machine ล่าสุด
        res  = httpx.get(f"{NODE_URL}/on-machine-log", timeout=5)
        logs = res.data if hasattr(res, 'data') else res.json()

        clear()
        print("=" * 60)
        print(f"  ON MACHINE MONITOR  [{time.strftime('%H:%M:%S')}]")
        print("=" * 60)
        print(f"{'Tag ID':<10} {'Barcode':<12} {'Part No':<20} {'Status':<12} {'Time'}")
        print("-" * 60)

        for log in logs[:20]:  # แสดงแค่ 20 อันล่าสุด
            print(f"{log.get('tag_id',''):<10} {log.get('barcode',''):<12} {log.get('part_no',''):<20} {log.get('sub_process',''):<12} {log.get('created_at','')}")

        print("-" * 60)

    except Exception as ex:
        print(f"Error: {ex}")

    time.sleep(2)  # refresh ทุก 2 วิ