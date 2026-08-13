import React, { useState, useEffect } from 'react';
import { backendApi } from '../../config/instance';

const MbrMonitor = () => {
    const [readers, setReaders] = useState([]);

    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await backendApi.get('/status');
                const onMachine = (res.data.readers || []).filter(r =>
                    r.type === 'on_machine' &&
                    r.low_qty === true &&
                    (r.min_qty ?? 0) > 0
                );
                setReaders(onMachine);
            } catch { }
        };
        fetchData();
        const interval = setInterval(fetchData, 1000);
        return () => clearInterval(interval);
    }, []);

    // ถ้าไม่มีเครื่องไหน low → แสดง normal
    if (readers.length === 0) {
        return (
            <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-6">
                <div className="flex flex-col items-center justify-center h-full min-h-[60vh] gap-12">
                    <div className="flex gap-6 h-28 items-end">
                        <span className="w-20 h-20 rounded-full bg-green-500 animate-wave-bounce shrink-0" />
                        <span
                            className="w-20 h-20 rounded-full bg-green-500 animate-wave-bounce shrink-0"
                            style={{ animationDelay: '0.15s' }}
                        />
                        <span
                            className="w-20 h-20 rounded-full bg-green-500 animate-wave-bounce shrink-0"
                            style={{ animationDelay: '0.3s' }}
                        />
                    </div>
                    <p className="text-8xl font-medium text-gray-700">Machine Running Normal</p>
                </div>
            </div>
        );
    }

    return (
        <div className="flex flex-col gap-3">

            <p className="text-xs text-gray-400">
                Showing {readers.length} machine{readers.length > 1 ? 's' : ''} below minimum quantity
            </p>

            {readers.map((r, i) => (
                <div
                    key={i}
                    className="bg-white border border-red-200 rounded-xl p-5 flex items-center gap-4"
                >
                    {/* dot กระพริบ */}
                    <span className="w-3 h-3 rounded-full bg-red-500 animate-pulse shrink-0" />

                    {/* machine info */}
                    <div className="flex-1">
                        <p className="text-2xl font-medium text-gray-700">{r.location}</p>
                        <p className="text-xs text-gray-400">{r.ip}</p>
                    </div>

                    {/* qty info */}
                    <div className="text-right">
                        <p className="text-xl font-semibold text-red-600">
                            {(r.current_qty ?? 0).toLocaleString()} pcs
                        </p>
                        <p className="text-xs text-gray-400">
                            min: {(r.min_qty ?? 0).toLocaleString()} pcs
                        </p>
                    </div>

                    {/* badge */}
                    <div className="bg-red-50 text-red-600 text-xs px-3 py-2 rounded-lg whitespace-nowrap">
                        Please add parts
                    </div>

                </div>
            ))}

        </div>
    );
};

export default MbrMonitor;