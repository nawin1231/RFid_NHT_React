import axios from 'axios';
import API   from './constance';

// Backend Node.js
export const backendApi = axios.create({
    baseURL: API.BACKEND,
    headers: { 'Content-Type': 'application/json' },
});

// Python FastAPI
export const pythonApi = axios.create({
    baseURL: API.PYTHON,
});
    
// Washing API
export const washingApi = axios.create({
    baseURL: API.WASHING,
});

// Job Ticket API
export const jobTicketApi = axios.create({
    baseURL: API.JOBTICKET,
    headers: {
        Authorization: 'Bearer ',
    },
});

// Machine API
export const machineApi = axios.create({
    baseURL: API.MACHINE_NO,
    headers: {
        Authorization: 'Bearer ',
    },
});