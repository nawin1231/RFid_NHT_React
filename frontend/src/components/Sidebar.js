import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../config/auth';
import {
    AppstoreOutlined,
    ScanOutlined,
    ToolOutlined,
    HistoryOutlined,
    SettingOutlined,
    DashboardOutlined,
    SearchOutlined,
    EnvironmentOutlined,
    MenuFoldOutlined,
    MenuUnfoldOutlined,
    WifiOutlined,
    TagOutlined,
} from '@ant-design/icons';

const Sidebar = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const [hovered, setHovered] = useState(false);
    const { user } = useAuth();

    const collapsed = !hovered;

    const getSavedLocation = (type) => {
        return localStorage.getItem(`rfid_location_${type}`) || '';
    };

    const buildPath = (basePath, type) => {
        const loc = getSavedLocation(type);
        return loc ? `${basePath}?location=${loc}` : basePath;
    };

    const safeNavigate = (path) => {
        const basePath = path.split('?')[0];
        const current = sessionStorage.getItem('allowed_path') || '/location-reader';
        sessionStorage.setItem('prev_path', current);
        sessionStorage.setItem('allowed_path', basePath);
        navigate(path);
    };

    const navItems = [
        {
            label: 'Dashboard',
            icon: <DashboardOutlined />,
            path: '/dashboard',
        },
        {
            label: 'Location',
            icon: <TagOutlined />,
            path: '/location-reader',
        },
        {
            label: 'Multi Register',
            icon: <ScanOutlined />,
            path: '/multi-register',
            onClick: () => safeNavigate(buildPath('/multi-register', 'register')),
        },
        {
            label: 'Tag Search',
            icon: <SearchOutlined />,
            path: '/tag-search',
            onClick: () => safeNavigate(buildPath('/tag-search', 'register')),
        },
        {
            label: 'Machine Validation',
            icon: <ToolOutlined />,
            path: '/machine-validation',
            onClick: () => safeNavigate(buildPath('/machine-validation', 'washing')),
        },
        {
            label: 'MBR Monitor',
            icon: <AppstoreOutlined />,
            path: '/mbr-monitor',
        },
        {
            label: 'Management',
            icon: <SettingOutlined />,
            path: '/management',
        },
        ...(user ? [
            // {
            //     label: 'Reader Status',
            //     icon: <WifiOutlined />,
            //     path: '/reader-status',
            // },
            // {
            //     label: 'History',
            //     icon: <HistoryOutlined />,
            //     path: '/history',
            // },
        ] : []),
    ];

    const isActive = (path) => location.pathname === path;

    return (
        <div
            onMouseEnter={() => setHovered(true)}
            onMouseLeave={() => setHovered(false)}
            className={`${collapsed ? 'w-14' : 'w-52'} bg-white border-r border-gray-100 flex flex-col shrink-0 h-full transition-all duration-200`}
        >
            {/* Header */}
            <div className="p-3 border-b border-gray-100 flex items-center justify-center">
                {collapsed ? (
                    <span className="text-gray-400 text-base"><AppstoreOutlined /></span>
                ) : (
                    <div className="w-full">
                        <p className="text-sm font-semibold text-gray-800">RFID System</p>
                        <p className="text-xs text-gray-400">Washing</p>
                        {user && (
                            <div className="mt-2 pt-2 border-t border-gray-100">
                                <p className="text-xs font-medium text-gray-700 truncate">{user.eng_name}</p>
                                <p className="text-xs text-blue-400">{user.position}</p>
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Nav */}
            <nav className="flex-1 overflow-y-auto p-2">
                {navItems.map((item) => (
                    <button
                        key={item.path}
                        onClick={item.onClick || (() => safeNavigate(item.path))}
                        title={collapsed ? item.label : ''}
                        className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm transition-colors mb-1
                            ${collapsed ? 'justify-center' : ''}
                            ${isActive(item.path)
                                ? 'bg-blue-50 text-blue-600 font-medium'
                                : 'text-gray-600 hover:bg-gray-50'
                            }`}
                    >
                        <span className="text-base shrink-0">{item.icon}</span>
                        {!collapsed && item.label}
                    </button>
                ))}
            </nav>


        </div>
    );
};

export default Sidebar;