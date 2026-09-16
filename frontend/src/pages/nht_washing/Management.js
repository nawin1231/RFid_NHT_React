import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../config/auth';
import UserTab from './Management/UserTab';
import MasterTray from './Management/MasterTrayTab';
import MasterProcess from './Management/MasterProcessTab';
import ReaderConfig from './ReaderConfig';
import LoginModal from '../../components/LoginModal';

const TABS = [
    { key: 'reader', label: 'Reader Config' },
    { key: 'user', label: 'Users' },
    { key: 'master-tray', label: 'Master Tray' },
    { key: 'master-process', label: 'Master Process' },
];

const Management = () => {
    const navigate = useNavigate();
    const { user, logout } = useAuth();
    const [activeTab, setActiveTab] = useState('reader');

    if (!user) {
        return (
            <LoginModal
                onSuccess={() => {}}
                onCancel={() => navigate('/')}
            />
        );
    }

    return (
        <div className="flex flex-col h-full">

            {/* Tabs */}
            <div className="flex gap-1 border-b border-gray-200 mb-6 shrink-0 px-4 pt-4">
                {TABS.map(tab => (
                    <button
                        key={tab.key}
                        onClick={() => setActiveTab(tab.key)}
                        className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors
                            ${activeTab === tab.key
                                ? 'border-blue-500 text-blue-600'
                                : 'border-transparent text-gray-500 hover:text-gray-700'
                            }`}
                    >
                        {tab.label}
                    </button>
                ))}
            </div>

            {/* Content */}
            <div className="flex-1 min-h-0 px-4 pb-4">
                {activeTab === 'user' && <UserTab />}
                {activeTab === 'master-tray' && <MasterTray />}
                {activeTab === 'reader' && <ReaderConfig />}
                {activeTab === 'master-process' && <MasterProcess />}
            </div>

        </div>
    );
};

export default Management;