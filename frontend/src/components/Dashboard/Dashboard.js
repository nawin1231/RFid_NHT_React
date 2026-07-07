import React, { useState, useEffect } from 'react';
import { backendApi } from '../../config/instance';
import ReactECharts from 'echarts-for-react';

// ── Constants ─────────────────────────────────────────────────────────
const PROCESS_COLOR = {
    registered:     { bg: 'bg-gray-100',   text: 'text-gray-600',   hex: '#9CA3AF' },
    before_washing: { bg: 'bg-blue-100',   text: 'text-blue-700',   hex: '#3B82F6' },
    after_washing:  { bg: 'bg-cyan-100',   text: 'text-cyan-700',   hex: '#06B6D4' },
    on_machine:     { bg: 'bg-purple-100', text: 'text-purple-700', hex: '#8B5CF6' },
    completed:      { bg: 'bg-green-100',  text: 'text-green-700',  hex: '#10B981' },
};

const PROCESS_LABEL = {
    registered:     'Registered',
    before_washing: 'Before Washing',
    after_washing:  'After Washing',
    on_machine:     'On Machine',
    completed:      'Completed',
};

const TABS = ['Overview', 'Live Tracking', 'Machine', 'Report'];

// ── Sub Components ────────────────────────────────────────────────────
const SummaryCard = ({ label, value, color, sub }) => (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
        <p className="text-xs text-gray-400 mb-2">{label}</p>
        <p className={`text-3xl font-semibold ${color}`}>{value ?? '—'}</p>
        {sub && <p className="text-xs text-gray-400 mt-1">{sub}</p>}
    </div>
);

// ── Tab 1: Overview ───────────────────────────────────────────────────
const TabOverview = ({ summary, lots, throughput }) => {

    const chartOption = {
        tooltip: { trigger: 'axis' },
        legend: {
            data: ['Pallet', 'Washing', 'On Machine', 'Completed'],
            bottom: 0,
            textStyle: { fontSize: 11 },
        },
        grid: { top: 20, right: 20, bottom: 40, left: 40 },
        xAxis: {
            type: 'category',
            data: Array.from({ length: 24 }, (_, i) => `${i}:00`),
            axisLabel: { fontSize: 10 },
        },
        yAxis: {
            type: 'value',
            minInterval: 1,
            axisLabel: { fontSize: 10 },
        },
        series: [
            {
                name: 'Pallet',     type: 'bar', stack: 'total', color: '#3B82F6',
                data: Array.from({ length: 24 }, (_, i) => (throughput || []).find(t => t.hour === i)?.pallet_count ?? 0),
            },
            {
                name: 'Washing',    type: 'bar', stack: 'total', color: '#06B6D4',
                data: Array.from({ length: 24 }, (_, i) => (throughput || []).find(t => t.hour === i)?.washing_count ?? 0),
            },
            {
                name: 'On Machine', type: 'bar', stack: 'total', color: '#8B5CF6',
                data: Array.from({ length: 24 }, (_, i) => (throughput || []).find(t => t.hour === i)?.on_machine_count ?? 0),
            },
            {
                name: 'Completed',  type: 'bar', stack: 'total', color: '#10B981',
                data: Array.from({ length: 24 }, (_, i) => (throughput || []).find(t => t.hour === i)?.completed_count ?? 0),
            },
        ],
    };

    const donutData = Object.keys(PROCESS_LABEL).map(key => ({
        name:      PROCESS_LABEL[key],
        value:     lots.filter(l => l.sub_process === key).length,
        itemStyle: { color: PROCESS_COLOR[key].hex },
    })).filter(d => d.value > 0);

    const donutOption = {
        tooltip: { trigger: 'item', formatter: '{b}: {c} lots ({d}%)' },
        legend: { bottom: 0, textStyle: { fontSize: 11 } },
        series: [{
            type: 'pie', radius: ['50%', '75%'], center: ['50%', '45%'],
            data: donutData, label: { show: false },
        }],
    };

    return (
        <div className="flex flex-col gap-4">

            {/* Summary Cards */}
            <div className="grid grid-cols-4 gap-3">
                <SummaryCard label="Ongoing Lots"    value={summary?.ongoing_lots}       color="text-blue-600"   sub="Lots currently in process" />
                <SummaryCard label="Completed Today" value={summary?.completed_today}    color="text-green-600"  sub="Lots completed today" />
                <SummaryCard label="Total Trays"     value={summary?.total_trays_ongoing}color="text-gray-700"   sub="Trays in ongoing lots" />
                <SummaryCard label="Trays Done"      value={`${summary?.total_trays_done ?? 0} / ${summary?.total_trays_ongoing ?? 0}`} color="text-purple-600" sub="Trays completed" />
            </div>

            {/* Charts */}
            <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2 bg-white border border-gray-100 rounded-xl p-4">
                    <p className="text-xs font-medium text-gray-500 mb-3">Throughput Today (per hour)</p>
                    <ReactECharts option={chartOption} style={{ height: 200 }} />
                </div>
                <div className="bg-white border border-gray-100 rounded-xl p-4">
                    <p className="text-xs font-medium text-gray-500 mb-3">Process Distribution</p>
                    {donutData.length > 0
                        ? <ReactECharts option={donutOption} style={{ height: 200 }} />
                        : <div className="flex items-center justify-center h-48 text-gray-300 text-sm">No data</div>
                    }
                </div>
            </div>

        </div>
    );
};

