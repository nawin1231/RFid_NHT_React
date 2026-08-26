import React, { useState, useEffect, useRef } from 'react';
import { backendApi } from '../../config/instance';
import * as XLSX from 'xlsx';

const STEPS = ['registered', 'before_washing', 'after_washing', 'on_machine'];

const STEP_LABEL = {
    registered: 'Registered',
    before_washing: 'Before Washing',
    after_washing: 'After Washing',
    on_machine: 'On Machine',
    completed: 'Completed',
};

const STEP_BADGE = {
    registered:     { bg: 'bg-blue-100',   text: 'text-blue-600' },
    before_washing: { bg: 'bg-amber-100',  text: 'text-amber-600' },
    after_washing:  { bg: 'bg-emerald-100',text: 'text-emerald-600' },
    on_machine:     { bg: 'bg-violet-100', text: 'text-violet-600' },
    completed:      { bg: 'bg-gray-100',   text: 'text-gray-500' },
};

const STEP_COLOR = {
    registered:     'text-blue-400',
    before_washing: 'text-amber-400',
    after_washing:  'text-emerald-400',
    on_machine:     'text-violet-400',
};

const toDateStr = (d) => d.toISOString().slice(0, 10);
const today = toDateStr(new Date());
const PAGE_SIZE = 20;

const defaultFilter = { barcode: '', part_no: '', sub_process: '', date_from: '', date_to: '' };

const StepBadge = ({ step }) => {
    const b = STEP_BADGE[step] || { bg: 'bg-gray-100', text: 'text-gray-500' };
    return (
        <span className={`text-xs px-2.5 py-1 rounded-full font-semibold ${b.bg} ${b.text}`}>
            {STEP_LABEL[step] || step}
        </span>
    );
};

