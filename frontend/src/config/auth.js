// // sessionStorage หายเมื่อปิด browser ต้อง login ใหม่ทุกครั้ง

// // เก็บข้อมูล operator หลัง login สำเร็จ
// export const saveOperator = (data) => {
//     const payload = {
//         ...data,expiredAt: Date.now() + (8 * 60 * 60 * 1000) // 8 ชั่วโมง
//     };
//     sessionStorage.setItem('operator', JSON.stringify(payload));
// };

// // ดึงข้อมูล operator ปัจจุบัน
// export const getOperator = () => {
//     const data = sessionStorage.getItem('operator');
//     return data ? JSON.parse(data) : null;
// };

// // ลบข้อมูล operator ตอน logout
// export const removeOperator = () => {
//     sessionStorage.removeItem('operator');
// };

// // เช็คว่า login อยู่ไหม
// export const isLoggedIn = () => {
//     const data = getOperator();
//     if (!data) return false;

//     // ถ้าเลยเวลาที่กำหนด → ลบทิ้ง
//     if (Date.now() > data.expiredAt) {
//         removeOperator();
//         return false;
//     }

//     return true;
    
// };