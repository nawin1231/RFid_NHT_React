import socket
import time

s = socket.socket()
s.connect(("192.168.1.101", 6000))  # ← IP reader on_machine
s.settimeout(0.3)

start  = time.time()
counts = {}

print("เริ่มอ่าน 10 วินาที...")
while time.time() - start < 10:
    try:
        data = s.recv(4096)
        if data:
            i = 0
            while i < len(data):
                length = data[i]
                if length == 0:
                    break
                if i + 5 >= len(data):
                    break
                epc = f"{data[i+5]:04X}"
                counts[epc] = counts.get(epc, 0) + 1
                i += length + 1
    except socket.timeout:
        pass

print(f"\nจำนวน tag ที่ตรวจพบ: {len(counts)} ตัว")
for tag, c in sorted(counts.items()):
    print(f"  {tag}: {c} ครั้ง")

s.close()