import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { getLocationPorts, backendApi } from '../../config/instance';
import InfoPopover from '../../components/InfoPopover';

const Location = () => {
    const navigate = useNavigate();
    const [search, setSearch] = useState('');
    const [locations, setLocations] = useState({});

    const safeNavigate = (path) => {
        sessionStorage.setItem('allowed_path', path.split('?')[0]);
        navigate(path);
    };

    useEffect(() => {
        backendApi.get('/location-ports').then(res => setLocations(res.data));
    }, []);

    // ดึงจาก locations state แทน
    const registers = Object.entries(locations).filter(([loc, config]) =>
        config.type === 'register' &&
        loc.toLowerCase().includes(search.toLowerCase())
    );

    const washings = Object.entries(locations).filter(([loc, config]) =>
        config.type === 'washing' &&
        loc.toLowerCase().includes(search.toLowerCase())
    );

    return (
        <div className="flex flex-col gap-6">

            {/* SEARCH */}
            <input
                type="text"
                placeholder="Search location..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="h-9 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 w-64
                           focus:outline-none focus:ring-1 focus:ring-blue-400"
            />

            <div className="grid grid-cols-2 gap-6">

                {/* REGISTER */}
                <div className="bg-white border border-gray-100 rounded-xl overflow-hidden overflow-y-auto">
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                        <p className="text-xs font-medium text-gray-500">Multi Register/Tag Search</p>
                    </div>
                    <div className="overflow-y-auto max-h-96">
                        <table className="w-full text-sm">
                            <tbody>
                                {registers.length === 0 && (
                                    <tr>
                                        <td className="px-4 py-6 text-center text-gray-300 text-xs">
                                            No location found
                                        </td>
                                    </tr>
                                )}
                                {registers.map(([location, config]) => (
                                    <tr
                                        key={location}
                                        className="border-b border-gray-50 hover:bg-blue-50 transition-colors cursor-pointer"
                                        onClick={() => safeNavigate(`/multi-register?location=${location}`)}
                                    >
                                        <td className="px-4 py-3 font-medium text-gray-700">
                                            {location}
                                        </td>
                                        <td className="px-4 py-3 text-right text-blue-500 text-xs">
                                            Open →
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

                {/* MACHINE VALIDATION */}
                <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                    <div className="px-4 py-3 border-b border-gray-100 bg-gray-50">
                        <p className="text-xs font-medium text-gray-500">Machine Validation</p>
                    </div>
                    <div className="overflow-y-auto max-h-96">
                        <table className="w-full text-sm">
                            <tbody>
                                {washings.length === 0 && (
                                    <tr>
                                        <td className="px-4 py-6 text-center text-gray-300 text-xs">
                                            No location found
                                        </td>
                                    </tr>
                                )}
                                {washings.map(([location, config]) => (
                                    <tr
                                        key={location}
                                        className="border-b border-gray-50 hover:bg-blue-50 transition-colors cursor-pointer"
                                        onClick={() => safeNavigate(`/machine-validation?location=${location}`)}
                                    >
                                        <td className="px-4 py-3 font-medium text-gray-700">
                                            {location}
                                        </td>
                                        <td className="px-4 py-3 text-right text-blue-500 text-xs">
                                            Open →
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>

            </div>

        </div>
    );
};

export default Location;