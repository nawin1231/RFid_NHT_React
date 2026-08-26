import React, { useState, useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import Swal from 'sweetalert2';
import PageGuild from '../config/PageGuild';

const pageTitles = {
    '/dashboard': 'Dashboard',
    '/multi-register': 'Multi Register',
    '/machine-validation': 'Machine Validation',
    '/history': 'History',
    '/reader-status': 'Reader Status',
    '/reader-config': 'Reader Config',
    '/mbr-monitor': 'MBR Monitor',
    '/tag-search': 'Tag Search',
    '/location-reader': 'Location',
};

const Navbar = () => {
    const { pathname } = useLocation();
    const title = pageTitles[pathname] || 'RFID System';
    const [currentTime, setCurrentTime] = useState(new Date());

    useEffect(() => {
        const timer = setInterval(() => setCurrentTime(new Date()), 1000);
        return () => clearInterval(timer);
    }, []);

    const showGuide = () => {
        Swal.fire({
            ...PageGuild[pathname],
            width: 1300,
            confirmButtonText: 'รับทราบ',
        });
    };

    return (
        <div className="h-12 bg-white border-b border-gray-200 flex items-center justify-between px-4 shrink-0">

            {/* title + ปุ่มคู่มืออยู่ด้วยกัน */}
            <div className="flex items-center gap-2">
                <span className="text-sm font-medium text-gray-800">{title}</span>
                {PageGuild[pathname] && (
                    <button
                        onClick={showGuide}
                        className="text-blue-500 hover:text-blue-500 text-xs flex items-center gap-1 px-2 py-1 rounded hover:bg-blue-50 transition-colors"
                    >
                        <span className="text-sm">ⓘ</span> คู่มือ
                    </button>
                )}
            </div>

            <span className="text-xs text-gray-400">
                Date: {currentTime.toLocaleDateString('th-TH')} | Time: {currentTime.toLocaleTimeString('th-TH')}
            </span>
        </div>
    );
};

export default Navbar;