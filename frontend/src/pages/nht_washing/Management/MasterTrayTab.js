import React, { useState, useEffect } from 'react';
import { backendApi } from '../../../config/instance';
import Swal from 'sweetalert2';
import * as XLSX from 'xlsx';

const defaultForm = { part_no: '', pcs_stc: '', stc_try: '' };

const MasterTrayTab = () => {
    const [trays, setTrays] = useState([]);
    const [form, setForm] = useState(defaultForm);
    const [editPartNo, setEditPartNo] = useState(null);

    const fetchTrays = async () => {
        try {
            const res = await backendApi.get('/master-tray');
            setTrays(res.data);
        } catch {
            Swal.fire('Error', 'โหลดข้อมูลไม่ได้', 'error');
        }
    };

    useEffect(() => { fetchTrays(); }, []);

    const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    const handleSubmit = async () => {
        if (!form.part_no || !form.pcs_stc || !form.stc_try) {
            return Swal.fire({ icon: 'warning', title: 'กรอกข้อมูลให้ครบ', showConfirmButton: false, timer: 1500 });
        }
        try {
            await backendApi.post('/master-tray', {
                part_no: form.part_no,
                pcs_stc: Number(form.pcs_stc),
                stc_try: Number(form.stc_try),
            });
            setForm(defaultForm);
            setEditPartNo(null);
            fetchTrays();
            Swal.fire({ icon: 'success', title: editPartNo ? 'แก้ไขแล้ว' : 'เพิ่มแล้ว', showConfirmButton: false, timer: 1500 });
        } catch {
            Swal.fire('Error', 'บันทึกไม่ได้', 'error');
        }
    };

    const handleEdit = (t) => {
        setEditPartNo(t.part_no);
        setForm({ part_no: t.part_no, pcs_stc: t.pcs_stc, stc_try: t.stc_try });
    };

    const handleDelete = async (id) => {
        const confirm = await Swal.fire({
            title: 'ลบ part นี้?', icon: 'warning',
            showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#ef4444',
        });
        if (!confirm.isConfirmed) return;
        try {
            await backendApi.delete(`/master-tray/${id}`);
            fetchTrays();
        } catch {
            Swal.fire('Error', 'ลบไม่ได้', 'error');
        }
    };

    const handleCancel = () => { setForm(defaultForm); setEditPartNo(null); };

    const handleImport = (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = async (evt) => {
            try {
                const wb = XLSX.read(evt.target.result, { type: 'binary' });
                const ws = wb.Sheets[wb.SheetNames[0]];
                const rows = XLSX.utils.sheet_to_json(ws);

                // map เฉพาะ field ที่ต้องการ
                const data = rows.map(r => ({
                    part_no: String(r.part_no || '').trim(),
                    pcs_stc: Number(r.pcs_stc),
                    stc_try: Number(r.stc_try),
                })).filter(r => r.part_no && r.pcs_stc && r.stc_try);

                if (data.length === 0) {
                    return Swal.fire({ icon: 'warning', title: 'ไม่พบข้อมูลใน Excel', showConfirmButton: false, timer: 1500 });
                }

                const res = await backendApi.post('/master-tray/import', { data });
                fetchTrays();
                Swal.fire({ icon: 'success', title: `Import สำเร็จ ${res.data.count} records`, showConfirmButton: false, timer: 2000 });
            } catch {
                Swal.fire('Error', 'Import ไม่ได้', 'error');
            }
            e.target.value = ''; // reset input
        };
        reader.readAsBinaryString(file);
    };

    return (
        <div className="flex gap-4 h-full">

            {/* ซ้าย — form */}
            <div className="w-80 shrink-0">
                <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-col gap-3">
                    <p className="text-xs text-gray-400 uppercase tracking-wider">
                        {editPartNo ? 'Edit Part' : 'Add Part'}
                    </p>
                    <input
                        name="part_no"
                        value={form.part_no}
                        onChange={handleChange}
                        disabled={!!editPartNo}
                        placeholder="Part No."
                        className="w-full h-10 px-3 text-sm font-mono border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-40"
                    />
                    <input
                        name="pcs_stc"
                        value={form.pcs_stc}
                        onChange={handleChange}
                        type="number"
                        placeholder="Pcs/Stc"
                        className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <input
                        name="stc_try"
                        value={form.stc_try}
                        onChange={handleChange}
                        type="number"
                        placeholder="Stc/Tray"
                        className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    {/* preview pcs_try */}
                    {form.pcs_stc && form.stc_try && (
                        <div className="bg-blue-50 rounded-lg px-3 py-2">
                            <p className="text-xs text-blue-500">
                                Pcs/Tray = {Number(form.pcs_stc) * Number(form.stc_try)}
                            </p>
                        </div>
                    )}
                    <div className="flex gap-2 pt-1">
                        <button onClick={handleSubmit}
                            className="flex-1 h-9 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors">
                            {editPartNo ? 'บันทึก' : 'เพิ่ม'}
                        </button>
                        {editPartNo && (
                            <button onClick={handleCancel}
                                className="flex-1 h-9 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm rounded-lg transition-colors">
                                ยกเลิก
                            </button>
                        )}
                    </div>
                </div>
            </div>

            {/* ขวา — table */}
            <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-500">Master Tray</p>
                    <div className="flex items-center gap-3">
                        <span className="text-xs text-gray-400">{trays.length} records</span>
                        <label className="h-8 px-3 text-xs rounded-lg border border-blue-200 text-blue-500 hover:bg-blue-50 cursor-pointer flex items-center">
                            Import Excel
                            <input type="file" accept=".xlsx,.xls" onChange={handleImport} className="hidden" />
                        </label>
                    </div>
                </div>
                <div className="overflow-y-auto flex-1">
                    {trays.length === 0 && (
                        <p className="text-center py-12 text-gray-300 text-sm">No records</p>
                    )}
                    <table className="w-full">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                {['Part No.', 'Pcs/Stc', 'Stc/Tray', 'Pcs/Tray', ''].map((col, i) => (
                                    <th key={i} className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 border-b border-gray-100">
                                        {col}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {trays.map(t => (
                                <tr key={t.id} className="border-b border-gray-50 hover:bg-gray-50">
                                    <td className="px-4 py-3 text-sm font-mono text-blue-600">{t.part_no}</td>
                                    <td className="px-4 py-3 text-sm text-gray-600">{t.pcs_stc?.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-sm text-gray-600">{t.stc_try?.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-sm font-medium text-gray-800">{t.pcs_try?.toLocaleString()}</td>
                                    <td className="px-4 py-3 text-right space-x-3">
                                        <button onClick={() => handleEdit(t)}
                                            className="text-xs text-blue-400 hover:text-blue-600">แก้ไข</button>
                                        <button onClick={() => handleDelete(t.id)}
                                            className="text-xs text-red-300 hover:text-red-500">ลบ</button>
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

export default MasterTrayTab;