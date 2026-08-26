const PageGuild = {

    '/multi-register': {
        title: 'วิธีใช้งาน Register',
        html: `
            <div style="display:flex;gap:16px;text-align:left;font-size:20px;align-items:flex-start">
                <div style="flex:1;min-width:0">
                    <p style="font-weight:600;margin-bottom:6px">① เพิ่ม Job</p>
                    <ul style="padding-left:16px;margin-bottom:12px;line-height:2">
                        <li>สแกน Barcode ที่ช่องบน → job ขึ้นในตาราง</li>
                        <li>กด ✕ ที่แถวเพื่อลบ job ออก</li>
                        <li>กด <strong style="color:#008000">Start Registering →</strong> เมื่อเพิ่มครบ</li>
                    </ul>
                    <p style="font-weight:600;margin-bottom:6px">② สแกน RFID Tag</p>
                    <ul style="padding-left:16px;line-height:2">
                        <li>กดที่แถว job → แถวสีน้ำเงิน = <strong style="color:#2563eb">ACTIVE</strong></li>
                        <li>นำ tray แตะ reader → Progress เพิ่มทีละ tray</li>
                        <li>ครบทุก tray → <strong style="color:#16a34a">DONE</strong></li>
                        <li>กด <strong style="color:#dc2626">Cancel All</strong> เพื่อเริ่มใหม่</li>
                    </ul>
                </div>
                <img src="/MultiRegister.png" style="flex:1.5;width:0;min-width:0;border-radius:6px;object-fit:contain"/>
            </div>
        `,
    },

    '/location-reader': {
        title: 'วิธีใช้งาน Location',
        html: `
            <div style="display:flex;gap:16px;text-align:left;font-size:20px;align-items:flex-start">
                <div style="flex:1;min-width:0">
                    <p style="font-weight:600;margin-bottom:6px">① เลือก Location</p>
                    <ul style="padding-left:16px;margin-bottom:12px;line-height:2">
                        <li>พิมพ์ในช่อง Search เพื่อกรอง location</li>
                        <li>ตารางซ้าย → <strong style="color:#2563eb">Multi Register / Tag Search</strong></li>
                        <li>ตารางขวา → <strong style="color:#2563eb">Machine Validation</strong></li>
                    </ul>
                    <p style="font-weight:600;margin-bottom:6px">② เปิดหน้างาน</p>
                    <ul style="padding-left:16px;line-height:2">
                        <li>กดแถว location ที่ต้องการ → <strong style="color:#2563eb">Open →</strong></li>
                        <li>ระบบจะเปิดหน้านั้นพร้อม location ที่เลือกอัตโนมัติ</li>
                    </ul>
                </div>
                <img src="/Location.png" style="flex:1.5;width:0;min-width:0;border-radius:6px;object-fit:contain"/>
            </div>
        `,
    },
    
    //TagSearch
    '/tag-search': {
        title: 'วิธีใช้งาน Tag Search',
        html: `
        <div style="display:flex;gap:16px;text-align:left;font-size:20px;align-items:flex-start">
            <div style="flex:1;min-width:0">
                <p style="font-weight:600;margin-bottom:6px">① ค้นหา Tag</p>
                <ul style="padding-left:16px;margin-bottom:12px;line-height:2">
                    <li>พิมพ์หรือสแกน Tag ID ในช่อง Search</li>
                    <li>กด <strong style="color:#2563eb">Go</strong> หรือกด Enter เพื่อค้นหา</li>
                    <li>กด <strong style="color:#dc2626">✕</strong> เพื่อล้างรายการทั้งหมด</li>
                </ul>
                <p style="font-weight:600;margin-bottom:6px">② Tags in Range</p>
                <ul style="padding-left:16px;margin-bottom:12px;line-height:2">
                    <li>Tag ที่อยู่ใน range ของ reader จะขึ้นอัตโนมัติ</li>
                    <li>กดแถว tag เพื่อดูรายละเอียด</li>
                </ul>
                <p style="font-weight:600;margin-bottom:6px">③ รายละเอียด Tag</p>
                <ul style="padding-left:16px;line-height:2">
                    <li>ฝั่งขวาแสดง Barcode, Part No., Sub Process, Status</li>
                    <li>ถ้า tag ไม่มีในระบบ → <strong style="color:#dc2626">Not Found</strong></li>
                </ul>
            </div>
            <img src="/ScanTag.png" style="flex:1.5;width:0;min-width:0;border-radius:6px;object-fit:contain"/>
        </div>
    `,
    },
    // Machine Validation
    '/machine-validation': {
    title: 'วิธีใช้งาน Machine Validation',
    html: `
        <div style="display:flex;gap:16px;text-align:left;font-size:20px;align-items:flex-start">
            <div style="flex:1;min-width:0">
                <p style="font-weight:600;margin-bottom:6px">① สแกน RFID Tag</p>
                <ul style="padding-left:16px;margin-bottom:12px;line-height:2">
                    <li>นำ tray แตะ reader → ระบบดึงข้อมูล lot อัตโนมัติ</li>
                    <li>แสดง Barcode, Part No., Tray Counter, RW Diameter</li>
                    <li>กด <strong style="color:#dc2626">✕ Clear</strong> เพื่อล้างข้อมูลปัจจุบัน</li>
                </ul>
                <p style="font-weight:600;margin-bottom:6px">② Tray Progress</p>
                <ul style="padding-left:16px;margin-bottom:12px;line-height:2">
                    <li>Progress bar แสดงจำนวน tray ที่ผ่าน washing แล้ว</li>
                    <li>ครบทุก tray → ตารางแสดง <strong style="color:#2563eb">Matching Machines</strong></li>
                </ul>
                <p style="font-weight:600;margin-bottom:6px">③ History</p>
                <ul style="padding-left:16px;line-height:2">
                    <li>ฝั่งขวาเก็บ 10 lot ล่าสุด</li>
                    <li>กด lot ใน history เพื่อดู machine list ย้อนหลัง</li>
                    <li>กด <strong style="color:#dc2626">Clear</strong> เพื่อล้าง history ทั้งหมด</li>
                </ul>
            </div>
            <img src="/MachineValidation.png" style="flex:1.5;width:0;min-width:0;border-radius:6px;object-fit:contain"/>
        </div>
    `,
},

};

export default PageGuild;