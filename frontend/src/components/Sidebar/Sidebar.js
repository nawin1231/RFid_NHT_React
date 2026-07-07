import React, { useState } from 'react';
import { NavLink } from 'react-router-dom';
import {
    DashboardOutlined,
    ScanOutlined,
    SettingOutlined,
    HistoryOutlined,
    // LogoutOutlined,
    MenuOutlined,
    ControlOutlined,
    ClearOutlined,
    ToolOutlined,
    WifiOutlined,
    SwapOutlined,
    ApiOutlined,
    SearchOutlined,
    AlertOutlined,
} from '@ant-design/icons';
// import { getOperator, removeOperator } from '../../config/auth';

const menuItems = [
    // { label: 'Dashboard', path: '/dashboard', icon: <DashboardOutlined /> },
    // { label: 'Register', path: '/register', icon: <ScanOutlined /> },
    { label: 'Multi Register', path: '/multi-register', icon: <ScanOutlined /> },
    { label: 'Machine Validation', path: '/machine-validation', icon: <SettingOutlined /> },
    { label: 'Tag Search', path: '/tag-search', icon: <SearchOutlined /> },
    { label: 'MBR Monitor', path: '/mbr-monitor', icon: <AlertOutlined /> },
    { label: 'Location URL', path: '/location-reader', icon: <ApiOutlined /> },
    { label: 'Reader Status', path: '/reader-status', icon: <WifiOutlined /> },
    { label: 'Reader Config', path: '/reader-config', icon: <SwapOutlined /> },
    { label: 'History', path: '/history', icon: <HistoryOutlined /> }
    // { label: 'Pallet', path: '/pallet', icon: <ControlOutlined /> },
    // { label: 'Washing', path: '/washing', icon: <ClearOutlined /> },
    // { label: 'On Machine', path: '/on-machine', icon: <ToolOutlined /> },
    
];

const Sidebar = () => {

    // const operator  = getOperator();
    const [open, setOpen] = useState(true);

    // const handleLogout = () => {
    //     removeOperator();
    //     window.location.reload();
    // };

    const linkClass = ({ isActive }) =>
        `flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-colors duration-150 ${isActive
            ? 'bg-blue-50 text-blue-700 font-medium'
            : 'text-gray-500 hover:bg-gray-100 hover:text-gray-700'
        }`;

    return (
        <div className={`${open ? 'w-48' : 'w-12'} min-w-0 bg-white border-r border-gray-200 flex flex-col transition-all duration-200`}>

            {/* Logo + ปุ่ม toggle */}
            <div className="px-3 py-2 border-b border-gray-200 flex items-center justify-between">
                {open && (
                    <div className="flex items-center gap-2">
                        <ControlOutlined style={{ fontSize: '20px', color: 'black' }} />
                        <span className="font-semibold text-sm text-gray-800">RFID System</span>
                    </div>
                )}
                <button
                    onClick={() => setOpen(!open)}
                    className="text-gray-400 hover:text-gray-600 p-1"
                >
                    <MenuOutlined />
                </button>
            </div>

            {/* เมนู */}
            <div className="flex-1 px-2 py-3">
                {open && (
                    <p className="text-[10px] text-gray-400 uppercase tracking-widest px-2 mb-1">
                        Main
                    </p>
                )}
                <nav className="flex flex-col gap-0.5">
                    {menuItems.map((item) => (
                        <NavLink key={item.path} to={item.path} className={linkClass}>
                            <span className="shrink-0">{item.icon}</span>
                            {open && <span>{item.label}</span>}
                        </NavLink>
                    ))}
                </nav>
            </div>

            {/* Operator info + Logout
            <div className="border-t border-gray-200 p-3 flex flex-col gap-2">
                {open && (
                    <div className="flex items-center gap-2 px-1">
                        <div className="w-7 h-7 rounded-full bg-blue-100 text-blue-700
                                        flex items-center justify-center text-xs font-semibold shrink-0">
                            {operator?.name?.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                            <p className="text-xs font-medium text-gray-800 truncate">
                                {operator?.name}
                            </p>
                            <p className="text-[10px] text-gray-400 truncate">
                                {operator?.emp_code}
                            </p>
                        </div>
                    </div>
                )} */}

            {/* <button
                    onClick={handleLogout}
                    className="flex items-center gap-2 px-3 py-2 rounded-lg text-sm
                               text-red-500 hover:bg-red-50 transition-colors w-full"
                >
                    <LogoutOutlined />
                    {open && <span>Logout</span>}
                </button> */}
            {/* </div> */}

        </div>
    );
};

export default Sidebar;