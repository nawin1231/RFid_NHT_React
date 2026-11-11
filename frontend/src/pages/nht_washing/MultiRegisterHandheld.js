import React, { useState, useEffect, useRef } from 'react';
import Swal from 'sweetalert2';
import { backendApi } from '../../config/instance';

/**
 * @param {string} msg 
 * @param {'success'|'error'|'warning'} type 
 */
const showAlert = (msg, type) => {
    Swal.fire({
        position: 'center',
        icon: type,
        title: msg,
        showConfirmButton: false,
        timer: 1800,
    });
};

const MultiRegisterHandheld = () => {
    // ---------------- State ----------------
    const [barcode, setBarcode] = useState('');
    const [jobs, setJobs] = useState([]);
    const [started, setStarted] = useState(false);
    const [loading, setLoading] = useState(false);
    const [activeJob, setActiveJob] = useState(null);

    // ---------------- Refs ----------------
    const barcodeInputRef = useRef(null);
    const rfidInputRef = useRef(null);
    
    /** @type {React.MutableRefObject<string[]>} */
    const rfidBufferRef = useRef([]);
    /** @type {React.MutableRefObject<NodeJS.Timeout | null>} */
    const scanTimerRef = useRef(null);

    // Auto-focus ช่อง Barcode ตอนเริ่ม
    useEffect(() => {
        if (!started && !loading) {
            barcodeInputRef.current?.focus();
        }
    }, [started, loading]);

    // เคลียร์ Timer ตอน Unmount
    useEffect(() => {
        return () => clearTimeout(scanTimerRef.current);
    }, []);

    // ---------------- Logic ----------------

    /**
     * ดักจับสแกนบาร์โค้ด (Job)
     * @param {React.KeyboardEvent<HTMLInputElement>} e 
     */
    const handleBarcodeKeyDown = async (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const target = barcode.trim();
            if (!target) return;

            if (jobs.some(j => j.job_ticket_no === target)) {
                showAlert('Job already in list!', 'warning');
                setBarcode('');
                return;
            }

            await fetchAndAddJob(target);
        }
    };

    /**
     * ดึงข้อมูล Job จาก Backend
     * @param {string} target 
     */
    const fetchAndAddJob = async (target) => {
        setLoading(true);
        try {
            const res = await backendApi.get(`/job-ticket/${target}`);
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
            
            if (result === 'BARCODE_COMPLETED') {
                showAlert('This lot is already completed!', 'warning');
            } else if (result === 'OK' || result === 'RESUME') {
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
        } catch (err) {
            console.error(err);
            showAlert('Barcode not found!', 'error');
        } finally {
            setLoading(false);
            setBarcode('');
        }
    };

    /**
     * ดักจับสแกน RFID (Buffering)
     * @param {React.KeyboardEvent<HTMLInputElement>} e 
     */
    const handleRfidKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            const rfidVal = e.target.value.trim();
            if (!rfidVal) return;

            // 1. เก็บ Tag เข้า Buffer
            rfidBufferRef.current.push(rfidVal);
            
            // 2. ล้างช่องรับเพื่อรอตัวถัดไป
            e.target.value = '';

            // 3. หน่วงเวลา 400ms เพื่อกวาด Tag ทั้งหมดที่ถูกยิงมาพร้อมกัน
            if (scanTimerRef.current) clearTimeout(scanTimerRef.current);
            scanTimerRef.current = setTimeout(() => {
                processBufferedTags();
            }, 400); 
        }
    };

    const processBufferedTags = async () => {
        if (!activeJob) return;

        const tagsInBuffer = rfidBufferRef.current;
        rfidBufferRef.current = []; // Clear buffer
        
        if (tagsInBuffer.length === 0) return;

        // ตัด Tag ซ้ำ
        const uniqueTags = [...new Set(tagsInBuffer)];

        if (uniqueTags.length > 1) {
            // Anti Mix-up Alert
            Swal.fire({
                icon: "warning",
                title: "อ่านติดหลาย Tag!",
                html: "ระบบพบข้อมูลมากกว่า 1 ดวง<br/><b>กรุณาแยกชิ้นงานออกมาสแกนเดี่ยวๆ</b>",
                confirmButtonColor: '#3085d6',
            }).then(() => {
                rfidInputRef.current?.focus();
            });
            return;
        }

        // กรณีอ่านได้ตัวเดียว (แม้จะซ้ำกันหลายครั้ง)
        const targetRfid = uniqueTags[0];
        await registerTray(targetRfid, activeJob);
    };

    const registerTray = async (tag, jobTicketNo) => {
        try {
            setLoading(true);
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
                        setTimeout(() => cancelAll(), 1500);
                    } else if (justDone) {
                        showAlert(`${jobTicketNo} complete!`, 'success');
                        const next = findNextIncompleteJob(updated, jobTicketNo);
                        setActiveJob(next);
                    }
                    return updated;
                });
            } else if (result === 'TAG_IN_USE') {
                showAlert('Tag already in use!', 'error');
            } else if (result === 'TRAY_FULL') {
                showAlert(`${jobTicketNo} already complete!`, 'warning');
            } else {
                showAlert(result, 'error');
            }
        } catch (err) {
            showAlert('Network or Server Error', 'error');
        } finally {
            setLoading(false);
            setTimeout(() => rfidInputRef.current?.focus(), 100);
        }
    };

    const findNextIncompleteJob = (jobList, currentJobTicketNo) => {
        const currentIndex = jobList.findIndex(j => j.job_ticket_no === currentJobTicketNo);
        for (let i = 1; i <= jobList.length; i++) {
            const next = jobList[(currentIndex + i) % jobList.length];
            if (next.tray_done < next.tray_counter) return next.job_ticket_no;
        }
        return null;
    };

    const startRegistering = () => {
        if (jobs.length === 0) {
            showAlert('Add at least one job first!', 'warning');
            return;
        }
        setStarted(true);
        setActiveJob(jobs[0].job_ticket_no);
        setTimeout(() => rfidInputRef.current?.focus(), 100);
    };

    const cancelAll = () => {
        setBarcode('');
        setJobs([]);
        setStarted(false);
        setActiveJob(null);
    };

    const removeJob = (jobTicketNo) => {
        setJobs(prev => prev.filter(j => j.job_ticket_no !== jobTicketNo));
        if (activeJob === jobTicketNo) setActiveJob(null);
    };

    // ---------------- Render ----------------
    return (
        <div className="flex flex-col gap-4 h-full p-4">
            {/* 1. SCAN BARCODE SECTION */}
            {!started && (
                <div className="bg-white border border-gray-200 rounded-xl p-6 shadow-sm">
                    <p className="text-lg font-bold text-gray-700 mb-2">1. สแกนบาร์โค้ด Job (Barcode)</p>
                    <input
                        ref={barcodeInputRef}
                        type="text"
                        value={barcode}
                        onChange={(e) => setBarcode(e.target.value.toUpperCase())}
                        onKeyDown={handleBarcodeKeyDown}
                        placeholder="ยิงบาร์โค้ดแล้วกด Enter หรือใช้สแกนเนอร์..."
                        disabled={loading}
                        className="w-full h-12 px-4 text-lg font-mono border-2 border-blue-200 rounded-lg bg-blue-50 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-200 disabled:opacity-50"
                    />
                </div>
            )}

            {/* 2. JOB LIST SECTION */}
            <div className="flex-1 bg-white border border-gray-200 rounded-xl flex flex-col overflow-hidden shadow-sm">
                <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between bg-gray-50">
                    <p className="text-xl font-bold text-gray-700">Jobs ({jobs.length})</p>
                    <div className="flex gap-3">
                        {(jobs.length > 0 || started) && (
                            <button onClick={cancelAll} className="h-10 px-6 text-base font-bold rounded-lg border-2 border-red-200 text-red-500 hover:bg-red-50 transition-colors">
                                Cancel All
                            </button>
                        )}
                        {!started ? (
                            <button onClick={startRegistering} disabled={jobs.length === 0} className="h-10 px-6 text-base font-bold rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 transition-colors">
                                Start Registering 🚀
                            </button>
                        ) : (
                            <span className="flex items-center px-4 py-1 rounded-full bg-emerald-100 text-emerald-700 font-bold border border-emerald-300">
                                🟢 Active Mode
                            </span>
                        )}
                    </div>
                </div>

                <div className="overflow-y-auto flex-1">
                    {jobs.length === 0 && (
                        <div className="h-full flex items-center justify-center">
                            <p className="text-gray-400 text-xl font-medium">No jobs added yet. Please scan barcode.</p>
                        </div>
                    )}
                    
                    <table className="w-full">
                        {/* โครงสร้างตาราง Thead และ Tbody เหมือนเดิมเป๊ะ */}
                        <thead className="bg-white sticky top-0 shadow-sm">
                            <tr>
                                {['', 'Job Ticket', 'Lot No.', 'Part No.', 'Qty', 'Progress', ''].map((col, i) => (
                                    <th key={i} className="text-left px-4 py-3 text-sm font-bold text-gray-500 whitespace-nowrap">{col}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {jobs.map(job => {
                                const isActive = activeJob === job.job_ticket_no;
                                const isDone = job.tray_done >= job.tray_counter;
                                return (
                                    <tr key={job.job_ticket_no} onClick={() => started && !isDone && setActiveJob(job.job_ticket_no)}
                                        className={`border-b border-gray-100 transition-colors ${started && !isDone ? 'cursor-pointer' : ''} ${isActive ? 'bg-blue-50' : isDone ? 'bg-emerald-50' : 'hover:bg-gray-50'}`}
                                    >
                                        <td className="px-4 py-4"><span className={`block w-3 h-3 rounded-full ${isActive ? 'bg-blue-600' : isDone ? 'bg-emerald-500' : 'bg-gray-300'}`} /></td>
                                        <td className="px-4 py-4 font-mono font-bold text-blue-700">{job.job_ticket_no}</td>
                                        <td className="px-4 py-4 font-mono text-gray-600">{job.lot_no}</td>
                                        <td className="px-4 py-4 text-gray-600 font-medium">{job.part_no}</td>
                                        <td className="px-4 py-4 text-gray-600">{job.quantity?.toLocaleString()}</td>
                                        <td className="px-4 py-4">
                                            <div className="flex items-center gap-3">
                                                <div className="w-32 bg-gray-200 rounded-full h-2.5">
                                                    <div className={`h-2.5 rounded-full transition-all ${isDone ? 'bg-emerald-500' : 'bg-blue-500'}`} style={{ width: job.tray_counter > 0 ? `${(job.tray_done / job.tray_counter) * 100}%` : '0%' }} />
                                                </div>
                                                <span className="text-sm font-bold text-gray-700">{job.tray_done}/{job.tray_counter}</span>
                                            </div>
                                        </td>
                                        <td className="px-4 py-4 text-right">
                                            {!started && (
                                                <button onClick={(e) => { e.stopPropagation(); removeJob(job.job_ticket_no); }} className="text-gray-400 hover:text-red-500 font-bold p-2">✕</button>
                                            )}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* 3. SCAN RFID SECTION (แสดงเมื่อกด Start เท่านั้น) */}
            {started && (
                <div className="bg-emerald-50 border-2 border-emerald-400 rounded-xl p-6 shadow-md relative overflow-hidden">
                    {/* Background Decoration */}
                    <div className="absolute top-0 right-0 p-4 opacity-10">
                        <svg className="w-24 h-24" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 17.93c-3.95-.49-7-3.85-7-7.93 0-.62.08-1.21.21-1.79L9 15v1c0 1.1.9 2 2 2v1.93zm6.9-2.54c-.26-.81-1-1.39-1.9-1.39h-1v-3c0-.55-.45-1-1-1H8v-2h2c.55 0 1-.45 1-1V7h2c1.1 0 2-.9 2-2v-.41c2.93 1.19 5 4.06 5 7.41 0 2.08-.8 3.97-2.1 5.39z"/></svg>
                    </div>

                    <div className="relative z-10">
                        <p className="text-sm font-bold text-emerald-800 mb-2">2. เตรียมพร้อมผูก Tag</p>
                        <p className="text-2xl text-gray-800 mb-4">
                            กำลังลงทะเบียนเข้า Job: <span className="font-mono text-blue-700 font-black bg-white px-3 py-1 rounded shadow-sm">{activeJob || '—'}</span>
                        </p>
                        
                        <input
                            ref={rfidInputRef}
                            type="text"
                            onKeyDown={handleRfidKeyDown}
                            onBlur={() => setTimeout(() => { if (started) rfidInputRef.current?.focus(); }, 200)} // ดึง focus กลับมาเสมอถ้ายังไม่ Cancel
                            placeholder="ยิง Handheld Scanner เพื่ออ่าน RFID ⚡"
                            disabled={loading}
                            className="w-full h-14 px-5 text-xl font-mono border-2 border-emerald-500 rounded-lg focus:outline-none focus:ring-4 focus:ring-emerald-200 uppercase shadow-inner disabled:bg-gray-100"
                        />
                        <p className="text-sm text-emerald-600 font-semibold mt-3 flex items-center gap-2">
                            <span>*ใช้ Handheld สแกนที่ Tag ทีละดวง ระบบจะบันทึกอัตโนมัติ</span>
                        </p>
                    </div>
                </div>
            )}
        </div>
    );
};

export default MultiRegisterHandheld;