import ctypes
import os

# โหลด DLL 32-bit
DLL_PATH = os.path.join(os.path.dirname(__file__), "SID_U861.dll")
dll = ctypes.WinDLL(DLL_PATH)

# CONNECTION

def open_net_port(ip: str, port: int = 6000) -> tuple:
    """
    Connect RFID reader ผ่าน TCP/IP
    return (result, port_handle)
    result = 0 → success
    port_handle → ใช้ส่งให้ function อื่นๆ
    """
    func = dll.OpenNetPort
    func.restype  = ctypes.c_int
    func.argtypes = [
        ctypes.c_int,                  # Port
        ctypes.c_char_p,               # IPaddr
        ctypes.POINTER(ctypes.c_byte), # ComAddr
        ctypes.POINTER(ctypes.c_int),  # PortHandle
    ]
    local_com_addr = ctypes.c_byte(0xFF)  # com address เริ่มต้น 0xFF = broadcast
    local_handle   = ctypes.c_int(-1)     # handle เริ่มต้น -1 = ยังไม่ connect

    result = func(
        port,
        ip.encode(),
        ctypes.byref(local_com_addr),
        ctypes.byref(local_handle)
    )
    return result, local_handle.value


def close_net_port(port_handle: int) -> int:
    """
    ปิด connection TCP/IP
    port_handle → handle ที่ได้จาก open_net_port
    """
    func = dll.CloseNetPort
    func.restype  = ctypes.c_int
    func.argtypes = [ctypes.c_int]
    return func(port_handle)


def open_com_port(port: int, baud: int = 5) -> tuple:
    """
    Connect ผ่าน RS232
    baud: 0=9600, 1=19200, 2=38400, 3=57600, 4=115200
    return (result, port_handle)
    """
    func = dll.OpenComPort
    func.restype  = ctypes.c_int
    func.argtypes = [
        ctypes.c_int,
        ctypes.POINTER(ctypes.c_byte),
        ctypes.c_byte,
        ctypes.POINTER(ctypes.c_int),
    ]
    local_com_addr = ctypes.c_byte(0xFF)
    local_handle   = ctypes.c_int(-1)

    result = func(port, ctypes.byref(local_com_addr), baud, ctypes.byref(local_handle))
    return result, local_handle.value


def close_com_port() -> int:
    """ปิด connection RS232"""
    func = dll.CloseComPort
    func.restype  = ctypes.c_int
    func.argtypes = []
    return func()


# READ TAG

def inventory_g2(port_handle: int) -> list:
    """
    อ่าน EPC ทุก tag ที่อยู่ในระยะ reader
    port_handle → handle ของ reader ที่ต้องการอ่าน
    return list ของ EPC hex string เช่น ['E2003411B802...', ...]
    """
    func = dll.Inventory_G2
    func.restype  = ctypes.c_int
    func.argtypes = [
        ctypes.POINTER(ctypes.c_byte), # ComAddr
        ctypes.c_byte,                 # Qvalue
        ctypes.c_byte,                 # Session
        ctypes.c_byte,                 # AdrTID
        ctypes.c_byte,                 # LenTID
        ctypes.c_byte,                 # TIDFlag
        ctypes.POINTER(ctypes.c_byte), # EPClenandEPC buffer
        ctypes.POINTER(ctypes.c_int),  # Totallen
        ctypes.POINTER(ctypes.c_int),  # CardNum
        ctypes.c_int,                  # PortHandle
    ]

    local_com_addr = ctypes.c_byte(0xFF)
    epc_buffer     = (ctypes.c_byte * 5000)()  # buffer เก็บ EPC ทุก tag
    total_len      = ctypes.c_int(0)
    card_num       = ctypes.c_int(0)

    result = func(
        ctypes.byref(local_com_addr),
        4, 0, 0, 0, 0,       # Qvalue=4, Session=0, TID=0
        epc_buffer,
        ctypes.byref(total_len),
        ctypes.byref(card_num),
        port_handle           # ← ระบุ reader ที่ต้องการ
    )

    # error ที่บ่งบอกว่า reader หลุด → raise เพื่อให้ reconnect
    if result in (0x30, 0x35, 0x37, -1):
        raise ConnectionError(f"Reader disconnected: {get_error_desc(result)}")

    # result อื่นที่ไม่ใช่ success → return ว่าง
    if result not in (0, 1, 2, 3, 4, 0xFB):
        return []

    # ไม่มี tag → return ว่าง
    if card_num.value == 0:
        return []

    # แปลง buffer เป็น EPC list
    raw = bytes(b & 0xFF for b in epc_buffer[:total_len.value])
    epc_list = []
    idx      = 0

    for _ in range(card_num.value):
        if idx >= len(raw):
            break

        epc_len = raw[idx]
        idx    += 1
        if idx + epc_len > len(raw):
            break
        epc_bytes = raw[idx:idx + epc_len]
        epc_list.append(epc_bytes.hex().upper())
        idx += epc_len
        if idx < len(raw):
            idx += 1
    return epc_list

# POWER

def set_power(power_dbm: int, port_handle: int) -> int:
    """
    ปรับ power / ระยะอ่าน
    power_dbm → เช่น 10, 15, 20, 26, 30 (dBm)
    port_handle → handle ของ reader ที่ต้องการปรับ
    """
    func = dll.SetPowerDbm
    func.restype  = ctypes.c_int
    func.argtypes = [
        ctypes.POINTER(ctypes.c_byte), # ComAddr
        ctypes.c_byte,                 # powerDbm
        ctypes.c_int,                  # PortHandle
    ]
    local_com_addr = ctypes.c_byte(0xFF)
    return func(ctypes.byref(local_com_addr), power_dbm, port_handle)


# BUZZER / LED

def buzzer_and_led(active_time: int, silent_time: int, times: int, port_handle: int) -> int:
    """
    สั่ง reader ส่งเสียง / กระพริบไฟ
    active_time → ระยะเวลาดัง (หน่วย 100ms)
    silent_time → ระยะเวลาเงียบ (หน่วย 100ms)
    times       → จำนวนครั้ง
    port_handle → handle ของ reader
    """
    func = dll.BuzzerAndLEDControl
    func.restype  = ctypes.c_int
    func.argtypes = [
        ctypes.POINTER(ctypes.c_byte),
        ctypes.c_byte, ctypes.c_byte, ctypes.c_byte,
        ctypes.c_int,
    ]
    local_com_addr = ctypes.c_byte(0xFF)
    return func(ctypes.byref(local_com_addr), active_time, silent_time, times, port_handle)


# ERROR CODE

def get_error_desc(code: int) -> str:
    """แปลง error code เป็นข้อความ"""
    errors = {
        0x00: "Success",
        0x01: "Return before Inventory finished",
        0x02: "Inventory scan time overflow",
        0x30: "Communication error",
        0x35: "ComPort already opened",
        0x37: "Invalid handle",
        0xFB: "No tag found",
        0xFF: "Parameter error",
    }
    return errors.get(code, f"Unknown error: 0x{code:02X}")