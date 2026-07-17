import React, { useState, useEffect } from 'react';
import { backendApi, pythonApi } from '../../config/instance';

const Washing = () => {

    const [logs, setLogs] = useState([]);
    const [countdown, setCountdown] = useState(60);

    // Fetch logs จาก DB
    const fetchLogs = async () => {
        try {
            const res = await backendApi.get('/washing-log');
            setLogs(res.data);
        } catch (err) {
            //console.log('error:', err.message);
        }
    };

    // โหลดตอนเข้าหน้า
    useEffect(() => {
        fetchLogs();
    }, []);

    useEffect(() => {
        const interval = setInterval(async () => {
            try {
                const res = await pythonApi.get('/new-tag/washing');
                if (res.data.tag_id) {
                    await handleWashing(res.data.tag_id);
                }
            } catch { }
        }, 500);
        return () => clearInterval(interval);
    }, []);

    // Auto refresh ทุก 60 วินาที
    useEffect(() => {
        const tick = setInterval(() => {
            setCountdown(prev => {
                if (prev <= 1) {
                    fetchLogs();
                    return 60;
                }
                return prev - 1;
            });
        }, 1000);
        return () => clearInterval(tick);
    }, []);

    // Washing
    const handleWashing = async (tagId) => {
        try {
            const res = await backendApi.post('/washing', { tag_id: tagId });
            const result = res.data.result;

            if (result === 'OK') {
                await fetchLogs();
            } else if (result === 'PALLET_REQUIRED') {
                //console.log('washing skip: pallet required', tagId);
            } else {
                //console.log('washing skip:', tagId, result);
            }

        } catch (err) {
            //console.log('error:', err.message);
        }
    };

    return (
        <div className="flex flex-col gap-4 h-full">

            {/* Header */}
            <div className="flex items-center gap-2">
                <p className="text-sm font-medium text-gray-700">Washing</p>
                <span className="ml-auto text-xs text-red-400">
                    Auto refresh in {countdown}s
                </span>
            </div>

            {/* Table */}
            <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">

                <div className="overflow-y-auto flex-1">
                    <table className="w-full text-xs">

                        <thead className="sticky top-0 bg-gray-50 z-10">
                            <tr>
                                {['Tag ID', 'Barcode', 'Lot No.', 'Part No.', 'Tray', 'QTY/TRY', 'Sub Process', 'Time'].map(col => (
                                    <th key={col} className="text-left px-3 py-2 text-[10px] font-medium text-gray-400 border-b border-gray-100 whitespace-nowrap">
                                        {col}
                                    </th>
                                ))}
                            </tr>
                        </thead>

                        <tbody>
                            {logs.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="text-center py-10 text-gray-300">
                                        Waiting for tag...
                                    </td>
                                </tr>
                            )}
                            {logs.map((log, i) => (
                                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                                    <td className="px-3 py-2 font-mono text-blue-600">{log.tag_id || '—'}</td>
                                    <td className="px-3 py-2 font-mono text-gray-600">{log.barcode || '—'}</td>
                                    <td className="px-3 py-2 text-gray-500">{log.lot_no || '—'}</td>
                                    <td className="px-3 py-2 text-gray-700">{log.part_no || '—'}</td>
                                    <td className="px-3 py-2 text-gray-500">{log.tray_no}/{log.tray_counter || '—'}</td>
                                    <td className="px-3 py-2 text-gray-500">{log.tray_qty?.toLocaleString() || '—'}</td>
                                    <td className="px-3 py-2">
                                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${log.sub_process === 'after_washing'
                                            ? 'bg-blue-50 text-blue-600'
                                            : 'bg-green-50 text-green-600'
                                            }`}>
                                            {log.sub_process === 'after_washing' ? 'After Washing' : 'Completed'}
                                        </span>
                                    </td>
                                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                                        {new Date(log.created_at).toLocaleTimeString('en-GB')}
                                    </td>
                                </tr>

                            ))}
                        </tbody>

                    </table>
                </div>

            </div>

        </div>
    );
};

export default Washing;