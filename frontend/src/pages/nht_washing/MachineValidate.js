import React, { useState, useEffect } from 'react';
import { backendApi, washingApi } from '../../config/instance';
import API from '../../config/constances';
// import { backendApi, pythonApi } from '../../config/instance';
import { useSearchParams } from 'react-router-dom';
import Swal from 'sweetalert2';
import axios from 'axios';

const showAlert = (msg, type) => {
    Swal.fire({
        position: 'center',
        icon: type,
        title: msg,
        showConfirmButton: false,
        timer: 1500,
    });
};

const InfoField = ({ label, value, mono = false }) => {
    const isEmpty = value === null || value === undefined || value === '';
    return (
        <div className="bg-white border border-gray-100 rounded-xl p-2">
            <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</p>
            <p className={`text-base font-medium ${isEmpty ? 'text-gray-300' : 'text-gray-800'} ${mono ? 'font-mono' : ''}`}>
                {isEmpty ? '—' : value}
            </p>
        </div>
    );
};

const MachineValidate = () => {

    const [searchParams] = useSearchParams();
    const location = searchParams.get('location');
    const [deviceApi, setDeviceApi] = useState(null);
    const [deviceReady, setDeviceReady] = useState(false);

    // State
    const [lotInfo, setLotInfo] = useState(null);
    const [machineList, setMachineList] = useState([]);
    const [tagId, setTagId] = useState('');
    const [loading, setLoading] = useState(false);
    const [trayDone, setTrayDone] = useState(0);
    const [lotHistory, setLotHistory] = useState(() => {
        try {
            return JSON.parse(localStorage.getItem('rfid_lot_history') || '[]')
        } catch { return [] }
    })
    const [selectedBarcode, setSelectedBarcode] = useState(null)
    // const [readerIndex, setReaderIndex] = useState(0);

    // รันตอน location เปลี่ยน port
    useEffect(() => {
        setDeviceReady(false);
        backendApi.get('/location-ports').then(res => { //(main_dll)
            const ports = res.data;
            const config = location ? ports[location] : null;
            if (config) {
                setDeviceApi(() => axios.create({ baseURL: `${API.PYTHON_BASE}:${config.port}` }));
            } else {
                setDeviceApi(() => washingApi);
            }
            setDeviceReady(true);
        }).catch(() => {
            setDeviceApi(() => washingApi);
            setDeviceReady(true);
        });
        // backendApi.get('/location-ports').then(res => { //(main_multi)
        //     const ports = res.data;
        //     const config = location ? ports[location] : null;
        //     setReaderIndex(config?.index ?? 0);
        //     setDeviceReady(true);
        // }).catch(() => {
        //     setReaderIndex(0);
        //     setDeviceReady(true);
        // });
    }, [location]);

    // รันเมื่อ deviceApi พร้อมแล้ว
    useEffect(() => {
        if (!deviceReady || !deviceApi) return; //(main_dll)
        // if (!deviceReady) return; (main_multi)
        const interval = setInterval(async () => {
            try {
                const res = await deviceApi.get('/new-tag/washing'); //(main_dll)
                // const res = await pythonApi.get(`/new-tag-washing/${readerIndex}`); //(main_multi)
                if (res.data.tag_id) {
                    await new Promise(r => setTimeout(r, 1000));
                    await fetchLotInfo(res.data.tag_id);
                }
            } catch (err) {
            }
        }, 1000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location, deviceApi, deviceReady]); //(main_dll)
    // }, [location, deviceReady, readerIndex]); (main_multi)

    useEffect(() => {
        if (location) localStorage.setItem('rfid_location_washing', location);
    }, [location]);

    // ดึงจำนวน tray ที่ผ่าน washing แล้ว — retry ถ้า DB ยังไม่ update ทัน
    const fetchTrayCount = async (barcode) => {
        for (let i = 0; i < 5; i++) {
            const countRes = await backendApi.get(`/tray_count/${barcode}`);
            const done = countRes.data.after_washing_done ?? 0;
            if (done > 0) return done;
            await new Promise(r => setTimeout(r, 500));
        }
        return 0;
    };

    const fetchLotInfo = async (tag) => {
        setLoading(true);
        try {
            const res = await backendApi.get(`/lot-by-tag/${tag}`);

            if (!res.data.found) {
                showAlert('Tag not found!', 'error');
                return;
            }
            const data = res.data.data;
            // ยังไม่ได้ update pallet location
            if (data.sub_process === 'registered') {
                showAlert('Must update pallet location first!', 'warning');
                return;
            }

            // แสดงข้อมูล lot ทันที ไม่ต้องรอครบ
            setLotInfo(data);
            setTagId(tag);

            // นับ tray ที่ผ่าน after_washing แล้วใน lot นี้
            // const countRes = await backendApi.get(`/tray_count/${data.barcode}`);
            // const done = countRes.data.after_washing_done ?? 0;
            // setTrayDone(done);

            const done = await fetchTrayCount(data.barcode);
            setTrayDone(done);

            // ครบทุก tray แสดง machine list
            if (done >= data.tray_counter) {
                await fetchMachineList(data.part_no, data.rw_diameter, data)
            } else {
                setMachineList([]);
            }

        } catch (err) {
            showAlert(err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    // ดึงค่า RP P,M จาก rw_diameter
    const extractRp = (rwDiameter) => {
        if (!rwDiameter) return null;
        const pMatch = rwDiameter.match(/P\d+/);
        if (pMatch) return pMatch[0];
        const mMatch = rwDiameter.match(/M\d+/);
        if (mMatch) return mMatch[0];
        return null;
    };

    // ดึง machine ที่ตรงกับ part_no
    const fetchMachineList = async (partNo, rwDiameter, lotData) => {
        try {
            // เรียก part convert
            const convertRes = await backendApi.get(`/part-convert/${partNo}`);
            const converts = convertRes.data;
            // filter partConvertFrom ตรงกับ part_no
            const matchedConverts = converts.filter(c => c.partConvertFrom === partNo);
            const convertedParts = matchedConverts.map(c => c.partConvertTo);
            // ถ้าไม่มี convert ใช้ part_no เดิม
            const partsToMatch = convertedParts.length > 0 ? convertedParts : [partNo];
            // เรียก machine API
            const res = await backendApi.get('/machine-list');
            // const rpFromLot = extractRp(rwDiameter);
            // const matched = res.data.filter(item => {
            //     const partMatch = partsToMatch.some(p =>
            //         item.innerRingPart === p ||
            //         item.outerRingPart === p
            //     );
            //     const rpMatch = rpFromLot ? extractRp(item.rp) === rpFromLot : true;
            //     return partMatch && rpMatch;
            // });
            const matched = res.data.filter(item => {
                const partMatch = partsToMatch.some(p =>
                    item.innerRingPart === p ||
                    item.outerRingPart === p
                );
                return partMatch;
            });


            setMachineList(matched)
            setLotHistory(prev => {
                const newEntry = {
                    barcode: lotData.barcode,
                    part_no: lotData.part_no,
                    tray_counter: lotData.tray_counter,
                    rw_diameter: lotData.rw_diameter || lotData.rwDiameter,
                    machineList: matched,
                    time: new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })
                }
                const updated = [newEntry, ...prev.filter(h => h.barcode !== lotData.barcode)]
                const sliced = updated.slice(0, 10)
                localStorage.setItem('rfid_lot_history', JSON.stringify(sliced))
                return sliced
            })
            setSelectedBarcode(lotData.barcode);
            if (matched.length === 0) {
                showAlert('No matching machine found!', 'warning');
            }
        } catch {
            showAlert('Machine API error!', 'error');
        }
    };

    const clearAll = () => {
        setLotInfo(null);
        setMachineList([]);
        setTagId('');
        setTrayDone(0);
    };

    return (
        <div className="flex gap-4 h-full">
            <div className="flex flex-col gap-4 flex-1 min-w-0">
                {/* TAG ID */}
                <div className="bg-white border border-gray-100 rounded-xl px-5 py-1 h-20">
                    <p className="text-sm font-medium text-gray-500 mb-1">Scan RFID tag</p>
                    <div className="flex items-center gap-3">
                        <p className={`text-base font-mono font-medium flex-1 ${tagId ? 'text-blue-600' : 'text-gray-300'}`}>
                            {tagId || 'Waiting for tag...'}
                        </p>
                        {tagId && (
                            <span className="text-xs bg-blue-50 text-blue-600 px-3 py-1 rounded-full">
                                Detected
                            </span>
                        )}
                        <button
                            onClick={clearAll}
                            className="h-10 px-5 text-sm rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
                        >
                            ✕ Clear
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-4 gap-3">
                    <InfoField label="Barcode" value={lotInfo?.barcode} mono />
                    <InfoField label="Part No." value={lotInfo?.part_no} />
                    <InfoField label="Tray Counter" value={lotInfo?.tray_counter} />
                    <InfoField label="RW Diameter" value={extractRp(lotInfo?.rw_diameter)} />
                </div>

                {/* TRAY PROGRESS — แสดงตอนมี lot info แล้ว */}
                {lotInfo && (
                    <div className="bg-white border border-gray-100 rounded-xl px-5 py-4">
                        <div className="flex items-center gap-3 mb-3">
                            <p className="text-xl font-medium text-gray-500">
                                Scan tag :
                            </p>
                            <p className="text-2xl font-semibold text-blue-600">
                                {trayDone}/{lotInfo.tray_counter}
                            </p>
                            <p className="text-sm text-gray-400">trays</p>
                        </div>
                        <div className="w-full bg-gray-100 rounded-full h-2">
                            <div
                                className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                                style={{ width: lotInfo.tray_counter > 0 ? `${(trayDone / lotInfo.tray_counter) * 100}%` : '0%' }}
                            />
                        </div>
                    </div>
                )}

                {/* MACHINE TABLE */}
                <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">

                    <div className="px-4 py-3 border-b border-gray-100 flex items-center gap-3">
                        <p className="text-sm font-medium text-gray-500">Matching machines</p>
                        <span className="text-sm text-gray-400">{machineList.length} found</span>
                    </div>

                    <div className="overflow-y-auto flex-1">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-gray-50 z-10">
                                <tr>
                                    {[
                                        'Machine No.',
                                        'Group Part',
                                        'Bearing No.',
                                        'Specification',
                                        'OuterRing Part',
                                        'InnerRing Part',
                                        'RP'
                                    ].map(col => (
                                        <th key={col} className="text-left px-4 py-3 text-xs font-medium text-gray-400 border-b border-gray-100 whitespace-nowrap">
                                            {col}
                                        </th>
                                    ))}
                                </tr>
                            </thead>

                            <tbody>
                                {machineList.length === 0 && (
                                    <tr>
                                        <td colSpan={7} className="text-center py-12 text-gray-300 text-base">
                                            {loading
                                                ? 'Loading...'
                                                : lotInfo && trayDone < lotInfo.tray_counter
                                                    ? `waiting washing ${lotInfo.tray_counter - trayDone} tray...`
                                                    : 'Scan tag to find matching machines...'}
                                        </td>
                                    </tr>
                                )}
                                {machineList.map((m, i) => (
                                    <tr key={i} className="border-b border-gray-50 hover:bg-blue-50 transition-colors">
                                        <td className="px-4 py-4 font-mono font-semibold text-blue-600 text-base">{m.machineNoProd || '—'}</td>
                                        <td className="px-4 py-4 text-gray-700">{m.groupPart || '—'}</td>
                                        <td className="px-4 py-4 text-gray-700">{m.bearingNo || '—'}</td>
                                        <td className="px-4 py-4 text-gray-500">{m.specification || '—'}</td>
                                        <td className="px-4 py-4 text-gray-500">{m.outerRingPart || '—'}</td>
                                        <td className="px-4 py-4 text-gray-500">{m.innerRingPart || '—'}</td>
                                        <td className="px-4 py-4">
                                            <span className="text-sm bg-blue-50 text-blue-700 px-3 py-1 rounded-full">
                                                {extractRp(m.rp) || '—'}
                                            </span>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                </div>
            </div>{/* จบ ซ้าย */}

            {/* ===== ขวา — History Panel ===== */}
            <div className="flex flex-col gap-2 w-52 shrink-0">
                <div className="bg-white border border-gray-100 rounded-xl px-3 py-2 flex items-center justify-between">
                    <p className="text-xs font-medium text-gray-500">History ({lotHistory.length})</p>
                    <button
                        onClick={() => {
                            setLotHistory([])
                            localStorage.removeItem('rfid_lot_history')
                            setSelectedBarcode(null)
                        }}
                        className="text-[10px] text-gray-400 hover:text-red-400"
                    >
                        Clear
                    </button>
                </div>

                <div className="flex flex-col gap-1.5 overflow-y-auto flex-1">
                    {lotHistory.length === 0 && (
                        <p className="text-center text-xs text-gray-300 py-6">No history</p>
                    )}
                    {lotHistory.map((h, i) => (
                        <button
                            key={i}
                            onClick={() => {
                                setMachineList(h.machineList)
                                setSelectedBarcode(h.barcode)
                                setLotInfo({ barcode: h.barcode, part_no: h.part_no, tray_counter: h.tray_counter, rw_diameter: h.rw_diameter, })
                                setTrayDone(h.tray_counter)
                            }}
                            className={`w-full text-left px-3 py-2.5 rounded-xl border text-xs transition-colors
            ${selectedBarcode === h.barcode
                                    ? 'bg-blue-50 border-blue-200 text-blue-700'
                                    : 'bg-white border-gray-100 text-gray-600 hover:bg-gray-50'
                                }`}
                        >
                            <p className="font-mono font-medium truncate">{h.barcode}</p>
                            <p className="text-[10px] text-gray-400 mt-0.5">{h.part_no} · {h.time}</p>
                            <p className="text-[10px] mt-0.5 text-gray-400">{h.machineList.length} machines</p>
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
};

export default MachineValidate;