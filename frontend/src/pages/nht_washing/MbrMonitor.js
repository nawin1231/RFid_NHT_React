import React, { useState, useEffect, useRef } from 'react';
import { backendApi } from '../../config/instance';

const MbrMonitor = () => {
    const [readers, setReaders] = useState([]);
    const [machineList, setMachineList] = useState([]);
    const [loaded, setLoaded] = useState(false);
    const [view, setView] = useState('machine');
    const [search, setSearch] = useState('');
    const [filterMachine, setFilterMachine] = useState('');
    const [filterPart, setFilterPart] = useState('');
    const [expandedParts, setExpandedParts] = useState({});
    const prevReadersRef = useRef([]);

    // fetch machine list ทุก 30 นาที
    useEffect(() => {
        const fetchMachineList = async () => {
            try {
                const res = await backendApi.get('/machine-list');
                setMachineList(res.data || []);
            } catch { }
        };
        fetchMachineList();
        const interval = setInterval(fetchMachineList, 30 * 60 * 1000);
        return () => clearInterval(interval);
    }, []);

    // fetch status ทุก 5 วิ (เพิ่มความถี่เพื่อ alarm)
    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await backendApi.get('/status');
                const onMachine = (res.data.readers || []).filter(r =>
                    r.type === 'on_machine' && ((r.min_qty ?? 0) > 0 || r.alarm)
                );
                prevReadersRef.current = onMachine;
                setReaders(onMachine);
            } catch {
                setReaders(prevReadersRef.current);
            } finally {
                setLoaded(true);
            }
        };
        fetchData();
        const interval = setInterval(fetchData, 5 * 1000);
        return () => clearInterval(interval);
    }, []);

    // merge machine list เข้า readers
    const allReaders = readers.map(r => {
        const machineRow = machineList.find(m => m.machineNoProd === r.location);
        return {
            ...r,
            parts:         [machineRow?.innerRingPart].filter(Boolean),
            rps:           [machineRow?.rp].filter(Boolean),
            alarm:         r.alarm         ?? false,
            alarm_barcode: r.alarm_barcode ?? '',
            alarm_part:    r.alarm_part    ?? '',
        };
    });

    const alarmReaders = allReaders.filter(r => r.alarm);
    const lowReaders   = allReaders.filter(r => r.low_qty === true);
    const hasLow       = lowReaders.length > 0;
    const hasAlarm     = alarmReaders.length > 0;

    // filter options
    const machineOptions = [...new Set(lowReaders.map(r => r.location).filter(Boolean))].sort();
    const partOptions    = [...new Set(lowReaders.map(r => (r.parts || [])[0]).filter(Boolean))].sort();

    // filtered by machine
    const filteredByMachine = lowReaders.filter(r => {
        const s           = search.toLowerCase();
        const matchSearch = !s || r.location?.toLowerCase().includes(s) || (r.parts || [])[0]?.toLowerCase().includes(s);
        const matchMachine = !filterMachine || r.location === filterMachine;
        const matchPart    = !filterPart || (r.parts || [])[0] === filterPart;
        return matchSearch && matchMachine && matchPart;
    });

    // group by part
    const groupByPart = () => {
        const map = {};
        lowReaders.forEach(r => {
            const part = (r.parts || [])[0] || '—';
            const rp   = (r.rps   || [])[0] || '—';
            if (!map[part]) map[part] = { part, rp, machines: [], total_qty: 0, total_min: 0 };
            map[part].machines.push({ loc: r.location, qty: r.current_qty ?? 0 });
            map[part].total_qty += r.current_qty ?? 0;
            map[part].total_min += r.min_qty     ?? 0;
        });
        return Object.values(map);
    };

    const filteredByPart = groupByPart().filter(g => {
        const s            = search.toLowerCase();
        const matchSearch  = !s || g.part?.toLowerCase().includes(s) || g.machines.some(m => m.loc.toLowerCase().includes(s));
        const matchPart    = !filterPart    || g.part === filterPart;
        const matchMachine = !filterMachine || g.machines.some(m => m.loc === filterMachine);
        return matchSearch && matchPart && matchMachine;
    });

    const toggleExpand = (part) => setExpandedParts(prev => ({ ...prev, [part]: !prev[part] }));
    const clearFilters = () => { setSearch(''); setFilterMachine(''); setFilterPart(''); };
    const hasFilter    = search || filterMachine || filterPart;

    if (!loaded) return (
        <div className="flex items-center justify-center h-full min-h-[60vh]">
            <p className="text-gray-400 text-sm">Loading...</p>
        </div>
    );

    return (
        <div className="flex flex-col gap-3 h-full">

            {/* PART MISMATCH BANNER */}
            {hasAlarm && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2">
                        <span className="w-2.5 h-2.5 rounded-full bg-orange-500 animate-pulse block" />
                        <span className="text-sm font-semibold text-orange-700">⚠ PART MISMATCH DETECTED</span>
                    </div>
                    {alarmReaders.map((r, i) => (
                        <div key={i} className="flex items-center gap-3 bg-white border border-orange-100 rounded-lg px-3 py-2">
                            <span className="text-sm font-bold text-orange-700">{r.location}</span>
                            <span className="text-xs text-gray-300">|</span>
                            <span className="text-xs text-gray-600">Job: <b>{r.alarm_barcode || '-'}</b></span>
                            <span className="text-xs text-gray-300">|</span>
                            <span className="text-xs text-gray-600">Part: <b>{r.alarm_part || '-'}</b></span>
                            <span className="text-xs text-orange-500 ml-auto">ไม่ตรงกับ machine นี้</span>
                        </div>
                    ))}
                </div>
            )}

            {/* Status header */}
            <div className="flex flex-col items-center justify-center py-6 gap-2">
                <div className="flex items-center gap-2">
                    {hasLow ? (
                        <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse block" />
                    ) : (
                        <span className="w-2.5 h-2.5 rounded-full bg-green-500 block" />
                    )}
                    <span className={`text-xs font-medium px-3 py-1 rounded-full ${hasLow ? 'bg-red-50 text-red-600' : 'bg-green-50 text-green-600'}`}>
                        {hasLow
                            ? `${lowReaders.length} machine${lowReaders.length > 1 ? 's' : ''} need attention`
                            : 'All machines running normal'}
                    </span>
                </div>
                <p className={`text-5xl font-medium ${hasLow ? 'text-red-600' : 'text-gray-700'}`}>
                    {hasLow ? 'Parts running low' : 'Machine Running Normal'}
                </p>
            </div>

            {/* Toolbar */}
            <div className="flex items-center justify-between gap-3 flex-wrap">
                <div className="flex gap-2 items-center flex-wrap">
                    <input
                        type="text"
                        placeholder="Search..."
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300 w-44"
                    />
                    <select
                        value={filterMachine}
                        onChange={e => setFilterMachine(e.target.value)}
                        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300"
                    >
                        <option value="">All machines</option>
                        {machineOptions.map(m => <option key={m} value={m}>{m}</option>)}
                    </select>
                    <select
                        value={filterPart}
                        onChange={e => setFilterPart(e.target.value)}
                        className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300"
                    >
                        <option value="">All parts</option>
                        {partOptions.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    {hasFilter && (
                        <button onClick={clearFilters} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5">
                            Clear
                        </button>
                    )}
                </div>
                <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
                    <button
                        onClick={() => setView('machine')}
                        className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${view === 'machine' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}
                    >
                        By machine
                    </button>
                    <button
                        onClick={() => setView('part')}
                        className={`px-3 py-1 text-xs rounded-md font-medium transition-all ${view === 'part' ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-400'}`}
                    >
                        By part
                    </button>
                </div>
            </div>

            {/* Table */}
            <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">
                <div className="overflow-y-auto flex-1">

                    {/* By Machine */}
                    {view === 'machine' && (
                        <table className="w-full">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    {['', 'M/C', 'Part no.', 'RP', 'Current qty', 'Min qty', 'Status'].map(col => (
                                        <th key={col} className="text-left px-4 py-3 text-xs font-medium text-gray-400 border-b border-gray-100 whitespace-nowrap">{col}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {!hasLow ? (
                                    <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">No machines below minimum</td></tr>
                                ) : filteredByMachine.length === 0 ? (
                                    <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">No results</td></tr>
                                ) : filteredByMachine.map((r, i) => (
                                    <tr key={i} className="border-b border-gray-50 hover:bg-red-50 transition-colors">
                                        <td className="px-4 py-4">
                                            <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse block" />
                                        </td>
                                        <td className="px-4 py-4 text-2xl font-medium text-gray-800">{r.location}</td>
                                        <td className="px-4 py-4 text-sm text-gray-600">{(r.parts || [])[0] || '—'}</td>
                                        <td className="px-4 py-4">
                                            <span className="text-sm font-medium text-red-600 bg-red-50 px-2 py-1 rounded-full">
                                                {(r.rps || [])[0] || '—'}
                                            </span>
                                        </td>
                                        <td className="px-4 py-4">
                                            <span className="text-2xl font-medium text-red-600">{(r.current_qty ?? 0).toLocaleString()}</span>
                                            <span className="text-xs text-gray-400 ml-1">pcs</span>
                                        </td>
                                        <td className="px-4 py-4 text-sm text-gray-500">{(r.min_qty ?? 0).toLocaleString()} pcs</td>
                                        <td className="px-4 py-4">
                                            <span className="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-full font-medium whitespace-nowrap">
                                                ⚠ Add parts
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    )}

                    {/* By Part */}
                    {view === 'part' && (
                        <table className="w-full">
                            <thead className="bg-gray-50 sticky top-0">
                                <tr>
                                    {['', 'Part no.', 'RP', 'Machines', 'Total qty', 'Total min', 'Status'].map(col => (
                                        <th key={col} className="text-left px-4 py-3 text-xs font-medium text-gray-400 border-b border-gray-100 whitespace-nowrap">{col}</th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {!hasLow ? (
                                    <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">No machines below minimum</td></tr>
                                ) : filteredByPart.length === 0 ? (
                                    <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-gray-400">No results</td></tr>
                                ) : filteredByPart.map((g, i) => (
                                    <React.Fragment key={i}>
                                        <tr className="border-b border-gray-50 hover:bg-red-50 transition-colors">
                                            <td className="px-4 py-4">
                                                <span className="w-2.5 h-2.5 rounded-full bg-red-500 animate-pulse block" />
                                            </td>
                                            <td className="px-4 py-4 text-xl font-medium text-gray-800">{g.part}</td>
                                            <td className="px-4 py-4">
                                                <span className="text-sm font-medium text-red-600 bg-red-50 px-2 py-1 rounded-full">{g.rp}</span>
                                            </td>
                                            <td className="px-4 py-4">
                                                <button
                                                    onClick={() => toggleExpand(g.part)}
                                                    className="flex items-center gap-1.5 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded-lg transition-all"
                                                >
                                                    <span>{g.machines.length} machine{g.machines.length > 1 ? 's' : ''}</span>
                                                    <span className="text-gray-400 text-xs">{expandedParts[g.part] ? '▲' : '▼'}</span>
                                                </button>
                                            </td>
                                            <td className="px-4 py-4">
                                                <span className="text-2xl font-medium text-red-600">{g.total_qty.toLocaleString()}</span>
                                                <span className="text-xs text-gray-400 ml-1">pcs</span>
                                            </td>
                                            <td className="px-4 py-4 text-sm text-gray-500">{g.total_min.toLocaleString()} pcs</td>
                                            <td className="px-4 py-4">
                                                <span className="text-xs bg-red-50 text-red-600 px-3 py-1.5 rounded-full font-medium whitespace-nowrap">
                                                    ⚠ Add parts
                                                </span>
                                            </td>
                                        </tr>
                                        {expandedParts[g.part] && (
                                            <tr className="bg-gray-50/50">
                                                <td colSpan={7} className="px-8 py-3 border-b border-gray-100">
                                                    <div className="flex flex-wrap gap-2">
                                                        {g.machines.map((m, j) => (
                                                            <div key={j} className="flex items-center gap-2 bg-white border border-red-100 rounded-lg px-3 py-2">
                                                                <span className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                                                                <span className="text-sm font-medium text-gray-700">{m.loc}</span>
                                                                <span className="text-xs text-red-600 font-medium">{m.qty.toLocaleString()} pcs</span>
                                                            </div>
                                                        ))}
                                                    </div>
                                                </td>
                                            </tr>
                                        )}
                                    </React.Fragment>
                                ))}
                            </tbody>
                        </table>
                    )}

                </div>
            </div>
        </div>
    );
};

export default MbrMonitor;