// pm2 config ของ backend
// เริ่มครั้งแรก: pm2 start pm2.config.js  แล้ว  pm2 save
// ครั้งต่อไป:   pm2 list  /  pm2 restart 0  /  pm2 logs 0
module.exports = {
    apps: [{
        name: 'rfid',
        script: 'server.js',
        cwd: __dirname,                 // dotenv อ่าน .env จาก cwd → ต้องเป็นโฟลเดอร์ backend
        node_args: '--no-deprecation',  // ซ่อน DEP0123 (TLS ServerName เป็น IP) ตอนต่อ SQL Server
        // ห้ามเกิน 1 instance: retryErrors (as400.js) / cache / inflight อยู่ใน memory
        // ถ้ารันหลายตัว retry จะยิง AS400 ซ้ำ → AS400 นับซ้ำ
        instances: 1,
        exec_mode: 'fork',
        watch: false,                   // production ไม่ restart เองตอนไฟล์เปลี่ยน
        autorestart: true,
        restart_delay: 3000,
        time: true,                     // ใส่เวลาหน้าแต่ละบรรทัดใน log
    }],
};
