import React, { useState, useEffect } from 'react';
import { backendApi } from '../../../config/instance';
import Swal from 'sweetalert2';

const POSITIONS = ['admin', 'user'];
const defaultForm = { emp_id: '', eng_name: '', password: '', position: 'admin' };

const UserTab = () => {
    const [users, setUsers] = useState([]);
    const [form, setForm] = useState(defaultForm);
    const [editId, setEditId] = useState(null);

    const fetchUsers = async () => {
        try {
            const res = await backendApi.get('/login-setting');
            setUsers(res.data);
        } catch {
            Swal.fire('Error', 'โหลดข้อมูลไม่ได้', 'error');
        }
    };

    useEffect(() => { fetchUsers(); }, []);

    const handleChange = (e) => setForm({ ...form, [e.target.name]: e.target.value });

    const handleSubmit = async () => {
        if (!form.emp_id || !form.eng_name || !form.password) {
            return Swal.fire({ icon: 'warning', title: 'กรอกข้อมูลให้ครบ', showConfirmButton: false, timer: 1500 });
        }
        try {
            await backendApi.post('/login-setting', form);
            setForm(defaultForm);
            setEditId(null);
            fetchUsers();
            Swal.fire({ icon: 'success', title: 'เพิ่มแล้ว', showConfirmButton: false, timer: 1500 });
        } catch {
            Swal.fire('Error', 'บันทึกไม่ได้', 'error');
        }
    };

    const handleDelete = async (id) => {
        const confirm = await Swal.fire({
            title: 'ลบ user นี้?', icon: 'warning',
            showCancelButton: true, confirmButtonText: 'ลบ', cancelButtonText: 'ยกเลิก',
            confirmButtonColor: '#ef4444',
        });
        if (!confirm.isConfirmed) return;
        try {
            await backendApi.delete(`/login-setting/${id}`);
            fetchUsers();
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
                    <p className="text-xs text-gray-400 uppercase tracking-wider">Add User</p>
                    {[
                        { name: 'emp_id', placeholder: 'Employee ID' },
                        { name: 'eng_name', placeholder: 'Name' },
                        { name: 'password', placeholder: 'Password', type: 'password' },
                    ].map(({ name, placeholder, type }) => (
                        <input
                            key={name}
                            name={name}
                            type={type || 'text'}
                            value={form[name]}
                            onChange={(e) => {
                                e.target.value = e.target.value.toUpperCase();
                                handleChange(e);
                            }}
                            placeholder={placeholder}
                            className="w-full h-10 px-3 text-sm uppercase border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                    ))}
                    <select
                        name="position"
                        value={form.position}
                        onChange={handleChange}
                        className="w-full h-10 px-3 text-sm border border-gray-200 rounded-lg bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                    >
                        {POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
                    </select>
                    <button onClick={handleSubmit}
                        className="h-9 bg-blue-500 hover:bg-blue-600 text-white text-sm rounded-lg transition-colors">
                        เพิ่ม
                    </button>
                </div>
            </div>

            {/* ขวา — table */}
            <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">
                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <p className="text-sm font-medium text-gray-500">Users</p>
                    <span className="text-xs text-gray-400">{users.length} records</span>
                </div>
                <div className="overflow-y-auto flex-1">
                    {users.length === 0 && (
                        <p className="text-center py-12 text-gray-300 text-sm">No records</p>
                    )}
                    <table className="w-full">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                {['Emp ID', 'Name', 'Position', ''].map((col, i) => (
                                    <th key={i} className="text-left px-4 py-2.5 text-xs font-medium text-gray-400 border-b border-gray-100">
                                        {col}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id} className="border-b border-gray-50 hover:bg-gray-50">
                                    <td className="px-4 py-3 text-sm font-mono text-gray-600">{u.emp_id}</td>
                                    <td className="px-4 py-3 text-sm text-gray-800">{u.eng_name}</td>
                                    <td className="px-4 py-3">
                                        <span className={`text-xs px-2 py-0.5 rounded-full font-medium
                                            ${u.position === 'admin' ? 'bg-blue-50 text-blue-600' : 'bg-gray-100 text-gray-500'}`}>
                                            {u.position}
                                        </span>
                                    </td>
                                    <td className="px-4 py-3 text-right">
                                        <button onClick={() => handleDelete(u.id)}
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

export default UserTab;