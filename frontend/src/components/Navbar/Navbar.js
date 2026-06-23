import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import axios from 'axios';
import { pythonApi } from '../../config/instance';


const pageTitles = {
  '/dashboard': 'Dashboard',
  '/register': 'Register — Scan Barcode & Tag',
  '/washing': 'Washing Tray In/Out',
  '/machine-validation': 'Machine Validation',
  '/history': 'History',
  '/export': 'Export Report',
};

const Navbar = () => {
  const { pathname } = useLocation();
  const title = pageTitles[pathname] || 'RFID System';

  const [connected, setConnected] = useState(false);
  const [currentTime, setCurrentTime] = useState(new Date());

  useEffect(() => {
    const check = async () => {
      try {
        //const res = await axios.get('http://localhost:8000/status');
        const res = await pythonApi.get('/status');
        setConnected(res.data.connected);
      } catch {
        setConnected(false);
      }
    };
    check();
    const interval = setInterval(check, 3000);
    return () => clearInterval(interval);
  }, []);
  
  // นาฬิกาใน Navbar อัปเดตทุกวินาที
  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTime(new Date());
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">

      <span className="text-sm font-medium text-gray-800">
        {title}
      </span>

      <div className="flex items-center gap-3 text-xs text-gray-400">

        <div className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-400'}`} />
          <span className={connected ? 'text-green-600' : 'text-red-400'}>
            {connected ? 'Connected' : 'Disconnected'}
          </span>
        </div>

        <span>•</span>
        <span>{new Date().toLocaleString('th-TH')}</span>

      </div>

    </div>
  );
};

export default Navbar;