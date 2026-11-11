import React, { useState, useEffect } from 'react';
import { backendApi } from '../../../config/instance';
import { useAuth } from '../../../config/auth';
import Swal from 'sweetalert2';

const DEFAULT_DAYS = 14;
const MIN_DAYS = 7;

const formatDate = (str) => {
    if (!str) return '-';
    const [date, time] = str.replace('T', ' ').slice(0, 16).split(' ');
    const [yyyy, mm, dd] = date.split('-');
    return `${dd}/${mm}/${yyyy} ${time}`;
};

// ล้างงาน waiting_register ที่ผูก tag ไม่ครบแล้วค้าง → tag กลับมาใช้ใหม่ได้
const WaitingRegisterTab = () => {
    const { user } = useAuth();
    const [days, setDays] = useState(DEFAULT_DAYS);
    const [lots, setLots] = useState([]);
    const [loading, setLoading] = useState(false);

    const fetchLots = async (d = days) => {
        setLoading(true);
        try {
            const res = await backendApi.get('/waiting-register', { params: { days: d } });
            setLots(res.data);
        } catch {
            Swal.fire('Error', 'โหลดข้อมูลไม่ได้', 'error');
        } finally {
            setLoading(false);
        }
    };

    // eslint-disable-next-line react-hooks/exhaustive-deps
    useEffect(() => { fetchLots(); }, []);

    const handleDays = (e) => setDays(Math.max(MIN_DAYS, parseInt(e.target.value, 10) || MIN_DAYS));

    const handleClear = async () => {
        if (lots.length === 0) return;
        const confirm = await Swal.fire({
            title: `ล้าง ${lots.length} งาน?`,
            html: `งานที่ค้าง waiting_register เกิน ${days} วัน<br/>จะถูกลบ และ tag กลับมาใช้ใหม่ได้<br/><b>ย้อนกลับไม่ได้</b>`,
            icon: 'warning',
            showCancelButton: true, confirmButtonText: 'ล้าง', cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#ef4444',
        });
        if (!confirm.isConfirmed) return;
        try {
            const res = await backendApi.post('/waiting-register/clear', { days, emp_id: user?.emp_id });
            if (res.data.result !== 'OK') throw new Error(res.data.result);
            Swal.fire({ icon: 'success', title: `ล้างแล้ว ${res.data.cleared} งาน`, showConfirmButton: false, timer: 1500 });
            fetchLots();
        } catch (err) {
            Swal.fire('Error', `ล้างไม่ได้: ${err.response?.data?.error || err.message}`, 'error');
        }
    };

    return (
        <div className="flex flex-col gap-4 h-full">

            {/* แถบควบคุม */}
            <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex flex-wrap items-center gap-3 shrink-0">
                <span className="text-sm text-gray-500">ค้าง waiting_register เกิน</span>
                <input
                    type="number"
                    min={MIN_DAYS}
                    value={days}
                    onChange={handleDays}
                    className="w-20 h-9 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                />
                <span className="text-sm text-gray-500">วัน</span>
                <button onClick={() => fetchLots()} disabled={loading}
                    className="h-9 px-4 text-sm bg-gray-100 hover:bg-gray-200 text-gray-600 rounded-lg disabled:opacity-50">
                    {loading ? '...' : 'ค้นหา'}
                </button>
                <div className="flex-1" />
                <button onClick={handleClear} disabled={lots.length === 0}
                    className="h-9 px-4 text-sm bg-red-500 hover:bg-red-600 text-white rounded-lg disabled:opacity-30">
                    ล้างทั้งหมด ({lots.length})
                </button>
            </div>

            {/* ตาราง */}
            <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">
                <div className="overflow-auto flex-1">
                    <table className="w-full">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                {['Job Ticket', 'Part No', 'Lot No', 'Qty', 'Tray', 'สร้างเมื่อ', 'ขยับล่าสุด', 'ค้าง (วัน)'].map(col => (
                                    <th key={col} className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 border-b border-gray-100">
                                        {col}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {lots.length === 0 && (
                                <tr>
                                    <td colSpan={8} className="text-center py-12 text-gray-300 text-sm">
                                        {loading ? 'กำลังโหลด...' : 'ไม่มีงานค้าง'}
                                    </td>
                                </tr>
                            )}
                            {lots.map(l => (
                                <tr key={l.barcode} className="border-b border-gray-50 hover:bg-gray-50">
                                    <td className="px-4 py-2.5 text-sm font-mono text-blue-600">{l.barcode}</td>
                                    <td className="px-4 py-2.5 text-xs font-mono text-gray-600">{l.part_no}</td>
                                    <td className="px-4 py-2.5 text-xs font-mono text-gray-600">{l.lot_no}</td>
                                    <td className="px-4 py-2.5 text-sm text-gray-700">{(l.quantity ?? 0).toLocaleString()}</td>
                                    <td className="px-4 py-2.5 text-xs text-gray-500">{l.tray_done}/{l.tray_counter}</td>
                                    <td className="px-4 py-2.5 text-xs text-gray-400">{formatDate(l.created_at)}</td>
                                    <td className="px-4 py-2.5 text-xs text-gray-400">{formatDate(l.updated_at)}</td>
                                    <td className="px-4 py-2.5 text-sm font-bold text-red-400">{l.idle_days}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

        </div>
    );
};

export default WaitingRegisterTab;
