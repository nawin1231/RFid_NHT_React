import React, { useState, useEffect, useCallback } from 'react';
import { backendApi } from '../../config/instance';

// ---- CONSTANTS ----

const STEPS = ['registered', 'before_washing', 'after_washing', 'on_machine', 'completed'];

const STEP_LABEL = {
    registered: 'Registered',
    before_washing: 'Before washing',
    after_washing: 'After washing',
    on_machine: 'On machine',
    completed: 'Completed',
};

// สีแต่ละ step ใช้ทั้ง bar chart และ progress bar
const STEP_COLOR = {
    registered: '#2a78d6',
    before_washing: '#eda100',
    after_washing: '#1baf7a',
    on_machine: '#4a3aa7',
    completed: '#008300',
};

// ---- HELPER ----

// แปลง date object เป็น YYYY-MM-DD สำหรับ input date
const toDateStr = (d) => d.toISOString().slice(0, 10);

const today = toDateStr(new Date());

// ---- SUB COMPONENTS ----

// KPI card แสดงตัวเลข summary
const KpiCard = ({ label, value, sub }) => (
    <div style={{
        background: 'var(--surface-1)', border: '0.5px solid var(--border)',
        borderRadius: 'var(--radius)', padding: '10px 12px',
    }}>
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>{label}</div>
        <div style={{ fontSize: 22, fontWeight: 500, color: 'var(--text-primary)' }}>{value}</div>
        <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 2 }}>{sub}</div>
    </div>
);

// Badge แสดง sub_process ด้วยสี
const StepBadge = ({ step }) => {
    const bg = {
        registered: '#e6f1fb', before_washing: '#faeeda',
        after_washing: '#e1f5ee', on_machine: '#eeedfe', completed: '#eaf3de',
    };
    const color = {
        registered: '#0c447c', before_washing: '#633806',
        after_washing: '#085041', on_machine: '#26215c', completed: '#173404',
    };
    return (
        <span style={{
            fontSize: 10, fontWeight: 500, padding: '2px 8px', borderRadius: 99,
            background: bg[step] || '#f0f0f0', color: color[step] || '#333',
        }}>
            {STEP_LABEL[step] || step}
        </span>
    );
};

// Progress bar แสดง tray_done / tray_counter
const TrayProgress = ({ done, total, step }) => {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
                flex: 1, height: 5, background: 'var(--border)',
                borderRadius: 99, overflow: 'hidden',
            }}>
                <div style={{
                    width: `${pct}%`, height: '100%',
                    background: STEP_COLOR[step] || '#888',
                    borderRadius: 99, transition: 'width .4s',
                }} />
            </div>
            <span style={{ fontSize: 11, color: 'var(--text-secondary)', minWidth: 50, textAlign: 'right' }}>
                {done}/{total} tray
            </span>
        </div>
    );
};