// ── Tab 2: Live Tracking ──────────────────────────────────────────────
const TabLiveTracking = ({ lots }) => {
    const [filter, setFilter] = useState('all');
    const [search, setSearch] = useState('');

    const filtered = lots.filter(l => {
        const matchProcess = filter === 'all' || l.sub_process === filter;
        const matchSearch  = !search
            || l.barcode?.includes(search.toUpperCase())
            || l.part_no?.includes(search)
            || l.lot_no?.includes(search);
        return matchProcess && matchSearch;
    });

    return (
        <div className="flex flex-col gap-4">

            {/* Filter + Search */}
            <div className="flex items-center gap-2 flex-wrap">
                <input
                    type="text"
                    placeholder="Search barcode / lot no / part no..."
                    value={search}
                    onChange={e => setSearch(e.target.value)}
                    className="h-9 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 w-64
                               focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                {['all', ...Object.keys(PROCESS_LABEL)].map(p => (
                    <button
                        key={p}
                        onClick={() => setFilter(p)}
                        className={`h-9 px-3 text-xs rounded-lg border transition-colors whitespace-nowrap ${
                            filter === p
                                ? 'bg-blue-600 text-white border-blue-600'
                                : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                        }`}
                    >
                        {p === 'all' ? `All (${lots.length})` : `${PROCESS_LABEL[p]} (${lots.filter(l => l.sub_process === p).length})`}
                    </button>
                ))}
            </div>

            {/* Table */}
            <div className="bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50">
                            <tr>
                                {['Barcode', 'Lot No.', 'Part No.', 'Location', 'Step', 'Tray Progress', 'Tray Detail', 'Updated'].map(col => (
                                    <th key={col} className="text-left px-4 py-3 text-xs font-medium text-gray-400 border-b border-gray-100 whitespace-nowrap">
                                        {col}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {filtered.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="text-center py-12 text-gray-300 text-sm">No data</td>
                                </tr>
                            )}
                            {filtered.map((lot, i) => (
                                <tr key={i} className="border-b border-gray-50 hover:bg-gray-50 transition-colors">
                                    <td className="px-4 py-3 font-mono text-xs text-gray-700">{lot.barcode}</td>
                                    <td className="px-4 py-3 text-gray-600 text-xs">{lot.lot_no}</td>
                                    <td className="px-4 py-3 text-gray-600 text-xs">{lot.part_no}</td>
                                    <td className="px-4 py-3 text-gray-500 text-xs">{lot.location || '—'}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs px-2 py-1 rounded-full ${PROCESS_COLOR[lot.sub_process]?.bg} ${PROCESS_COLOR[lot.sub_process]?.text}`}>
                                            {PROCESS_LABEL[lot.sub_process]}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex items-center gap-2">
                                            <div className="w-20 bg-gray-100 rounded-full h-1.5">
                                                <div
                                                    className="bg-blue-500 h-1.5 rounded-full"
                                                    style={{ width: `${lot.tray_counter > 0 ? (lot.tray_done / lot.tray_counter) * 100 : 0}%` }}
                                                />
                                            </div>
                                            <span className="text-xs text-gray-500 whitespace-nowrap">
                                                {lot.tray_done}/{lot.tray_counter}
                                            </span>
                                        </div>
                                    </td>
                                    <td className="px-4 py-3">
                                        <div className="flex gap-1">
                                            {[
                                                { key: 'tray_registered',     color: 'bg-gray-300',   label: 'R' },
                                                { key: 'tray_before_washing', color: 'bg-blue-300',   label: 'B' },
                                                { key: 'tray_after_washing',  color: 'bg-cyan-300',   label: 'A' },
                                                { key: 'tray_on_machine',     color: 'bg-purple-300', label: 'M' },
                                                { key: 'tray_completed',      color: 'bg-green-300',  label: 'C' },
                                            ].map(({ key, color, label }) => lot[key] > 0 && (
                                                <span key={key} className={`text-[10px] ${color} text-white px-1 rounded`} title={label}>
                                                    {lot[key]}
                                                </span>
                                            ))}
                                        </div>
                                    </td>
                                    <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">
                                        {new Date(lot.updated_at).toLocaleString('en-GB')}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="px-4 py-2 border-t border-gray-100 text-xs text-gray-400">
                    Showing {filtered.length} of {lots.length} lots
                </div>
            </div>

        </div>
    );
};

// ── Tab 3: Machine ────────────────────────────────────────────────────
const TabMachine = () => {
    const [readers, setReaders] = useState([]);

    useEffect(() => {
        const fetch = async () => {
            try {
                const res = await backendApi.get('/status');
                // แสดงเฉพาะ on_machine reader
                setReaders((res.data.readers || []).filter(r => r.type === 'on_machine'));
            } catch { }
        };
        fetch();
        const interval = setInterval(fetch, 3000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="flex flex-col gap-4">
            <div className="grid grid-cols-3 gap-3">
                {readers.length === 0 && (
                    <div className="col-span-3 text-center py-12 text-gray-300 text-sm">
                        No on_machine readers found
                    </div>
                )}
                {readers.map((r, i) => (
                    <div
                        key={i}
                        className={`bg-white border rounded-xl p-5 flex flex-col gap-3
                            ${r.connected ? 'border-green-200' : 'border-red-200'}`}
                    >
                        <div className="flex items-center justify-between">
                            <p className="text-sm font-medium text-gray-700">{r.location || `MBR ${i + 1}`}</p>
                            <span className={`w-3 h-3 rounded-full ${r.connected ? 'bg-green-500' : 'bg-red-400'}`} />
                        </div>
                        <p className="text-xs text-gray-400">{r.ip}</p>
                        <span className={`text-xs px-2 py-1 rounded-full text-center
                            ${r.connected ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                            {r.connected ? 'Connected' : 'Disconnected'}
                        </span>
                    </div>
                ))}
            </div>
        </div>
    );
};

// ── Tab 4: Report ─────────────────────────────────────────────────────
const TabReport = () => {
    return (
        <div className="flex items-center justify-center py-24 text-gray-300 text-sm">
            Coming soon...
        </div>
    );
};

// ── Main Dashboard ────────────────────────────────────────────────────
const Dashboard = () => {
    const [activeTab, setActiveTab] = useState(0);
    const [summary, setSummary]     = useState(null);
    const [lots, setLots]           = useState([]);
    const [throughput, setThroughput] = useState([]);
    const [lastUpdate, setLastUpdate] = useState(null);

    // poll ทุก 5 วินาที
    useEffect(() => {
        const fetchData = async () => {
            try {
                const res = await backendApi.get('/dashboard');
                setSummary(res.data.summary);
                setLots(res.data.lots       || []);
                setThroughput(res.data.throughput || []);
                setLastUpdate(new Date());
            } catch { }
        };
        fetchData();
        const interval = setInterval(fetchData, 5000);
        return () => clearInterval(interval);
    }, []);

    return (
        <div className="flex flex-col gap-4 h-full">

            {/* TABS + last update */}
            <div className="flex items-center justify-between">
                <div className="flex gap-1">
                    {TABS.map((tab, i) => (
                        <button
                            key={i}
                            onClick={() => setActiveTab(i)}
                            className={`h-9 px-4 text-xs rounded-lg border transition-colors ${
                                activeTab === i
                                    ? 'bg-blue-600 text-white border-blue-600'
                                    : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>
                <p className="text-xs text-gray-400">
                    {lastUpdate ? `Last updated: ${lastUpdate.toLocaleTimeString('en-GB')}` : 'Loading...'}
                </p>
            </div>

            {/* TAB CONTENT */}
            <div className="flex-1 overflow-y-auto">
                {activeTab === 0 && <TabOverview summary={summary} lots={lots} throughput={throughput} />}
                {activeTab === 1 && <TabLiveTracking lots={lots} />}
                {activeTab === 2 && <TabMachine />}
                {activeTab === 3 && <TabReport />}
            </div>

        </div>
    );
};

export default Dashboard;