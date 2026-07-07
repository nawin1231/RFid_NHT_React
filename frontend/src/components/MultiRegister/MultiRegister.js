import React, { useState, useEffect, useRef } from 'react';
import { backendApi, pythonApi } from '../../config/instance';
import Swal from 'sweetalert2';

const showAlert = (msg, type) => {
    Swal.fire({
        position: 'center',
        icon: type,
        title: msg,
        showConfirmButton: false,
        timer: 1000,
    });
};

const MultiRegister = () => {

    const [barcode, setBarcode] = useState('');
    const [jobs, setJobs] = useState([]);
    const [started, setStarted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [activeJob, setActiveJob] = useState(null);
    const [tagId, setTagId] = useState('');

    const inputRef = useRef(null);

    // focus input
    useEffect(() => {
        if (started) return;
        const refocus = () => setTimeout(() => inputRef.current?.focus(), 0);
        refocus();
        document.addEventListener('click', refocus);
        return () => document.removeEventListener('click', refocus);
    }, [started, loading]);

    // poll tag จาก register reader
    useEffect(() => {
        if (!started) return;
        const interval = setInterval(async () => {
            try {
                const res = await pythonApi.get('/new-tag');
                if (res.data.tag_id) setTagId(res.data.tag_id);
            } catch { }
        }, 1000);
        return () => clearInterval(interval);
    }, [started]);

    // ถ้าได้ tag ใหม่ ต้องมี active job ก่อน
    useEffect(() => {
        if (!tagId) return;
        if (!activeJob) {
            showAlert('Please select an active job first!', 'warning');
            setTagId('');
            return;
        }
        registerTray(tagId, activeJob);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [tagId]);

    // scan barcode รอ 1 วิ fetch register-lot ทันที
    useEffect(() => {
        if (!barcode) return;
        const timer = setTimeout(async () => {
            const target = barcode.trim();
            if (!target) return;
            if (jobs.some(j => j.job_ticket_no === target)) {
                showAlert('Job already in list!', 'warning');
                setBarcode('');
                return;
            }
            setLoading(true);
            try {
                const res = await backendApi.get(`/job-ticket/${target.trim()}`);
                const data = res.data;

                const regRes = await backendApi.post('/register-lot', {
                    barcode: data.job_ticket_no,
                    lot_no: data.lot_no,
                    material_no: data.material_lot,
                    part_no: data.part_no,
                    machine_no: data.machine_number,
                    process_code: data.process_code,
                    process: data.process,
                    coil: data.coil,
                    ir_diameter: data.id_diameter,
                    rw_diameter: data.rw_diameter,
                    process_date: data.date,
                    quantity: data.quantity,
                });

                const result = regRes.data.result;
                if (result === 'OK' || result === 'RESUME') {
                    setJobs(prev => [...prev, {
                        job_ticket_no: data.job_ticket_no,
                        lot_no: data.lot_no,
                        part_no: data.part_no,
                        machine_no: data.machine_number,
                        process: data.process,
                        rw_diameter: data.rw_diameter,
                        quantity: data.quantity,
                        tray_counter: regRes.data.tray_counter,
                        tray_qty: regRes.data.tray_qty,
                        tray_done: regRes.data.tray_done || 0,
                    }]);
                    showAlert(result === 'RESUME' ? 'Resumed!' : 'Job added!', 'success');
                } else if (result === 'BARCODE_IN_USE') {
                    showAlert('Barcode already in use!', 'error');
                } else {
                    showAlert(result, 'error');
                }
            } catch {
                showAlert('Barcode not found!', 'error');
            } finally {
                setLoading(false);
                setBarcode('');
            }
        }, 1000);
        return () => clearTimeout(timer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [barcode]);

    const removeJob = (jobTicketNo) => {
        setJobs(prev => prev.filter(j => j.job_ticket_no !== jobTicketNo));
        if (activeJob === jobTicketNo) setActiveJob(null);
    };

    const startRegistering = () => {
        if (jobs.length === 0) {
            showAlert('Add at least one job first!', 'warning');
            return;
        }
        setStarted(true);
        setActiveJob(jobs[0].job_ticket_no);
        setTagId('');
        pythonApi.get('/new-tag').catch(() => {});
        showAlert('Started! Scan tags now', 'success');
    };

    const cancelAll = () => {
        setBarcode('');
        setJobs([]);
        setStarted(false);
        setActiveJob(null);
        setTagId('');
    };

    const findNextIncompleteJob = (jobList, currentJobTicketNo) => {
        const currentIndex = jobList.findIndex(j => j.job_ticket_no === currentJobTicketNo);
        for (let i = 1; i <= jobList.length; i++) {
            const next = jobList[(currentIndex + i) % jobList.length];
            if (next.tray_done < next.tray_counter) return next.job_ticket_no;
        }
        return null;
    };

    const registerTray = async (tag, jobTicketNo) => {
        try {
            const res = await backendApi.post('/register-tray', {
                tag_id: tag,
                barcode: jobTicketNo,
            });
            const result = res.data.result;

            if (result === 'OK') {
                setJobs(prev => {
                    const updated = prev.map(j => {
                        if (j.job_ticket_no !== jobTicketNo) return j;
                        return { ...j, tray_done: j.tray_done + 1 };
                    });
                    const finished = updated.find(j => j.job_ticket_no === jobTicketNo);
                    const justDone = finished.tray_done >= finished.tray_counter;
                    const allDone = updated.every(j => j.tray_done >= j.tray_counter);

                    if (allDone) {
                        showAlert('All jobs complete!', 'success');
                        setTimeout(() => {
                            setJobs([]);
                            setStarted(false);
                            setActiveJob(null);
                            setBarcode('');
                            setTagId('');
                        }, 1500);
                    } else if (justDone) {
                        showAlert(`${jobTicketNo} complete! Next job selected`, 'success');
                        const next = findNextIncompleteJob(updated, jobTicketNo);
                        setActiveJob(next);
                    }

                    return updated;
                });
                setTagId('');
            } else if (result === 'TAG_IN_USE') {
                showAlert('Tag already in use!', 'error');
                setTagId('');
            } else if (result === 'TRAY_FULL') {
                showAlert(`${jobTicketNo} already complete!`, 'warning');
                setTagId('');
            } else {
                showAlert(result, 'error');
                setTagId('');
            }
        } catch (err) {
            showAlert(err.message, 'error');
        }
    };

    return (
        <div className="flex flex-col gap-3 h-full">

            {/* SCAN BARCODE */}
            {!started && (
                <div className="bg-white border border-gray-100 rounded-xl p-4">
                    <p className="text-xs font-medium text-gray-500 mb-2">
                        Scan barcode to add job
                    </p>
                    <input
                        ref={inputRef}
                        type="text"
                        value={barcode}
                        onChange={(e) => setBarcode(e.target.value.toUpperCase())}
                        onBlur={() => setTimeout(() => inputRef.current?.focus(), 0)}
                        placeholder="Waiting for scanner..."
                        disabled={loading}
                        className="w-full h-9 px-3 text-sm font-mono border border-gray-200 rounded-lg
                                   bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
                    />
                </div>
            )}

            {/* JOB LIST */}
            <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">

                <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-500">Jobs ({jobs.length})</p>
                    <div className="flex gap-2">
                        {(jobs.length > 0 || started) && (
                            <button
                                onClick={cancelAll}
                                className="h-8 px-3 text-xs rounded-lg border border-red-200 text-red-500 hover:bg-red-50"
                            >
                                Cancel All
                            </button>
                        )}
                        {!started ? (
                            <button
                                onClick={startRegistering}
                                disabled={jobs.length === 0}
                                className="h-8 px-4 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
                            >
                                Start Registering →
                            </button>
                        ) : (
                            <span className="text-xs px-3 py-1 rounded-full bg-blue-50 text-blue-600">
                                Scanning in progress
                            </span>
                        )}
                    </div>
                </div>

                <div className="overflow-y-auto flex-1">
                    <table className="w-full text-sm">
                        <thead className="bg-gray-50 sticky top-0">
                            <tr>
                                {['', 'Job Ticket', 'Lot No.', 'Part No.', 'Machine', 'Qty', 'Pcs/Tray', 'Process', 'RW', 'Progress', ''].map((col,i) => (
                                    <th key={i} className="text-left px-3 py-2 text-xs font-medium text-gray-400 border-b border-gray-100 whitespace-nowrap">
                                        {col}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {jobs.map(job => {
                                const isActive = activeJob === job.job_ticket_no;
                                const isDone = job.tray_done >= job.tray_counter;
                                return (
                                    <tr
                                        key={job.job_ticket_no}
                                        onClick={() => started && !isDone && setActiveJob(job.job_ticket_no)}
                                        className={`border-b border-gray-50 transition-colors
                                            ${started && !isDone ? 'cursor-pointer' : ''}
                                            ${isActive ? 'bg-blue-50' : isDone ? 'bg-green-50' : 'hover:bg-gray-50'}`}
                                    >
                                        <td className="px-3 py-3">
                                            <span className={`block w-2 h-2 rounded-full ${isActive ? 'bg-blue-600' : isDone ? 'bg-green-500' : 'bg-gray-200'
                                                }`} />
                                        </td>
                                        <td className="px-3 py-3 font-mono text-xs font-medium text-gray-800">{job.job_ticket_no}</td>
                                        <td className="px-3 py-3 font-mono text-xs text-gray-600">{job.lot_no}</td>
                                        <td className="px-3 py-3 text-xs text-gray-600">{job.part_no}</td>
                                        <td className="px-3 py-3 text-xs text-gray-500">{job.machine_no || '—'}</td>
                                        <td className="px-3 py-3 text-xs text-gray-500">{job.quantity?.toLocaleString()}</td>
                                        <td className="px-3 py-3 text-xs text-gray-500">{job.tray_qty?.toLocaleString() ?? '—'}</td>
                                        <td className="px-3 py-3 text-xs text-gray-500">{job.process || '—'}</td>
                                        <td className="px-3 py-3 text-xs text-gray-500">{job.rw_diameter || '—'}</td>
                                        <td className="px-3 py-3">
                                            <div className="flex items-center gap-2">
                                                <div className="w-24 bg-gray-100 rounded-full h-1.5">
                                                    <div
                                                        className={`h-1.5 rounded-full transition-all ${isDone ? 'bg-green-500' : 'bg-blue-500'}`}
                                                        style={{ width: job.tray_counter > 0 ? `${(job.tray_done / job.tray_counter) * 100}%` : '0%' }}
                                                    />
                                                </div>
                                                <span className="text-xs text-gray-500 whitespace-nowrap">
                                                    {job.tray_done}/{job.tray_counter}
                                                </span>
                                            </div>
                                        </td>
                                        <td className="px-3 py-3">
                                            {isActive && started && (
                                                <span className="text-[10px] bg-blue-600 text-white px-2 py-0.5 rounded-full">
                                                    ACTIVE
                                                </span>
                                            )}
                                            {isDone && (
                                                <span className="text-[10px] bg-green-600 text-white px-2 py-0.5 rounded-full">
                                                    DONE
                                                </span>
                                            )}
                                            {!started && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); removeJob(job.job_ticket_no); }}
                                                    className="text-xs text-gray-300 hover:text-red-500"
                                                >
                                                    ✕
                                                </button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* SCAN TAG STATUS */}
            {started && (
                <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
                    <p className="text-xs text-gray-400 mb-1">
                        Scanning into: <span className="font-mono text-blue-600 font-medium">{activeJob || '—'}</span>
                    </p>
                    <p className={`text-sm font-mono ${tagId ? 'text-blue-600' : 'text-gray-300'}`}>
                        {tagId || 'Waiting for tag...'}
                    </p>
                </div>
            )}

        </div>
    );
};

export default MultiRegister;