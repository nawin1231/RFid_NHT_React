เดี๋ยวอธิบายแบบข้อความไปก่อนรอบแรก เดี๋ยวเขียน flow ให้ดูอีกที เพราะมีจุดที่ผมยังงงๆว่าจะเอาข้อมูลมายังไง

1.พนักงานเจนบาร์โค้ดหรือๅjob หรือ wos ที่เขาเรียก โดยข้อมูลนี้มาจาก as400 น่าจะดึงลงมาผ่าน api โดยการสแกน barcode ถ้าแบบเก่าก็คือ สแกนปุ๊ปแล้วนับมาเข้า database เพื่อรอที่จะผูกกับ tag ก่อน น่าจะพอเข้าใจ ถ้าอยากดูโค้ดเก่าๆที่ผมเคยทำ rfid ก็บอกได้นะจะได้มีลักษณะเดียวกัน และนำ wos ไปใส่ในซองที่มี tag rfid เพื่อไปสแกนกับ reader ที่เป็น UHF Desktop Reader ผูก tag กับ barcode รอบนี้จะเป็น 1:1 แล้วไม่เหมือนของ washing ซึ่งถ้ามีวิธีที่ดีกว่านี้ก็แนะนำผมได้
2.เมื่อสแกน tag เสร็จ นำงานไปวางที่สายพาน สายพานระหว่างทางจะมี reader ในการสแกนอีกครั้งซึ่งยังไม่ชัวร์ว่าจะสแกนเพื่ออะไร อาจจะเปลี่ยนแปลงสถานะ หรือ update หรือ input ก็แล้วแต่ แต่อันนี้จะอัตโนมัติไม่มีหน้าจอ ตรวจดูได้อีกทีก็ dashboard
3.เมื่องานสิ้นสุดสายพานก็จะมีพนักงานรับงานขึ้นรถไป และเข็นไปส่วนงานต่อไป แต่ก่อนไปถึงก็จะโดน reader อีกตัว scan ไม่รู้ว่าทำไม แต่ได้ยินมาว่าก่อนที่เขาจะเอางานไปเข็นเขาจะเอางานออกมานับ ng หรืออะไรอื่นๆก่อน จำนวนจะเปลี่ยนรึเปล่าไม่แน่ใจ ถ้าข้อมูลเปลี่ยนงานอาจจะหยาบและงง แต่คิดเผื่อไว้ก่อน
5.หลังจากนี้ไม่มี reader ให้สแกนอีกแล้วทีนี้ user ต้องการให้ถ้างาน wos ถูกกรอกเข้าไปใน as400 ก็คือเปลี่ยน process ถัดไป เขาต้องการให้ tag มันถูก clear เพื่อวนมาใช้ใหม่อัตโนมัติ ซึ่งอาจจะต้องตรวจสอบกับ as400 ว่าเลข lot งานตรงกันไหมกับ as400 ถ้า tag เลข lot ตรงกันกับ as400 จะ clear tag ถ้าไม่ตรงก็ยังไม่ clear ที่เขาไม่ติด reader เพิ่มเพราะกลัว human error
ต่อไปคำถามคือ
1.ซึ่งนี่ก็คือเกือบทั้งหมดแล้วมั้งใน process แต่ก็จะมีจุดที่ยังไม่มีคือ api ที่จะมี data อะไรบ้างที่เขาต้องการ
2.clear tag ยังไม่เข้าใจว่าทำยังไง อันนี้อยากให้คุณแนะนำ
3.งานนี้เดาว่าอนาคตมีต่อยอดแน่นอน อาจจะอยู่ในเว็บเดียวกันแต่เป้น process ใหม่
4.ออกแบบ database ยังไงดี

น่าจะหมดละครบละ เหลือแค่ภาพที่ผมจะให้คุณดู flow

Normal Flow ✅
Register

scan barcode → register lot สำเร็จ
scan tag → register tray สำเร็จ
scan tag ซ้ำ → ระบบแจ้ง duplicate

Pallet

วาง tag หน้า reader → PALLET_IN log เข้า
เอา tag ออก รอ cooldown → PALLET_OUT log เข้า
วาง tag กลับก่อน cooldown → ยกเลิก OUT

Washing

scan tag ครบทุก tray → LOT_WASHED → A3+A4 log เข้า
scan tag ไม่ครบ → OK ธรรมดา ไม่ส่ง AS400

On Machine

วาง tag ที่ตรง part_no → on_machine สำเร็จ
ครบทุก tray → LOT_ON_MACHINE

Completed

scan tag ทีละอัน → OK
scan ครบทุก tray → LOT_COMPLETED → A5 log เข้า


Human Error ⚠️
Register

scan barcode ที่ไม่มีใน job ticket
register lot เดิมซ้ำ
register tray มากกว่า tray_counter

Pallet

วาง tag ที่ยังไม่ register
วาง tag ที่ completed แล้ว
เปลี่ยน location ซ้ำๆ หลายครั้ง

Washing

scan tag ที่ยัง registered ยังไม่ผ่าน pallet
scan tag เดิมซ้ำก่อน cooldown หมด
scan tag ที่ after_washing แล้ว

On Machine

วาง tag ที่ part_no ไม่ตรง → alarm
วาง tag ที่ยังไม่ผ่าน washing → NOT_WASHED
วาง tag ที่ lot ยังไม่ครบทุก tray washing → LOT_NOT_READY
เอา tag ออกแล้วเอากลับเข้าใหม่

Completed

scan tag ที่ยังไม่ on_machine → NOT_ON_MACHINE → alarm
scan tag ที่ completed แล้ว
scan ผิด lot


Edge Cases 🔴

reader หลุดระหว่าง scan → reconnect แล้ว state เป็นยังไง
restart service ระหว่างที่มี tag อยู่หน้า reader
network Node.js ล่มระหว่าง Python กำลังส่ง
scan tag EPC ซ้ำกัน 2 อัน