// ---- MONITOR TAB ----
const MonitorTab = ({ lots, summary }) => {
    // คำนวณ KPI จาก lots ที่ได้จาก SP
    const trayDone = lots.reduce((a, l) => a + (l.tray_done || 0), 0);
    const trayTotal = lots.reduce((a, l) => a + (l.tray_counter || 0), 0);
    const countBy = (step) => lots.filter(l => l.sub_process === step).length;

    // นับ lot แต่ละ step จาก summary recordset
    const maxCount = Math.max(...(summary || []).map(s => s.lot_count), 1);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* KPI Row */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 8 }}>
                <KpiCard label="Active lots" value={lots.length} sub="Ongoing" />
                <KpiCard label="Tray done" value={trayDone} sub={`of ${trayTotal} total`} />
                <KpiCard label="After washing" value={countBy('after_washing')} sub="Ready" />
                <KpiCard label="On machine" value={countBy('on_machine')} sub="Active" />
                <KpiCard label="Before washing" value={countBy('before_washing')} sub="Waiting" />
            </div>

            {/* Charts */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>

                {/* Lots by step */}
                <div style={{ background: 'var(--surface-1)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                        Lots by step
                    </div>
                    {STEPS.map(s => {
                        const row = (summary || []).find(r => r.sub_process === s);
                        const count = row?.lot_count || 0;
                        return (
                            <div key={s} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <span style={{ fontSize: 11, color: 'var(--text-secondary)', width: 90, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {STEP_LABEL[s]}
                                </span>
                                <div style={{ flex: 1, height: 7, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                                    <div style={{ width: `${Math.round(count / maxCount * 100)}%`, height: '100%', background: STEP_COLOR[s], borderRadius: 99 }} />
                                </div>
                                <span style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-primary)', width: 20, textAlign: 'right' }}>{count}</span>
                            </div>
                        );
                    })}
                </div>

                {/* Tray progress by lot */}
                <div style={{ background: 'var(--surface-1)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', padding: 12 }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 10 }}>
                        Tray progress by lot
                    </div>
                    {lots.map((l, i) => {
                        const pct = l.tray_counter > 0 ? Math.round((l.tray_done / l.tray_counter) * 100) : 0;
                        return (
                            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                <span style={{ fontSize: 10, color: 'var(--text-secondary)', width: 90, fontFamily: 'var(--font-mono)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                    {l.barcode}
                                </span>
                                <div style={{ flex: 1, height: 7, background: 'var(--border)', borderRadius: 99, overflow: 'hidden' }}>
                                    <div style={{ width: `${pct}%`, height: '100%', background: STEP_COLOR[l.sub_process], borderRadius: 99, transition: 'width .4s' }} />
                                </div>
                                <span style={{ fontSize: 10, fontWeight: 500, color: 'var(--text-primary)', width: 32, textAlign: 'right' }}>
                                    {l.tray_done}/{l.tray_counter}
                                </span>
                            </div>
                        );
                    })}
                    {lots.length === 0 && <div style={{ textAlign: 'center', padding: 24, fontSize: 12, color: 'var(--text-muted)' }}>No active lots</div>}
                </div>
            </div>

            {/* Lot list */}
            <div style={{ fontSize: 11, fontWeight: 500, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Active lots
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {lots.map((l, i) => (
                    <div key={i} style={{
                        background: 'var(--surface-2)', border: '0.5px solid var(--border)',
                        borderRadius: 'var(--radius)', padding: '10px 14px',
                        display: 'grid', gridTemplateColumns: '1fr auto', gap: 8, alignItems: 'center',
                    }}>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', fontFamily: 'var(--font-mono)' }}>
                                    {l.barcode}
                                </span>
                                <StepBadge step={l.sub_process} />
                                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{l.part_no}</span>
                            </div>
                            <TrayProgress done={l.tray_done} total={l.tray_counter} step={l.sub_process} />
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', fontFamily: 'var(--font-mono)' }}>
                                {l.location}{l.machine_no ? ` · ${l.machine_no}` : ''}
                            </span>
                            <span style={{ fontSize: 10, color: 'var(--text-secondary)' }}>
                                {l.process_code} · {l.process}
                            </span>
                        </div>
                    </div>
                ))}
                {lots.length === 0 && (
                    <div style={{ textAlign: 'center', padding: 32, fontSize: 12, color: 'var(--text-muted)' }}>
                        No active lots
                    </div>
                )}
            </div>
        </div>
    );
};

// ---- HISTORY TAB ----
const HistoryTab = ({ history }) => {
    const [dateFrom, setDateFrom] = useState(today);
    const [dateTo, setDateTo] = useState(today);
    const [subFilter, setSubFilter] = useState('');
    const [partFilter, setPartFilter] = useState('');
    const [search, setSearch] = useState('');

    // parts ที่มีใน history สำหรับ dropdown
    const parts = [...new Set(history.map(h => h.part_no))].filter(Boolean);

    // filter history ฝั่ง frontend
    const filtered = history.filter(h => {
        const d = (h.created_at || '').slice(0, 10);
        if (dateFrom && d < dateFrom) return false;
        if (dateTo && d > dateTo) return false;
        if (subFilter && h.sub_process !== subFilter) return false;
        if (partFilter && h.part_no !== partFilter) return false;
        if (search && !(h.barcode || '').toLowerCase().includes(search.toLowerCase())) return false;
        return true;
    });

    const inputStyle = {
        height: 32, fontSize: 12, padding: '0 10px',
        border: '0.5px solid var(--border)', borderRadius: 'var(--radius)',
        background: 'var(--surface-2)', color: 'var(--text-primary)', outline: 'none',
    };

    const thStyle = {
        textAlign: 'left', padding: '8px 10px', fontSize: 11,
        fontWeight: 500, color: 'var(--text-muted)',
        borderBottom: '0.5px solid var(--border)', whiteSpace: 'nowrap',
    };

    const tdStyle = { padding: '8px 10px', borderBottom: '0.5px solid var(--border)', fontSize: 12, color: 'var(--text-primary)' };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>

            {/* Filter row */}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                <input type="date" value={dateFrom} onChange={e => setDateFrom(e.target.value)} style={inputStyle} />
                <input type="date" value={dateTo} onChange={e => setDateTo(e.target.value)} style={inputStyle} />
                <select value={subFilter} onChange={e => setSubFilter(e.target.value)} style={inputStyle}>
                    <option value="">All steps</option>
                    {STEPS.map(s => <option key={s} value={s}>{STEP_LABEL[s]}</option>)}
                </select>
                <select value={partFilter} onChange={e => setPartFilter(e.target.value)} style={inputStyle}>
                    <option value="">All parts</option>
                    {parts.map(p => <option key={p} value={p}>{p}</option>)}
                </select>
                <input
                    type="text" placeholder="Search barcode..."
                    value={search} onChange={e => setSearch(e.target.value)}
                    style={{ ...inputStyle, width: 160 }}
                />
                <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{filtered.length} records</span>
            </div>

            {/* Table */}
            <div style={{ background: 'var(--surface-2)', border: '0.5px solid var(--border)', borderRadius: 'var(--radius)', overflow: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                    <thead style={{ background: 'var(--surface-1)' }}>
                        <tr>
                            {['Barcode', 'Step', 'Part no', 'Process code', 'Process', 'Tray', 'Location', 'Operator', 'Date'].map(col => (
                                <th key={col} style={thStyle}>{col}</th>
                            ))}
                        </tr>
                    </thead>
                    <tbody>
                        {filtered.length === 0 && (
                            <tr><td colSpan={9} style={{ textAlign: 'center', padding: 32, fontSize: 12, color: 'var(--text-muted)' }}>No records found</td></tr>
                        )}
                        {filtered.map((h, i) => (
                            <tr key={i}>
                                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{h.barcode}</td>
                                <td style={tdStyle}><StepBadge step={h.sub_process} /></td>
                                <td style={tdStyle}>{h.part_no}</td>
                                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{h.process_code}</td>
                                <td style={{ ...tdStyle, fontSize: 11 }}>{h.process}</td>
                                <td style={tdStyle}>{h.tray_done}/{h.tray_counter}</td>
                                <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{h.location}</td>
                                <td style={tdStyle}>{h.operator || '—'}</td>
                                <td style={{ ...tdStyle, fontSize: 11, color: 'var(--text-muted)' }}>{(h.created_at || '').slice(0, 16)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};

// ---- MAIN COMPONENT ----
const Dashboard = () => {
    const [tab, setTab] = useState('monitor'); // tab ที่เปิดอยู่
    const [lots, setLots] = useState([]);         // lot Ongoing สำหรับ monitor
    const [summary, setSummary] = useState([]);         // summary แยก sub_process
    const [history, setHistory] = useState([]);         // log history
    const [loading, setLoading] = useState(true);

    // ดึงข้อมูล monitor (poll ทุก 5 วิ)
    const fetchMonitor = useCallback(async () => {
        try {
            const res = await backendApi.get('/dashboard');
            setSummary(Array.isArray(res.data.summary) ? res.data.summary : []);
            setLots(res.data.lots || []);
        } catch { }
        setLoading(false);
    }, []);

    // ดึง history แยกต่างหาก เรียกครั้งแรกและเมื่อ user เปลี่ยน tab มา history
    const fetchHistory = useCallback(async () => {
        try {
            const res = await backendApi.get('/dashboard', {
                params: { date_from: today, date_to: today }
            });
            setHistory(res.data.history || []);
        } catch { }
    }, []);

    useEffect(() => {
        fetchMonitor();
        fetchHistory();
        // poll monitor ทุก 5 วิ
        const interval = setInterval(fetchMonitor, 5000);
        return () => clearInterval(interval);
    }, [fetchMonitor, fetchHistory]);

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, height: '100%' }}>

            {/* Header: tabs + live indicator */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <div style={{ display: 'flex', borderBottom: '0.5px solid var(--border)' }}>
                    {[
                        { key: 'monitor', label: 'Monitor', count: lots.length },
                        { key: 'history', label: 'History', count: history.length },
                    ].map(t => (
                        <div
                            key={t.key}
                            onClick={() => setTab(t.key)}
                            style={{
                                fontSize: 12, padding: '8px 16px', cursor: 'pointer',
                                color: tab === t.key ? 'var(--text-primary)' : 'var(--text-muted)',
                                borderBottom: tab === t.key ? '2px solid var(--text-primary)' : '2px solid transparent',
                                fontWeight: tab === t.key ? 500 : 400,
                                display: 'flex', alignItems: 'center', gap: 6, marginBottom: -1,
                            }}
                        >
                            {t.label}
                            <span style={{
                                fontSize: 10, padding: '1px 6px', borderRadius: 99,
                                background: tab === t.key ? 'var(--text-primary)' : 'var(--surface-1)',
                                color: tab === t.key ? 'var(--surface-2)' : 'var(--text-secondary)',
                                border: '0.5px solid var(--border)',
                            }}>
                                {t.count}
                            </span>
                        </div>
                    ))}
                </div>

                {/* Live pill — แสดงว่ากำลัง poll อยู่ */}
                <span style={{
                    display: 'inline-flex', alignItems: 'center', gap: 5,
                    fontSize: 10, color: 'var(--text-success)',
                    background: 'var(--bg-success)', borderRadius: 99, padding: '2px 8px',
                }}>
                    <span style={{
                        display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                        background: 'var(--text-success)',
                        animation: 'pulse 2s infinite',
                    }} />
                    live · 5s
                </span>
            </div>

            {/* CSS animation สำหรับ live pulse */}
            <style>{`@keyframes pulse{0%,100%{opacity:1}50%{opacity:.3}}`}</style>

            {/* Content */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: 48, fontSize: 12, color: 'var(--text-muted)' }}>Loading...</div>
            ) : (
                <>
                    {tab === 'monitor' && <MonitorTab lots={lots} summary={summary} />}
                    {tab === 'history' && <HistoryTab history={history} />}
                </>
            )}
        </div>
    );
};

export default Dashboard;