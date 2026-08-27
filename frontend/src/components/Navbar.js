import React, { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import Swal from 'sweetalert2';
import PageGuild from '../config/PageGuild';
import { useAuth } from '../config/auth';

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
    const navigate = useNavigate();
    const { user, logout } = useAuth();
    const title = pageTitles[pathname] || 'RFID System';
    const [currentTime, setCurrentTime] = useState(new Date());

    const handleLogout = () => {
        logout();
        navigate('/');
    };

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

            <div className="flex items-center gap-4">
                <span className="text-xs text-gray-400">
                    Date: {currentTime.toLocaleDateString('th-TH')} | Time: {currentTime.toLocaleTimeString('th-TH')}
                </span>
                {user && (
                    <div className="flex items-center gap-3 border-l border-gray-200 pl-4">
                        <button
                            onClick={handleLogout}
                            className="text-base text-red-400 hover:text-red-600 hover:bg-red-50 px-2 py-1 rounded transition-colors"
                        >
                            Sign out
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};

export default Navbar;