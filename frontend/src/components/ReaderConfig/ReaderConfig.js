import React, { useState, useEffect } from 'react';
import { backendApi } from '../../config/instance';
import Swal from 'sweetalert2';

const READER_TYPES = ['register', 'pallet', 'washing', 'on_machine', 'completed'];
const LOCATION_TYPES = ['register', 'washing']; // แค่ 2 type ที่มีหน้าจอ monitor

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
  const [readers, setReaders] = useState([]);
  const [edited, setEdited] = useState(false);
  const [loading, setLoading] = useState(false);
  const [restarting, setRestarting] = useState(null);

  const [locationPorts, setLocationPorts] = useState({});
  const [locEdited, setLocEdited] = useState(false);
  const [newLocKey, setNewLocKey] = useState('');
  const [newLocPort, setNewLocPort] = useState('');
  const [newLocType, setNewLocType] = useState('register');

  useEffect(() => {
    fetchConfig();
    fetchLocationPorts();
  }, []);

  const fetchConfig = async () => {
    try {
      const res = await backendApi.get('/readers-config');
      setReaders(res.data);
      setEdited(false);
    } catch {
      Swal.fire({ icon: 'error', title: 'Failed to load config', timer: 1500, showConfirmButton: false });
    }
  };

  const fetchLocationPorts = async () => {
    try {
      const res = await backendApi.get('/location-ports');
      setLocationPorts(res.data);
    } catch {
      Swal.fire({ icon: 'error', title: 'Failed to load location ports', timer: 1500, showConfirmButton: false });
    }
  };

  const updateReader = (index, field, value) => {
    setReaders(prev => prev.map((r, i) => i === index ? { ...r, [field]: value } : r));
    setEdited(true);
  };

  const addReader = () => {
    const maxPort = readers.length > 0 ? Math.max(...readers.map(r => r.port)) : 7999;
    setReaders(prev => [...prev, { ...DEFAULT_READER, port: maxPort + 1 }]);
    setEdited(true);
  };

  const removeReader = (index) => {
    setReaders(prev => prev.filter((_, i) => i !== index));
    setEdited(true);
  };

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
  };//(main_dll)

  // const restartReader = async (index) => { (main_multi)
  //   setRestarting(index);
  //   try {
  //     await backendApi.post(`/readers-restart/${index}`);
  //     Swal.fire({ icon: 'success', title: `Reader :${index} restarting...`, timer: 1500, showConfirmButton: false });
  //   } catch {
  //     Swal.fire({ icon: 'error', title: 'Restart failed', timer: 1500, showConfirmButton: false });
  //   } finally {
  //     setTimeout(() => setRestarting(null), 3000);
  //   }
  // };

  const addLocationPort = () => {
    if (!newLocKey || !newLocPort) return;
    setLocationPorts(prev => ({
      ...prev,
      [newLocKey.toUpperCase()]: { port: parseInt(newLocPort), type: newLocType }
    })); //(main_dll)

    // const addLocationPort = () => { (main_multi)
    //   if (!newLocKey || !newLocPort) return;
    //   setLocationPorts(prev => ({
    //     ...prev,
    //     [newLocKey.toUpperCase()]: { index: parseInt(newLocPort), type: newLocType }
    //   }));

    setNewLocKey('');
    setNewLocPort('');
    setLocEdited(true);
  };

  const removeLocationPort = (key) => {
    setLocationPorts(prev => {
      const next = { ...prev };
      delete next[key];
      return next;
    });
    setLocEdited(true);
  };

  const saveLocationPorts = async () => {
    try {
      await backendApi.put('/location-ports', locationPorts);
      setLocEdited(false);
      Swal.fire({ icon: 'success', title: 'Location Ports Saved!', timer: 1500, showConfirmButton: false });
    } catch {
      Swal.fire({ icon: 'error', title: 'Save failed', timer: 1500, showConfirmButton: false });
    }
  };

  return (
    <div className="flex gap-4 h-full">

      {/* ซ้าย — Reader Configuration */}
      <div className="flex flex-col gap-3 flex-1 min-w-0 overflow-hidden">

        {/* header */}
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

        {/* table */}
        <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">
          <div className="overflow-y-auto overflow-x-auto flex-1">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {['ID', 'On', 'Type', 'IP Address', 'Power', 'Location', 'Parts', 'MinQTY', 'Action'].map(col => (
                    <th key={col} className="text-left px-2 py-2 text-xs font-medium text-gray-400 border-b border-gray-100 whitespace-nowrap">
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {readers.map((r, i) => (
                  <tr key={i} className={`border-b border-gray-50 hover:bg-gray-50 ${r.enabled === false ? 'opacity-40' : ''}`}>

                    {/* Port */}
                    <td className="px-2 py-2">
                      <input type="number" value={r.port}
                        onChange={e => updateReader(i, 'port', parseInt(e.target.value))}
                        className="w-16 h-7 px-1.5 text-xs font-mono border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>

                    {/* Enable */}
                    <td className="px-2 py-2">
                      <input type="checkbox"
                        checked={r.enabled !== false}
                        onChange={e => updateReader(i, 'enabled', e.target.checked)}
                        className="w-4 h-4 accent-blue-600"
                      />
                    </td>

                    {/* Type */}
                    <td className="px-2 py-2">
                      <select value={r.type}
                        onChange={e => updateReader(i, 'type', e.target.value)}
                        className="h-7 px-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      >
                        {READER_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </td>

                    {/* IP */}
                    <td className="px-2 py-2">
                      <input type="text" value={r.ip}
                        onChange={e => updateReader(i, 'ip', e.target.value)}
                        className="w-32 h-7 px-1.5 text-xs font-mono border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>

                    {/* Power */}
                    <td className="px-2 py-2">
                      <input type="number" max="30" value={r.power}
                        onChange={e => updateReader(i, 'power', parseInt(e.target.value))}
                        className="w-12 h-7 px-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>

                    {/* Location */}
                    <td className="px-2 py-2">
                      <input type="text" value={r.location}
                        onChange={e => updateReader(i, 'location', e.target.value)}
                        className="w-20 h-7 px-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                      />
                    </td>

                    {/* Machine Parts */}
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

                    {/* Min QTY */}
                    <td className="px-2 py-2">
                      {r.type === 'on_machine' ? (
                        <input type="number" value={r.min_qty || 0}
                          onChange={e => updateReader(i, 'min_qty', parseInt(e.target.value))}
                          className="w-16 h-7 px-1.5 text-xs border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-400"
                        />
                      ) : <span className="text-xs text-gray-300">—</span>}
                    </td>

                    {/* Actions */}
                    <td className="px-2 py-2">
                      <div className="flex gap-1">
                        <button
                          onClick={() => restartReader(r.port)}
                          disabled={restarting === r.port}
                          // onClick={() => restartReader(i)}
                          // disabled={restarting === i}
                          className="h-7 px-2 text-xs rounded-lg bg-yellow-50 text-yellow-600 border border-yellow-200 hover:bg-yellow-100 disabled:opacity-50"
                        >
                          {restarting === r.port ? '...' : '↺'}
                          {/* {restarting === i ? '...' : '↺'} */}
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

      {/* ขวา — Location Ports */}
      <div className="flex flex-col gap-3 w-72 shrink-0">

        {/* header */}
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3 flex items-center justify-between shrink-0">
          <p className="text-xs font-medium text-gray-500">
            Location Ports
          </p>
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

        {/* list */}
        <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">
          <div className="overflow-y-auto flex-1">
            {Object.entries(locationPorts).length === 0 && (
              <p className="text-center py-8 text-gray-300 text-xs">No location ports</p>
            )}
            {Object.entries(locationPorts).map(([key, val]) => (
              <div key={key} className="flex items-center gap-2 px-3 py-2.5 border-b border-gray-50 hover:bg-gray-50">
                <div className="flex-1 min-w-0">
                  <p className="text-xs font-mono font-medium text-gray-700">{key}</p>
                  <p className="text-[10px] text-gray-400">{val.type} · port {val.port}</p> {/* (main_dll) */}
                  {/* <p className="text-[10px] text-gray-400">{val.type} · index {val.index}</p> (main_multi) */}
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

          {/* Add form */}
          <div className="border-t border-gray-100 p-3 flex flex-col gap-2 shrink-0">
            <p className="text-[10px] text-gray-400 uppercase tracking-wider">Add Location</p>
            <input
              type="text"
              value={newLocKey}
              onChange={e => setNewLocKey(e.target.value.toUpperCase())}
              placeholder="Location"
              className="h-8 px-2 text-xs border border-gray-200 rounded-lg w-full focus:outline-none focus:ring-1 focus:ring-blue-400"
            />
            <div className="flex gap-2">
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
              {/* <select
                value={newLocPort}
                onChange={e => setNewLocPort(e.target.value)}
                className="h-8 px-2 text-xs border border-gray-200 rounded-lg flex-1 focus:outline-none focus:ring-1 focus:ring-blue-400"
              >
                <option value="">Select Reader</option>
                {readers
                  .filter(r => r.enabled !== false && r.type === newLocType)
                  .map(r => {
                    const idx = readers
                      .filter(x => x.enabled !== false)
                      .indexOf(r);
                    return (
                      <option key={idx} value={idx}>
                        {idx} — {r.location} ({r.ip})
                      </option>
                    );
                  })
                }
              </select> */}
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