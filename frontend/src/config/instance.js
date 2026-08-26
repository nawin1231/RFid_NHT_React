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