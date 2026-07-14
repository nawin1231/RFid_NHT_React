import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';

const pageTitles = {
    '/dashboard': 'Dashboard',
    '/multi-register': 'Multi Register',
    '/machine-validation': 'Machine Validation',
    '/history': 'History',
    '/reader-status': 'Reader Status',
    '/reader-config': 'Reader Config',
    '/mbr-monitor': 'MBR Monitor',
    '/tag-search': 'Tag Search',
    '/location': 'Location',
};

const Navbar = () => {
    const { pathname } = useLocation();
    const title = pageTitles[pathname] || 'RFID System';
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => {
            setCurrentTime(new Date());
        }, 1000);
        return () => clearInterval(timer);
    }, []);

    return (
        <div className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">
            <span className="text-sm font-medium text-gray-800">{title}</span>
            <span className="text-xs text-gray-400">
                Date: {currentTime.toLocaleDateString('th-TH')} | Time: {currentTime.toLocaleTimeString('th-TH')}
            </span>
        </div>
    );
};

export default Navbar;