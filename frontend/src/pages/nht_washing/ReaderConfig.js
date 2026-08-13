import React, { useState, useEffect } from 'react';
import { backendApi } from '../../config/instance';
import Swal from 'sweetalert2';

// ประเภท reader ที่รองรับ
const READER_TYPES = ['register', 'pallet', 'washing', 'on_machine', 'completed'];

// ประเภท location ที่มีหน้าจอ monitor (ใช้ใน Location Ports)
const LOCATION_TYPES = ['register', 'washing'];

// ค่า default เมื่อ Add reader ใหม่
const DEFAULT_READER = {
  port: 8000,
  type: 'register',
  enabled: true,
  ip: '192.168.1.',
  power: 15,
  location: '',
  machine_parts: [],
  min_qty: 0,
};

const ReaderConfig = () => {
  // ---- STATE ----
  const [readers, setReaders] = useState([]);       // config ทั้งหมดจาก readers_config.json
  const [edited, setEdited] = useState(false);      // มีการแก้ไขที่ยังไม่ได้ save ไหม
  const [loading, setLoading] = useState(false);    // กำลัง save อยู่ไหม
  const [restarting, setRestarting] = useState(null); // port ที่กำลัง restart อยู่

  const [status, setStatus] = useState([]);         // สถานะ connected/disconnected จาก Python process

  const [locationPorts, setLocationPorts] = useState({});  // config จาก location_ports.json
  const [locEdited, setLocEdited] = useState(false);       // มีการแก้ location ที่ยังไม่ได้ save ไหม
  const [newLocKey, setNewLocKey] = useState('');           // input ชื่อ location ใหม่
  const [newLocPort, setNewLocPort] = useState('');         // port ที่เลือกสำหรับ location ใหม่
  const [newLocType, setNewLocType] = useState('register'); // type ของ location ใหม่
  // filter Readers Config
  const [readerSearch, setReaderSearch] = useState('')
  const [readerTypeFilter, setReaderTypeFilter] = useState('')

  // filter Location Ports
  const [locSearch, setLocSearch] = useState('')
  const [locTypeFilter, setLocTypeFilter] = useState('')

  // filter readers ตาม search และ type และ status
  const filteredReaders = readers.filter(r => {
    const matchSearch = !readerSearch ||
      r.ip?.includes(readerSearch) ||
      r.location?.toLowerCase().includes(readerSearch.toLowerCase())
    const matchType = !readerTypeFilter || r.type === readerTypeFilter
    return matchSearch && matchType
  })

  // filter location ports ตาม search และ type
  const filteredLocations = Object.entries(locationPorts).filter(([key, val]) => {
    const matchSearch = !locSearch ||
      key.toLowerCase().includes(locSearch.toLowerCase())
    const matchType = !locTypeFilter || val.type === locTypeFilter
    return matchSearch && matchType
  })

  // ---- INIT ----
  useEffect(() => {
    fetchConfig();
    fetchLocationPorts();
    fetchStatus(); // โหลด status ครั้งแรกทันที

    // poll status ทุก 3 วิ เพื่ออัปเดต connected/disconnected แบบ real-time
    const interval = setInterval(fetchStatus, 3000);
    return () => clearInterval(interval); // cleanup เมื่อ component unmount
  }, []);

  // ---- FETCH ----

  // โหลด readers_config.json จาก backend
  const fetchConfig = async () => {
    try {
      const res = await backendApi.get('/readers-config');
      setReaders(res.data);
      setEdited(false);
    } catch {
      Swal.fire({ icon: 'error', title: 'Failed to load config', timer: 1500, showConfirmButton: false });
    }
  };

  // โหลด location_ports.json จาก backend
  const fetchLocationPorts = async () => {
    try {
      const res = await backendApi.get('/location-ports');
      setLocationPorts(res.data);
    } catch {
      Swal.fire({ icon: 'error', title: 'Failed to load location ports', timer: 1500, showConfirmButton: false });
    }
  };

  // โหลดสถานะ connected ของแต่ละ reader จาก Python process (/status endpoint)
  const fetchStatus = async () => {
    try {
      const res = await backendApi.get('/status');
      setStatus(res.data.readers || []);
    } catch { } // ถ้า fail ไม่ต้อง alert — poll ใหม่รอบหน้าเอง
  };

  // ---- HELPERS ----

  // เช็คว่า reader ที่ port นี้ connected ไหม
  // match ด้วย port เพราะ NHT Washing ใช้ 1 process per reader โดยแยกด้วย port
  const isConnected = (port) => {
    return status.find(s => s.port === port)?.connected || false;
  };

  // ---- READER CONFIG ACTIONS ----

  // แก้ไขค่า field ของ reader ที่ index นั้น
  const updateReader = (index, field, value) => {
    setReaders(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
    setEdited(true);
  };

  // เพิ่ม reader ใหม่โดยใช้ port ต่อจาก port สูงสุดที่มีอยู่
  const addReader = () => {
    const maxPort = readers.length > 0 ? Math.max(...readers.map(r => r.port)) : 7999;
    setReaders(prev => [...prev, { ...DEFAULT_READER, port: maxPort + 1 }]);
    setEdited(true);
  };

  // ลบ reader ออกจาก list
  const removeReader = (index) => {
    setReaders(prev => prev.filter((_, i) => i !== index));
    setEdited(true);
  };

  // บันทึก config ลงไฟล์ readers_config.json ผ่าน backend
  // start_rfid.py จะ detect การเปลี่ยนแปลงด้วย md5 hash และ restart process เองใน 3 วิ
  const saveConfig = async () => {
    setLoading(true);
    try {
      await backendApi.put('/readers-config', readers);
      setEdited(false);
      Swal.fire({ icon: 'success', title: 'Saved!', text: 'Changes will apply within 3 seconds', timer: 2000, showConfirmButton: false });
    } catch {
      Swal.fire({ icon: 'error', title: 'Save failed', timer: 1500, showConfirmButton: false });
    } finally {
      setLoading(false);
    }
  };

  // restart Python process ของ reader ที่ port นั้นโดยตรง (main_dll.py — 1 process per reader)
  const restartReader = async (port) => {
    setRestarting(port);
    try {
      await backendApi.post(`/readers-restart/${port}`);
      Swal.fire({ icon: 'success', title: `Reader :${port} restarting...`, timer: 1500, showConfirmButton: false });
    } catch {
      Swal.fire({ icon: 'error', title: 'Restart failed', timer: 1500, showConfirmButton: false });
    } finally {
      setTimeout(() => setRestarting(null), 3000);
    }
  };

  // ---- LOCATION PORTS ACTIONS ----

  // เพิ่ม location ใหม่เข้า locationPorts state (ยังไม่ save จนกว่าจะกด Save)
  const addLocationPort = () => {
    if (!newLocKey || !newLocPort) return;
    setLocationPorts(prev => ({
      ...prev,
      [newLocKey.toUpperCase()]: { port: parseInt(newLocPort), type: newLocType }
    }));
    setNewLocKey('');
    setNewLocPort('');
    setLocEdited(true);
  };

  // ลบ location ออกจาก locationPorts state
  const removeLocationPort = (key) => {
    setLocationPorts(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLocEdited(true);
  };

  // บันทึก location_ports.json ผ่าน backend
  const saveLocationPorts = async () => {
    try {
      await backendApi.put('/location-ports', locationPorts);
      setLocEdited(false);
      Swal.fire({ icon: 'success', title: 'Location Ports Saved!', timer: 1500, showConfirmButton: false });
    } catch {
      Swal.fire({ icon: 'error', title: 'Save failed', timer: 1500, showConfirmButton: false });
    }
  };

  // ---- RENDER ----
  return (
    <div className="flex gap-4 h-full">

      {/* ===================== ซ้าย — Reader Configuration ===================== */}
      <div className="flex flex-col gap-3 flex-1 min-w-0 overflow-hidden">

        {/* Header: แสดงจำนวน reader และปุ่ม Reset / Add / Save */}
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center justify-between shrink-0">
          <p className="text-xs font-medium text-gray-500">
            Readers Config ({readers.length})
          </p>
          <div className="flex gap-2">
            <button
              onClick={fetchConfig}
              disabled={!edited}
              className="h-8 px-3 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            >
              Reset
            </button>
            <button
              onClick={addReader}
              className="h-8 px-3 text-xs rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50"
            >
              + Add
            </button>
            <button
              onClick={saveConfig}
              disabled={!edited || loading}
              className="h-8 px-3 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
            >
              {loading ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
        {/* Filter bar */}
        <div className="flex gap-2 px-2 pb-2 shrink-0 flex-wrap">
          <input
            type="text"
            placeholder="Search IP / Location..."
            value={readerSearch}
            onChange={e => setReaderSearch(e.target.value)}
            className="h-7 px-2 text-xs border border-gray-200 rounded-lg w-44 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <select
            value={readerTypeFilter}
            onChange={e => setReaderTypeFilter(e.target.value)}
            className="h-7 px-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">All types</option>
            {READER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
          <span className="text-xs text-gray-400 self-center">{filteredReaders.length} readers</span>
        </div>

        {/* Table: แสดง reader ทุกตัว พร้อม status real-time */}
        <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">
          <div className="overflow-y-auto overflow-x-auto flex-1">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {['Status', 'ID', 'On', 'Type', 'IP Address', 'Power', 'Location', 'Parts', 'MinQTY', 'Action'].map(col => (
                    <th key={col} className="text-left px-2 py-2 text-xs font-medium text-gray-400 border-b border-gray-100 whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filteredReaders.map((r, i) => (
                  <tr key={i} className={`border-b border-gray-50 hover:bg-gray-50 ${r.enabled === false ? 'opacity-40' : ''}`}>

                    {/* STATUS — poll จาก /status ทุก 3 วิ match ด้วย port */}
                    <td className="px-2 py-2">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full text-[10px] font-medium
                        ${isConnected(r.port)
                          ? 'bg-green-50 text-green-600'
                          : 'bg-red-50 text-red-500'}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${isConnected(r.port) ? 'bg-green-500' : 'bg-red-400'}`} />
                        {isConnected(r.port) ? 'Online' : 'Offline'}
                      </span>
                    </td>

                    {/* PORT — ใช้เป็น ID ของ process นั้น (main_dll.py 1 process per port) */}
                    <td className="px-2 py-2">
                      <input type="number" value={r.port}
                        onChange={e => updateReader(i, 'port', parseInt(e.target.value))}
                        className="w-16 h-7 px-1.5 text-xs font-mono border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>

                    {/* ENABLED — toggle เปิด/ปิด reader ถ้าปิด start_rfid.py จะ kill process */}
                    <td className="px-2 py-2">
                      <input type="checkbox"
                        checked={r.enabled !== false}
                        onChange={e => updateReader(i, 'enabled', e.target.checked)}
                        className="w-4 h-4 accent-blue-600"
                      />
                    </td>

                    {/* TYPE — ประเภท reader กำหนด logic ใน main_dll.py */}
                    <td className="px-2 py-2">
                      <select value={r.type}
                        onChange={e => updateReader(i, 'type', e.target.value)}
                        className="h-7 px-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        {READER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>

                    {/* IP — IP ของ RFID reader hardware (TCP port 6000) */}
                    <td className="px-2 py-2">
                      <input type="text" value={r.ip}
                        onChange={e => updateReader(i, 'ip', e.target.value)}
                        className="w-32 h-7 px-1.5 text-xs font-mono border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>

                    {/* POWER — กำลังส่งสัญญาณ RFID (dBm) max 30 */}
                    <td className="px-2 py-2">
                      <input type="number" max="30" value={r.power}
                        onChange={e => updateReader(i, 'power', parseInt(e.target.value))}
                        className="w-12 h-7 px-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>

                    {/* LOCATION — ชื่อตำแหน่งของ reader เช่น BFW1, BFW2 ใช้ใน AS400 trackId */}
                    <td className="px-2 py-2">
                      <input type="text" value={r.location}
                        onChange={e => updateReader(i, 'location', e.target.value)}
                        className="w-20 h-7 px-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>

                    {/* MACHINE PARTS — เฉพาะ type on_machine: part_no ที่เครื่องนี้รองรับ คั่นด้วย comma */}
                    <td className="px-2 py-2">
                      {r.type === 'on_machine' ? (
                        <input type="text"
                          value={(r.machine_parts || []).join(', ')}
                          onChange={e => updateReader(i, 'machine_parts',
                            e.target.value.split(',').map(s => s.trim()).filter(Boolean)
                          )}
                          placeholder="part1, part2"
                          className="w-36 h-7 px-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </td>

                    {/* MIN QTY — เฉพาะ type on_machine: จำนวน tray ขั้นต่ำที่ต้องอยู่บน reader */}
                    <td className="px-2 py-2">
                      {r.type === 'on_machine' ? (
                        <input type="number" value={r.min_qty || 0}
                          onChange={e => updateReader(i, 'min_qty', parseInt(e.target.value))}
                          className="w-16 h-7 px-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </td>

                    {/* ACTION — restart process ของ reader นี้ หรือลบออกจาก config */}
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => restartReader(r.port)}
                          disabled={restarting === r.port}
                          className="h-7 px-2 text-xs rounded-lg bg-yellow-50 text-yellow-600 border border-yellow-200 hover:bg-yellow-100 disabled:opacity-50"
                        >
                          {restarting === r.port ? '...' : '↺'}
                        </button>
                        <button
                          onClick={() => removeReader(i)}
                          className="h-7 px-2 text-xs rounded-lg bg-red-50 text-red-400 border border-red-200 hover:bg-red-100"
                        >
                          ✕
                        </button>
                      </div>
                    </td>

                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      {/* ===================== ขวา — Location Ports ===================== */}
      {/* เชื่อม location name (เช่น BFW1) กับ port ของ reader ที่รับผิดชอบ location นั้น */}
      {/* ใช้โดย React frontend ใน loadLocationPorts() เพื่อรู้ว่าจะยิง API ไป Python port ไหน */}
      <div className="flex flex-col gap-3 w-72 shrink-0">

        {/* Header */}
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center justify-between shrink-0">
          <p className="text-xs font-medium text-gray-500">Location Ports</p>
          <div className="flex gap-2">
            <button
              onClick={fetchLocationPorts}
              disabled={!locEdited}
              className="h-8 px-3 text-xs rounded-lg border border-gray-200 text-gray-500 hover:bg-gray-50 disabled:opacity-40"
            >
              Reset
            </button>
            <button
              onClick={saveLocationPorts}
              disabled={!locEdited}
              className="h-8 px-3 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
            >
              Save
            </button>
          </div>
        </div>
        {/* Filter bar */}
        <div className="flex gap-2 px-3 py-2 border-b border-gray-100 shrink-0">
          <input
            type="text"
            placeholder="Search location..."
            value={locSearch}
            onChange={e => setLocSearch(e.target.value)}
            className="h-7 px-2 text-xs border border-gray-200 rounded-lg flex-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
          />
          <select
            value={locTypeFilter}
            onChange={e => setLocTypeFilter(e.target.value)}
            className="h-7 px-2 text-xs border border-gray-200 rounded-lg focus:outline-none focus:ring-1 focus:ring-blue-400"
          >
            <option value="">All types</option>
            {LOCATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </div>

        {/* List + Add form */}
        <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">

          {/* List: แสดง location ที่มีอยู่ */}
          <div className="overflow-y-auto flex-1">
            {Object.entries(locationPorts).length === 0 && (
              <p className="text-center py-8 text-gray-300 text-xs">No location ports</p>
            )}
            {filteredLocations.map(([key, val]) => (
              <div key={key} className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono font-medium text-gray-700">{key}</p>
                  {/* val.type = register/washing, val.port = Python process port */}
                  <p className="text-[10px] text-gray-400">{val.type} · port {val.port}</p>
                </div>
                <button
                  onClick={() => removeLocationPort(key)}
                  className="h-6 px-2 text-[10px] rounded bg-red-50 text-red-400 border border-red-100 hover:bg-red-100 shrink-0"
                >
                  ✕
                </button>
              </div>
            ))}
          </div>

          {/* Add form: เพิ่ม location ใหม่ */}
          <div className="border-t border-gray-100 p-3 flex flex-col gap-2 shrink-0">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Add Location</p>

            {/* ชื่อ location เช่น BFW1, W1 — จะถูก uppercase อัตโนมัติ */}
            <input
              type="text"
              value={newLocKey}
              onChange={e => setNewLocKey(e.target.value.toUpperCase())}
              placeholder="Location (e.g. BFW1)"
              className="h-8 px-2 text-xs border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-blue-400"
            />

            <div className="flex gap-2">
              {/* เลือก reader จาก list ที่ enabled และตรง type กับ newLocType */}
              <select
                value={newLocPort}
                onChange={e => setNewLocPort(e.target.value)}
                className="h-8 px-2 text-xs border border-gray-200 rounded-lg flex-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">Select Reader</option>
                {readers
                  .filter(r => r.enabled !== false && r.type === newLocType)
                  .map(r => (
                    <option key={r.port} value={r.port}>
                      {r.port} — {r.location} ({r.ip})
                    </option>
                  ))
                }
              </select>

              {/* type ของ location — กำหนดว่า frontend จะใช้ reader นี้ทำอะไร */}
              <select
                value={newLocType}
                onChange={e => setNewLocType(e.target.value)}
                className="h-8 px-2 text-xs border border-gray-200 rounded-lg flex-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                {LOCATION_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
              </select>
            </div>

            <button
              onClick={addLocationPort}
              disabled={!newLocKey || !newLocPort}
              className="h-8 w-full text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
            >
              + Add Location
            </button>
          </div>
        </div>
      </div>

    </div>
  );
};

export default ReaderConfig;