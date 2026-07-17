import React, { useState, useEffect } from 'react';
import { backendApi, washingApi } from '../../config/instance';
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

    // รันตอน location เปลี่ยน port
    useEffect(() => {
        setDeviceReady(false);
        backendApi.get('/location-ports').then(res => {
            const ports = res.data;
            const config = location ? ports[location] : null;
            if (config) {
                setDeviceApi(() => axios.create({ baseURL: `http://localhost:${config.port}` }));
            } else {
                setDeviceApi(() => washingApi);
            }
            setDeviceReady(true);
        }).catch(() => {
            setDeviceApi(() => washingApi);
            setDeviceReady(true);
        });
    }, [location]);

    // รันเมื่อ deviceApi พร้อมแล้ว
    useEffect(() => {
        if (!deviceReady || !deviceApi) return;
        const interval = setInterval(async () => {
            try {
                const res = await deviceApi.get('/new-tag/washing');
                if (res.data.tag_id) {
                    await new Promise(r => setTimeout(r, 1000));
                    await fetchLotInfo(res.data.tag_id);
                }
            } catch (err) {
                //console.log('poll error:', err.config?.url, err.message);
            }
        }, 500);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [location, deviceApi, deviceReady]);

    useEffect(() => {
        if (location) localStorage.setItem('rfid_location_washing', location);
    }, [location]);
    
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
            const countRes = await backendApi.get(`/tray_count/${data.barcode}`);
            const done = countRes.data.after_washing_done ?? 0;
            setTrayDone(done);

            // ครบทุก tray แสดง machine list
            if (done >= data.tray_counter) {
                await fetchMachineList(data.part_no, data.rw_diameter);
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
    const fetchMachineList = async (partNo, rwDiameter) => {
        try {
            // เรียก part convert
            const convertRes = await backendApi.get(`/part-convert/${partNo}`);
            const converts = convertRes.data;
            //console.log('part_no ที่ใช้หา:', partNo);
            //console.log('converts ทั้งหมด:', converts.length, converts.slice(0, 3));
            // filter partConvertFrom ตรงกับ part_no
            const matchedConverts = converts.filter(c => c.partConvertFrom === partNo);
            //console.log('matchedConverts:', matchedConverts);
            const convertedParts = matchedConverts.map(c => c.partConvertTo);
            // ถ้าไม่มี convert ใช้ part_no เดิม
            const partsToMatch = convertedParts.length > 0 ? convertedParts : [partNo];
            //console.log('partsToMatch:', partsToMatch);
            // เรียก machine API
            const res = await backendApi.get('/machine-list');
            //console.log('machine ทั้งหมด:', res.data.length, res.data[0]);
            const matched = res.data.filter(item => {
                const partMatch = partsToMatch.some(p =>
                    item.innerRingPart === p ||
                    item.outerRingPart === p
                );
                return partMatch;
            });
            //console.log('matched:', matched);


            setMachineList(matched);
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
        <div className="flex flex-col gap-4 h-full">

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
                                    'InnerRing Part',
                                    'OuterRing Part',
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
                                    <td className="px-4 py-4 text-gray-500">{m.innerRingPart || '—'}</td>
                                    <td className="px-4 py-4 text-gray-500">{m.outerRingPart || '—'}</td>
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

        </div>
    );
};

export default MachineValidate;