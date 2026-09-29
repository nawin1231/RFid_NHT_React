import axios from 'axios';
import API from './constances';

// Backend Node.js
export const backendApi = axios.create({
    baseURL: API.BACKEND,
    headers: { 'Content-Type': 'application/json' },
});

// Python FastAPI
export const pythonApi = axios.create({
    baseURL: API.PYTHON,
});

// Washing API (main_dll)
export const washingApi = axios.create({
    baseURL: API.WASHING,
});

// โหลด location_ports จาก Node.js
let locationPorts = {};
export const loadLocationPorts = async () => {
    try {
        const res    = await backendApi.get('/location-ports');
        locationPorts = res.data;
    } catch {
        console.error('Failed to load location ports');
    }
};

// ทำ URL Parameter ใช้กับหน้า Register&MachineValidation
export const urlParameter = (location) => {
    const config = API.LOCATION_PORTS[location];
    if (!config) return null;
    return axios.create({ baseURL: `${API.PYTHON_BASE}:${config.port}` });
};

export const getLocationPorts = () => locationPorts;

// axios instance สำหรับคุยกับ reader ของ location นั้น ผ่าน READER PROXY ที่ backend
//
// เดิมทุกหน้าสร้าง instance ชี้ไป Python ตรงๆ ด้วย `${API.PYTHON_BASE}:${config.port}`
// ซึ่งบังคับให้ IT ต้องเปิด NAT เพิ่ม 1 port ต่อ 1 location (2003, 2004, ...)
// ตัวนี้ยิงผ่าน port 2002 ของ Node ที่เปิดอยู่แล้ว แล้วให้ Node ต่อไป Python
// ในเครื่องเดียวกันแทน → ไม่ต้องขอ port ใหม่อีกเลยไม่ว่าจะเพิ่ม reader หรือเพิ่มหน้า
//
// path ของ Python ใช้เหมือนเดิมทุกตัวอักษร เช่น deviceApi.get('/new-tag')
// เพราะ backend ต่อ path ที่เหลือส่งไปให้ Python ตรงๆ
export const readerApi = (location) =>
    axios.create({ baseURL: `${API.BACKEND}/reader/${encodeURIComponent(location)}` });