const Dashboard = () => {
    const [lastRefresh, setLastRefresh] = useState(null);
    const [filter, setFilter] = useState(defaultFilter);
    const [summary, setSummary] = useState([]);
    const [lots, setLots] = useState([]);
    const [history, setHistory] = useState([]);
    const [tab, setTab] = useState('monitor');
    const [page, setPage] = useState(1);
    const [loading, setLoading] = useState(false);
    const intervalRef = useRef(null);

    const fetchMonitor = async () => {
        try {
            const res = await backendApi.get('/dashboard');
            setSummary(res.data.summary || []);
            setLots(res.data.lots || []);
            setLastRefresh(new Date());
        } catch (err) {
            console.error(err);
        }
    };

    const fetchHistory = async (f = filter) => {
        setLoading(true);
        try {
            const params = Object.fromEntries(Object.entries(f).filter(([, v]) => v !== ''));
            const res = await backendApi.get('/dashboard', { params: { date_from: f.date_from || today, date_to: f.date_to || today } });
            setHistory(res.data.history || []);
            setPage(1);
        } catch (err) {
            console.error(err);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchMonitor();
        fetchHistory();
        intervalRef.current = setInterval(fetchMonitor, 3 * 60 * 1000);
        return () => clearInterval(intervalRef.current);
    }, []);

    const handleChange = (e) => setFilter({ ...filter, [e.target.name]: e.target.value });
    const handleSearch = () => fetchHistory(filter);
    const handleReset = () => { setFilter(defaultFilter); fetchHistory(defaultFilter); };

    // filter history ฝั่ง frontend
    const filtered = history.filter(h => {
        if (filter.barcode && !(h.barcode || '').toLowerCase().includes(filter.barcode.toLowerCase())) return false;
        if (filter.part_no && !(h.part_no || '').toLowerCase().includes(filter.part_no.toLowerCase())) return false;
        if (filter.sub_process && h.sub_process !== filter.sub_process) return false;
        return true;
    });

    const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
    const pagedHistory = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

    const handleExport = () => {
        const rows = filtered.map(h => ({
            Barcode: h.barcode,
            'Sub Process': STEP_LABEL[h.sub_process] || h.sub_process,
            'Part No.': h.part_no,
            'Process Code': h.process_code,
            Process: h.process,
            Quantity: h.quantity,
            'Tray Counter': h.tray_counter,
            Location: h.location,
            Status: h.status,
            Date: (h.created_at || '').slice(0, 16),
        }));
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'Dashboard');
        XLSX.writeFile(wb, `dashboard_${today}.xlsx`);
    };

    const inputCls = "h-9 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400";

    // KPI: qty แยกตาม sub_process จาก summary
    const getQty = (step) => (summary.find(s => s.sub_process === step)?.total_qty ?? 0).toLocaleString();

    return (
        <div className="flex flex-col gap-3 h-full">

            {/* TABS */}
            <div className="flex items-center justify-between">
                <div className="flex gap-1">
                    {[
                        { key: 'monitor', label: 'Monitor' },
                        { key: 'history', label: 'History' },
                    ].map(t => (
                        <button
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            className={`px-4 py-1.5 text-sm rounded-lg font-medium transition-colors ${tab === t.key ? 'bg-gray-900 text-white' : 'text-gray-400 hover:text-gray-600'}`}
                        >
                            {t.label}
                        </button>
                    ))}
                </div>
                {lastRefresh && (
                    <p className="text-xs text-gray-400">Updated {lastRefresh.toLocaleTimeString('th-TH')}</p>
                )}
            </div>

            {/* MONITOR TAB */}
            {tab === 'monitor' && (
                <>
                    {/* KPI — dark bg */}
                    <div className="bg-gray-900 rounded-xl px-6 py-4 flex items-center gap-6 shrink-0">
                        {STEPS.map((step, i, arr) => (
                            <React.Fragment key={step}>
                                <div className="flex-1">
                                    <p className="text-xs font-semibold text-gray-400 tracking-widest uppercase">{STEP_LABEL[step]}</p>
                                    <p className={`text-4xl font-bold mt-1 ${STEP_COLOR[step]}`}>{getQty(step)}</p>
                                    <p className="text-xs text-gray-500 mt-1">Qty</p>
                                </div>
                                {i < arr.length - 1 && <div className="w-px h-10 bg-gray-700 shrink-0" />}
                            </React.Fragment>
                        ))}
                    </div>

                    {/* LOT TABLE */}
                    <div className="flex-1 bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden min-h-0">
                        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
                            <p className="text-sm font-semibold text-gray-600">
                                Active lots
                                <span className="ml-2 text-xs font-normal text-blue-500">{lots.length} records</span>
                            </p>
                        </div>
                        <div className="overflow-auto flex-1">
                            <table className="w-full">
                                <thead className="bg-gray-50 sticky top-0">
                                    <tr>
                                        {['No.', 'Job ticket', 'Sub Process', 'Part No.', 'Location', 'Quantity', 'Tray', 'Updated Date'].map(col => (
                                            <th key={col} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 border-b border-gray-100 whitespace-nowrap uppercase tracking-wider">
                                                {col}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {lots.length === 0 && (
                                        <tr><td colSpan={8} className="text-center py-12 text-gray-300 text-sm">No active lots</td></tr>
                                    )}
                                    {lots.map((l, i) => (
                                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                            <td className="px-4 py-2.5 text-xs text-gray-700">{i + 1}</td>
                                            <td className="px-4 py-2.5 text-xs font-semibold text-blue-600 font-mono">{l.barcode}</td>
                                            <td className="px-4 py-2.5"><StepBadge step={l.sub_process} /></td>
                                            <td className="px-4 py-2.5 text-xs font-semibold text-gray-700">{l.part_no}</td>
                                            <td className="px-4 py-2.5 text-xs font-semibold text-gray-700">{l.location}</td>
                                            <td className="px-4 py-2.5 text-sm font-bold text-gray-700">{(l.quantity ?? 0).toLocaleString()}</td>
                                            <td className="px-4 py-2.5 text-xs font-semibold text-gray-700">{l.tray_done}/{l.tray_counter}</td>
                                            <td className="px-4 py-2.5 text-xs font-semibold text-gray-700">{(l.updated_at || '').slice(0, 16)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </>
            )}

            {/* HISTORY TAB */}
            {tab === 'history' && (
                <>
                    {/* FILTER */}
                    <div className="bg-white border border-gray-200 rounded-xl px-4 py-3 shrink-0">
                        <div className="flex items-end gap-2 flex-wrap">
                            {[
                                { name: 'date_from', label: 'Date From', type: 'date' },
                                { name: 'date_to', label: 'Date To', type: 'date' },
                                { name: 'barcode', label: 'Job Ticket', type: 'text', placeholder: 'Job ticket' },
                                { name: 'part_no', label: 'Part No.', type: 'text', placeholder: 'Part No.' },
                            ].map(({ name, label, type, placeholder }) => (
                                <div key={name} className="flex flex-col gap-1 flex-1 min-w-0">
                                    <p className="text-xs text-gray-400 whitespace-nowrap">{label}</p>
                                    <input
                                        type={type} name={name}
                                        value={filter[name]}
                                        onChange={handleChange}
                                        onKeyDown={e => e.key === 'Enter' && handleSearch()}
                                        placeholder={placeholder || ''}
                                        className={inputCls + " w-full"}
                                    />
                                </div>
                            ))}
                            <div className="flex flex-col gap-1">
                                <p className="text-xs text-gray-400">Sub Process</p>
                                <select name="sub_process" value={filter.sub_process} onChange={handleChange} className={inputCls + " w-40"}>
                                    <option value="">All Sub Process</option>
                                    {Object.entries(STEP_LABEL).map(([k, v]) => (
                                        <option key={k} value={k}>{v}</option>
                                    ))}
                                </select>
                            </div>
                            <button onClick={handleSearch} disabled={loading}
                                className="h-9 px-5 text-sm bg-blue-500 hover:bg-blue-600 text-white rounded-lg disabled:opacity-50 transition-colors whitespace-nowrap shrink-0">
                                {loading ? '...' : 'Search'}
                            </button>
                            <button onClick={handleReset}
                                className="h-9 px-4 text-sm border border-gray-200 text-gray-500 hover:bg-gray-50 rounded-lg transition-colors shrink-0">
                                Reset
                            </button>
                        </div>
                    </div>

                    {/* TABLE */}
                    <div className="flex-1 bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden min-h-0">
                        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between shrink-0">
                            <p className="text-sm font-semibold text-gray-600">
                                History
                                <span className="ml-2 text-xs font-normal text-blue-500">{filtered.length} records</span>
                            </p>
                            <button onClick={handleExport}
                                className="h-8 px-4 text-xs bg-emerald-500 hover:bg-emerald-600 text-white rounded-lg transition-colors font-medium">
                                ↓ Export Excel
                            </button>
                        </div>
                        <div className="overflow-auto flex-1">
                            <table className="w-full">
                                <thead className="bg-gray-50 sticky top-0">
                                    <tr>
                                        {['No.', 'Job ticket', 'Step', 'Part No.', 'Process Code', 'Process', 'Quantity', 'Tray Counter', 'Location', 'Date'].map(col => (
                                            <th key={col} className="text-left px-4 py-2.5 text-xs font-semibold text-gray-400 border-b border-gray-100 whitespace-nowrap uppercase tracking-wider">
                                                {col}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pagedHistory.length === 0 && (
                                        <tr><td colSpan={10} className="text-center py-12 text-gray-300 text-sm">No records found</td></tr>
                                    )}
                                    {pagedHistory.map((h, i) => (
                                        <tr key={i} className="border-b border-gray-50 hover:bg-gray-50">
                                            <td className="px-4 py-2.5 text-xs text-gray-400">{(page - 1) * PAGE_SIZE + i + 1}</td>
                                            <td className="px-4 py-2.5 text-xs font-semibold text-blue-600 font-mono">{h.barcode}</td>
                                            <td className="px-4 py-2.5"><StepBadge step={h.sub_process} /></td>
                                            <td className="px-4 py-2.5 text-xs font-semibold text-gray-700">{h.part_no}</td>
                                            <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{h.process_code}</td>
                                            <td className="px-4 py-2.5 text-xs text-gray-500">{h.process}</td>
                                            <td className="px-4 py-2.5 text-sm font-bold text-gray-700">{(h.quantity ?? 0).toLocaleString()}</td>
                                            <td className="px-4 py-2.5 text-xs text-gray-500">{h.tray_counter}</td>
                                            <td className="px-4 py-2.5 text-xs font-mono text-gray-500">{h.location}</td>
                                            <td className="px-4 py-2.5 text-xs text-gray-400">{(h.created_at || '').slice(0, 16)}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>

                        {/* Pagination */}
                        {totalPages > 1 && (
                            <div className="px-4 py-2.5 border-t border-gray-100 flex items-center justify-between shrink-0">
                                <p className="text-xs text-gray-400">Page {page} of {totalPages}</p>
                                <div className="flex gap-1">
                                    <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
                                        className="h-7 px-3 text-xs border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 text-gray-500">‹</button>
                                    {Array.from({ length: totalPages }, (_, i) => i + 1)
                                        .filter(p => p === 1 || p === totalPages || Math.abs(p - page) <= 1)
                                        .map((p, i, arr) => (
                                            <React.Fragment key={p}>
                                                {i > 0 && arr[i - 1] !== p - 1 && (
                                                    <span className="h-7 px-2 text-xs flex items-center text-gray-300">...</span>
                                                )}
                                                <button onClick={() => setPage(p)}
                                                    className={`h-7 px-3 text-xs border rounded-lg transition-colors ${page === p ? 'bg-blue-500 text-white border-blue-500' : 'border-gray-200 hover:bg-gray-50 text-gray-500'}`}>
                                                    {p}
                                                </button>
                                            </React.Fragment>
                                        ))
                                    }
                                    <button onClick={() => setPage(p => Math.min(totalPages, p + 1))} disabled={page === totalPages}
                                        className="h-7 px-3 text-xs border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 text-gray-500">›</button>
                                </div>
                            </div>
                        )}
                    </div>
                </>
            )}
        </div>
    );
};

export default Dashboard;