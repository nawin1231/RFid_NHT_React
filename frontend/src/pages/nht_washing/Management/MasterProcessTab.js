import React, { useState, useEffect } from 'react';
import { backendApi } from '../../../config/instance';
import Swal from 'sweetalert2';

const defaultForm = { process_code: '', process: '' };

const MasterProcessTab = () => {
    const [processes, setProcesses] = useState([]);
    const [form, setForm] = useState(defaultForm);
    const [editId, setEditId] = useState(null);

    const fetchProcesses = async () => {
        try {
            const res = await backendApi.get('/master-process');
            setProcesses(res.data);
        } catch {
            Swal.fire('Error', 'โหลดข้อมูลไม่ได้', 'error');
        }
    };

    useEffect(() => { fetchProcesses(); }, []);

    const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    const handleSubmit = async () => {
        if (!form.process_code || !form.process) {
            return Swal.fire({ icon: 'warning', title: 'กรอกข้อมูลให้ครบ', showConfirmButton: false, timer: 1500 });
        }
        try {
            if (editId) {
                await backendApi.put(`/master-process/${editId}`, form);
            } else {
                await backendApi.post('/master-process', form);
            }
            setForm(defaultForm);
            setEditId(null);
            fetchProcesses();
            Swal.fire({ icon: 'success', title: editId ? 'แก้ไขแล้ว' : 'เพิ่มแล้ว', showConfirmButton: false, timer: 1500 });
        } catch {
            Swal.fire('Error', 'บันทึกไม่ได้', 'error');
        }
    };

    const handleEdit = (p) => {
        setEditId(p.id);
        setForm({ process_code: p.process_code, process: p.process });
    };

    const handleDelete = async (id) => {
        const confirm = await Swal.fire({
            title: 'ลบ process นี้?', icon: 'warning',
            showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#ef4444',
        });
        if (!confirm.isConfirmed) return;
        try {
            await backendApi.delete(`/master-process/${id}`);
            fetchProcesses();
        } catch {
            Swal.fire('Error', 'ลบไม่ได้', 'error');
        }
    };

    const handleCancel = () => { setForm(defaultForm); setEditId(null); };

    return (
        <div className="flex gap-4 h-full">

            {/* ซ้าย — form */}
            <div className="w-80 shrink-0">
                <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-col gap-3">
                    <p className="text-xs text-gray-400 uppercase tracking-wider">
                        {editId ? 'Edit Process' : 'Add Process'}
                    </p>
                    <input
                        name="process_code"
                        value={form.process_code}
                        onChange={handleChange}
                        placeholder="Process Code เช่น 1201"
                        className="w-full h-10 px-3 text-sm font-mono border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <input
                        name="process"
                        value={form.process}
                        onChange={handleChange}
                        placeholder="Process Name เช่น WATER WASHING 1"
                        className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    />
                    <div className="flex gap-2 pt-1">
                        <button onClick={handleSubmit}
                            className="flex-1 h-9 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors">
                            {editId ? 'บันทึก' : 'เพิ่ม'}
                        </button>
                        {editId && (
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
                    <p className="text-sm font-medium text-gray-500">Master Process</p>
                    <span className="text-xs text-gray-400">{processes.length} records</span>
                </div>
                <div className="overflow-y-auto flex-1">
                    {processes.length === 0 && (
                        <p className="text-center py-12 text-gray-300 text-sm">No records</p>
                    )}
                    <table className="w-full">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                {['Process Code', 'Process Name', ''].map((col, i) => (
                                    <th key={i} className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 border-b border-gray-100">
                                        {col}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {processes.map(p => (
                                <tr key={p.id} className="border-b border-gray-50 hover:bg-gray-50">
                                    <td className="px-4 py-3 text-sm font-mono text-blue-600">{p.process_code}</td>
                                    <td className="px-4 py-3 text-sm text-gray-600">{p.process}</td>
                                    <td className="px-4 py-3 text-right space-x-3">
                                        <button onClick={() => handleEdit(p)}
                                            className="text-xs text-blue-400 hover:text-blue-600">แก้ไข</button>
                                        <button onClick={() => handleDelete(p.id)}
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

export default MasterProcessTab;