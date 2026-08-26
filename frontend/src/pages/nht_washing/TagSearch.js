// TagSearch.jsx
import React, { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { backendApi, pythonApi } from '../../config/instance';
import API from '../../config/constances';
import axios from 'axios';

const SUB_PROCESS_COLOR = {
    registered: { bg: 'bg-gray-100', text: 'text-gray-600', label: 'Registered' },
    before_washing: { bg: 'bg-blue-100', text: 'text-blue-700', label: 'Before Washing' },
    after_washing: { bg: 'bg-cyan-100', text: 'text-cyan-700', label: 'After Washing' },
    on_machine: { bg: 'bg-purple-100', text: 'text-purple-700', label: 'On Machine' },
    completed: { bg: 'bg-green-100', text: 'text-green-700', label: 'Completed' },
};

const TagSearch = () => {

    const [searchParams] = useSearchParams();
    const location = searchParams.get('location');

    const [deviceApi, setDeviceApi] = useState(null);
    const [deviceReady, setDeviceReady] = useState(false);
    const [tags, setTags] = useState([]);
    const [tagData, setTagData] = useState({});
    const [selected, setSelected] = useState(null);
    const [manualTag, setManualTag] = useState('');

    const [readerIndex, setReaderIndex] = useState(0);

    // โหลด location-ports 
    useEffect(() => { //(main_dll)
        setDeviceReady(false);
        backendApi.get('/location-ports').then(res => {
            const ports = res.data;
            const config = location ? ports[location] : null;
            if (config) {
                setDeviceApi(() => axios.create({ baseURL: `${API.PYTHON_BASE}:${config.port}` }));
            } else {
                setDeviceApi(() => pythonApi);
            }
            setDeviceReady(true);
        }).catch(() => {
            setDeviceApi(() => pythonApi);
            setDeviceReady(true);
        });
        // backendApi.get('/location-ports').then(res => { (main_multi)
        //     const ports = res.data;
        //     const config = location ? ports[location] : null;
        //     setReaderIndex(config?.index ?? 0);
        //     setDeviceReady(true);
        // }).catch(() => {
        //     setReaderIndex(0);
        //     setDeviceReady(true);
        // });
    }, [location]);

    // poll /tags ทุก 1 วิ
    useEffect(() => {
        if (!deviceReady || !deviceApi) return; //(main_dll)
        // if (!deviceReady) return; (main_multi)
        const interval = setInterval(async () => {
            try {
                const res = await deviceApi.get('/tags');//(main_dll)
                // const res = await pythonApi.get(`/tags/${readerIndex}`); (main_multi)
                const list = res.data.tags || [];

                setTags(prev => {
                    const combined = [...new Set([...prev, ...list])];
                    return combined;
                });

                const newTags = list.filter(t => !tagData[t]);
                await Promise.all(newTags.map(async (tag) => {
                    try {
                        const r = await backendApi.get(`/lot-by-tag/${tag}`);
                        if (r.data.found) {
                            setTagData(prev => ({ ...prev, [tag]: r.data.data }));
                        } else {
                            setTagData(prev => ({ ...prev, [tag]: null }));
                        }
                    } catch { }
                }));
            } catch { }
        }, 1000);
        return () => clearInterval(interval);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    // }, [deviceApi, deviceReady]);
    }, [deviceReady]);

    useEffect(() => {
        if (location) localStorage.setItem('rfid_location_register', location);
    }, [location]);

    const handleManualSearch = async () => {
        const target = manualTag.trim().toUpperCase();
        if (!target) return;
        try {
            const r = await backendApi.get(`/lot-by-tag/${target}`);
            if (r.data.found) {
                setTagData(prev => ({ ...prev, [target]: r.data.data }));
            } else {
                setTagData(prev => ({ ...prev, [target]: null }));
            }
            if (!tags.includes(target)) setTags(prev => [...prev, target]);
            setSelected(target);
        } catch { }
    };

    const clearAll = () => {
        setTags([]);
        setTagData({});
        setSelected(null);
        setManualTag('');
    };

    const selectedData = selected ? tagData[selected] : null;
    const sp = selectedData ? SUB_PROCESS_COLOR[selectedData.sub_process] : null;

    return (
        <div className="flex gap-4 h-full">

            {/* LEFT — tag list */}
            <div className="flex flex-col gap-3 w-80 shrink-0">

                <div className="bg-white border border-gray-100 rounded-xl p-3">
                    <p className="text-sm font-medium text-gray-500 mb-2">Search Tag</p>
                    <div className="flex gap-2">
                        <input
                            type="text"
                            value={manualTag}
                            onChange={e => setManualTag(e.target.value.toUpperCase())}
                            onKeyDown={e => e.key === 'Enter' && handleManualSearch()}
                            placeholder="Type or scan..."
                            className="flex-1 h-9 px-2 text-sm font-mono border border-gray-200 rounded-lg
                                       bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                        <button
                            onClick={handleManualSearch}
                            className="h-9 px-3 text-sm rounded-lg bg-blue-600 text-white hover:bg-blue-700"
                        >
                            Go
                        </button>
                        <button
                            onClick={clearAll}
                            className="h-9 px-3 text-sm rounded-lg border border-gray-200 text-gray-400 hover:bg-gray-50"
                        >
                            ✕
                        </button>
                    </div>
                </div>

                <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">
                    <div className="px-3 py-2.5 border-b border-gray-100 flex items-center justify-between">
                        <p className="text-sm font-medium text-gray-500">Tags in range</p>
                        <span className="text-sm text-gray-400">{tags.length} tags</span>
                    </div>
                    <div className="overflow-y-auto flex-1">
                        {tags.length === 0 && (
                            <p className="text-center py-8 text-gray-300 text-sm">No tags detected</p>
                        )}
                        {tags.map(tag => {
                            const data = tagData[tag];
                            const sp2 = data ? SUB_PROCESS_COLOR[data.sub_process] : null;
                            const isActive = selected === tag;
                            return (
                                <div
                                    key={tag}
                                    onClick={() => setSelected(tag)}
                                    className={`flex items-center gap-3 px-3 py-3 border-b border-gray-50
                                        cursor-pointer transition-colors
                                        ${isActive ? 'bg-blue-50' : 'hover:bg-gray-50'}`}
                                >
                                    <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${data === undefined ? 'bg-gray-200 animate-pulse' :
                                        data === null ? 'bg-red-300' :
                                            isActive ? 'bg-blue-500' : 'bg-green-400'
                                        }`} />
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-mono font-medium text-gray-700 truncate">{tag}</p>
                                        {data && (
                                            <p className="text-xs text-gray-400 truncate">
                                                {data.barcode} · {data.part_no}
                                            </p>
                                        )}
                                        {data === null && (
                                            <p className="text-xs text-red-400">Not found in DB</p>
                                        )}
                                    </div>
                                    {sp2 && (
                                        <span className={`text-xs px-2 py-0.5 rounded-full shrink-0 ${sp2.bg} ${sp2.text}`}>
                                            {sp2.label}
                                        </span>
                                    )}
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {/* RIGHT — detail */}
            <div className="flex-1 flex flex-col gap-3 min-w-0">

                {!selected && (
                    <div className="flex-1 bg-white border border-gray-100 rounded-xl flex items-center justify-center">
                        <p className="text-gray-300 text-sm">Select a tag to view details</p>
                    </div>
                )}

                {selected && (
                    <>
                        <div className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-4">
                            <div className="flex-1">
                                <p className="text-xs text-gray-400 mb-1">Tag ID</p>
                                <p className="text-base font-mono font-semibold text-gray-800">{selected}</p>
                            </div>
                            {selectedData && sp && (
                                <>
                                    <span className={`text-sm px-3 py-1.5 rounded-full font-medium ${sp.bg} ${sp.text}`}>
                                        {sp.label}
                                    </span>
                                    <span className={`text-sm px-3 py-1.5 rounded-full ${selectedData.status === 'Ongoing'
                                        ? 'bg-blue-50 text-blue-600'
                                        : 'bg-green-50 text-green-600'
                                        }`}>
                                        {selectedData.status}
                                    </span>
                                </>
                            )}
                            {selectedData === null && (
                                <span className="text-sm px-3 py-1.5 rounded-full bg-red-50 text-red-500">
                                    Not Found
                                </span>
                            )}
                        </div>

                        {selectedData && (
                            <div className="grid grid-cols-3 gap-3">
                                {[
                                    { label: 'Barcode', value: selectedData.barcode, mono: true },
                                    { label: 'Lot No.', value: selectedData.lot_no, mono: true },
                                    { label: 'Part No.', value: selectedData.part_no },
                                    { label: 'Machine No.', value: selectedData.machine_no },
                                    { label: 'Process', value: selectedData.process },
                                    { label: 'Location', value: selectedData.location },
                                    { label: 'Quantity', value: selectedData.quantity?.toLocaleString() },
                                    { label: 'Pcs/Tray', value: (Array.isArray(selectedData.tray_qty) ? selectedData.tray_qty[0] : selectedData.tray_qty)?.toLocaleString() },
                                    { label: 'Tray', value: `${selectedData.tray_no ?? '—'} / ${selectedData.tray_counter}` },
                                    { label: 'Tray Done', value: `${selectedData.tray_done} / ${selectedData.tray_counter}` },
                                    { label: 'RW Diameter', value: selectedData.rw_diameter },
                                    { label: 'Updated', value: new Date(selectedData.updated_at).toLocaleString('en-GB') },
                                ].map(({ label, value, mono }) => (
                                    <div key={label} className="bg-white border border-gray-100 rounded-xl p-4">
                                        <p className="text-xs text-gray-400 uppercase tracking-wider mb-1">{label}</p>
                                        <p className={`text-sm font-medium ${value ? 'text-gray-700' : 'text-gray-300'} ${mono ? 'font-mono' : ''}`}>
                                            {value || '—'}
                                        </p>
                                    </div>
                                ))}
                            </div>
                        )}

                        {selectedData === null && (
                            <div className="flex-1 bg-white border border-gray-100 rounded-xl flex items-center justify-center">
                                <div className="text-center">
                                    <p className="text-gray-400 text-sm mb-1">Tag not registered in system</p>
                                    <p className="text-gray-300 text-sm font-mono">{selected}</p>
                                </div>
                            </div>
                        )}
                    </>
                )}
            </div>

        </div>
    );
};

export default TagSearch;