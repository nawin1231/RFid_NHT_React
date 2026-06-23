import React, { useState, useEffect } from 'react';
import { backendApi } from '../../config/instance';

// สี sub_process
const PROCESS_COLOR = {
    registered:     'bg-gray-100 text-gray-600',
    before_washing: 'bg-blue-100 text-blue-700',
    after_washing:  'bg-cyan-100 text-cyan-700',
    on_machine:     'bg-purple-100 text-purple-700',
    completed:      'bg-green-100 text-green-700',
};

const PROCESS_LABEL = {
    registered:     'Registered',
    before_washing: 'Before Washing',
    after_washing:  'After Washing',
    on_machine:     'On Machine',
    completed:      'Completed',
};

// Summary card component
const SummaryCard = ({ label, value, color }) => (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
        <p className="text-xs text-gray-400 mb-1">{label}</p>
        <p className={`text-2xl font-semibold ${color}`}>{value ?? '—'}</p>
    </div>
);

const Dashboard = () => {
    const [summary, setSummary] = useState(null);
    const [lots, setLots]       = useState([]);
    const [filter, setFilter]   = useState('all');   // filter ตาม sub_process
    const [search, setSearch]   = useState('');      // ค้นหาตาม barcode

    // poll ทุก 5 วินาที
    useEffect(() => {
        const fetchDashboard = async () => {
            try {
                const res = await backendApi.get('/dashboard');
                setSummary(res.data.summary);
                setLots(res.data.lots);
            } catch { }
        };

        fetchDashboard();
        const interval = setInterval(fetchDashboard, 5000);
        return () => clearInterval(interval);
    }, []);

    // กรอง lots ตาม filter + search
    const filtered = lots.filter(l => {
        const matchProcess = filter === 'all' || l.sub_process === filter;
        const matchSearch  = !search || l.barcode.includes(search.toUpperCase()) || l.part_no?.includes(search);
        return matchProcess && matchSearch;
    });

    return (
        <div className="flex flex-col gap-4 h-full">

            {/* SUMMARY CARDS */}
            <div className="grid grid-cols-4 gap-3">
                <SummaryCard label="Ongoing Lots"     value={summary?.ongoing_lots}    color="text-blue-600" />
                <SummaryCard label="Completed Today"  value={summary?.completed_today} color="text-green-600" />
                <SummaryCard label="Total Trays"      value={summary?.total_trays}     color="text-gray-700" />
                <SummaryCard label="Trays Done"       value={summary?.total_trays_done}color="text-purple-600" />
            </div>

            {/* FILTER + SEARCH */}
            <div className="flex items-center gap-3">
                <input
                    type="text"
                    placeholder="ค้นหา barcode / part no..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="h-9 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 flex-1
                               focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                {['all', 'registered', 'before_washing', 'after_washing', 'on_machine', 'completed'].map(p => (
                    <button
                        key={p}
                        onClick={() => setFilter(p)}
                        className={`h-9 px-3 text-xs rounded-lg border transition-colors ${
                            filter === p
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                        }`}
                    >
                        {p === 'all' ? 'All' : PROCESS_LABEL[p]}
                    </button>
                ))}
            </div>

            {/* LOTS TABLE */}
            <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">
                <div className="overflow-y-auto flex-1">
                    <table className="w-full text-sm">
                        <thead className="sticky top-0 bg-gray-50 z-10">
                            <tr>
                                {['Barcode', 'Lot No.', 'Part No.', 'Location', 'Step', 'Tray Progress', 'Updated'].map(col => (
                                    <th key={col} className="text-left px-4 py-3 text-xs font-medium text-gray-400 border-b border-gray-100 whitespace-nowrap">
                                        {col}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={7} className="text-center py-12 text-gray-300 text-sm">
                                        ไม่มีข้อมูล
                                    </td>
                                </tr>
                            )}
                            {filtered.map((lot, i) => (
                                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{lot.barcode}</td>
                                    <td className="px-4 py-3 text-gray-600">{lot.lot_no}</td>
                                    <td className="px-4 py-3 text-gray-600">{lot.part_no}</td>
                                    <td className="px-4 py-3 text-gray-500">{lot.location || '—'}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs px-2 py-1 rounded-full ${PROCESS_COLOR[lot.sub_process]}`}>
                                            {PROCESS_LABEL[lot.sub_process]}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        {/* tray progress bar */}
                                        <div className="flex items-center gap-2">
                                            <div className="w-24 bg-gray-100 rounded-full h-1.5">
                                                <div
                                                    className="bg-blue-500 h-1.5 rounded-full"
                                                    style={{ width: `${(lot.tray_done / lot.tray_counter) * 100}%` }}
                                                />
                                            </div>
                                            <span className="text-xs text-gray-500 whitespace-nowrap">
                                                {lot.tray_done}/{lot.tray_counter}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                                        {new Date(lot.updated_at).toLocaleString('th-TH')}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>

                {/* footer แสดงจำนวน */}
                <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
                    แสดง {filtered.length} จาก {lots.length} lots
                </div>
            </div>

        </div>
    );
};

export default Dashboard;