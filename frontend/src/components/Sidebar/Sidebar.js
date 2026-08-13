import React, { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../../config/auth';
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
    const [collapsed, setCollapsed] = useState(false);
    const { user, logout } = useAuth();

    const handleLogout = () => {
        logout();
        navigate('/');
    };

    const getSavedLocation = (type) => {
        return localStorage.getItem(`rfid_location_${type}`) || '';
    };

    const buildPath = (basePath, type) => {
        const loc = getSavedLocation(type);
        return loc ? `${basePath}?location=${loc}` : basePath;
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
            onClick: () => navigate(buildPath('/multi-register', 'register')),
        },
        {
            label: 'Tag Search',
            icon: <SearchOutlined />,
            path: '/tag-search',
            onClick: () => navigate(buildPath('/tag-search', 'register')),
        },
        {
            label: 'Machine Validation',
            icon: <ToolOutlined />,
            path: '/machine-validation',
            onClick: () => navigate(buildPath('/machine-validation', 'washing')),
        },
        {
            label: 'MBR Monitor',
            icon: <AppstoreOutlined />,
            path: '/mbr-monitor',
        },
        {
            label: 'Reader Config',
            icon: <SettingOutlined />,
            path: '/reader-config',
        },
        ...(user ? [
            // {
            //     label: 'Reader Status',
            //     icon: <WifiOutlined />,
            //     path: '/reader-status',
            // },
            {
                label: 'History',
                icon: <HistoryOutlined />,
                path: '/history',
            },
        ] : []),
    ];

    const isActive = (path) => location.pathname === path;

    return (
        <div className={`${collapsed ? 'w-14' : 'w-52'} bg-white border-r border-gray-100 flex flex-col shrink-0 h-full transition-all duration-200`}>

            {/* Header */}
            <div className="p-3 border-b border-gray-100 flex items-center justify-between">
                {!collapsed && (
                    <div>
                        <p className="text-sm font-semibold text-gray-800">RFID System</p>
                        <p className="text-xs text-gray-400">Washing</p>
                    </div>
                )}
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className="text-gray-400 hover:text-gray-600 p-1 rounded"
                >
                    {collapsed ? <MenuUnfoldOutlined /> : <MenuFoldOutlined />}
                </button>
            </div>

            {/* Nav */}
            <nav className="flex-1 overflow-y-auto p-2">
                {navItems.map((item) => (
                    <button
                        key={item.path}
                        onClick={item.onClick || (() => navigate(item.path))}
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
            {user && !collapsed && (
                <div className="p-3 border-t border-gray-100">
                    <p className="text-xs text-gray-500 truncate">{user.eng_name}</p>
                    <button
                        onClick={handleLogout}
                        className="text-xs text-red-400 hover:text-red-600 mt-1"
                    >
                        Sign out
                    </button>
                </div>
            )}
        </div >
    );
};

export default Sidebar;