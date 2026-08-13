import React, { useState, useEffect } from 'react';
import { backendApi } from '../../config/instance';
import * as XLSX from 'xlsx';

const STATUS_CONFIG = {
  before_washing: { label: 'Before Washing', pill: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  after_washing: { label: 'After Washing', pill: 'bg-blue-100 text-blue-800', dot: 'bg-blue-600' },
  on_machine: { label: 'On Machine', pill: 'bg-violet-100 text-violet-800', dot: 'bg-violet-600' },
  waiting_register: { label: 'Waiting Register', pill: 'bg-gray-100 text-gray-800', dot: 'bg-gray-600' },
  registered: { label: 'Registered', pill: 'bg-cyan-100 text-cyan-800', dot: 'bg-cyan-600' },
  completed: { label: 'Completed', pill: 'bg-emerald-100 text-emerald-800', dot: 'bg-emerald-600' },

};

const COLUMNS = [
  '#ID',
  'Barcode',
  'Sub Process',
  'Lot No.',
  'Material No.',
  'Part No.',
  'Machine No.',
  'Process Code',
  'Process',
  'Coil',
  'IR Diameter',
  'RW Diameter',
  'Process Date',
  'Quantity',
  'Tray QTY',
  'Tray Counter',
  'Tray Done',
  'Location',
  'Updated Date',
];

const History = () => {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  // const [date, setDate] = useState(() => new Date().toISOString().split('T')[0]);
  const [date, setDate] = useState('');
  const [search, setSearch] = useState('');
  const [filterSub, setFilterSub] = useState('');
  const [countdown, setCountdown] = useState(60);

  const fetchLogs = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await backendApi.get('/history');
      setLogs(res.data);
    } catch (err) {
      setError('Cannot connect to server');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchLogs();

    const tick = setInterval(() => {
        setCountdown(prev => {
            if (prev <= 1) {
                fetchLogs();
                return 60;
            }
            return prev - 1;
        });
    }, 1000);

    return () => clearInterval(tick);
}, []);
  // Export Excel
  const exportExcel = () => {
    const exportData = filtered.map((row, i) => ({
      'ID': i + 1,
      'Barcode': row.barcode || '',
      'Sub Process': row.sub_process || '',
      'Lot No.': row.lot_no || '',
      'Material No.': row.material_no || '',
      'Part No.': row.part_no || '',
      'Machine No.': row.machine_no || '',
      'Process Code': row.process_code || '',
      'Process': row.process || '',
      'Coil': row.coil || '',
      'IR Diameter': row.ir_diameter || '',
      'RW Diameter': row.rw_diameter || '',
      'Process Date': row.process_date || '',
      'Quantity': row.quantity || '',
      'Tray QTY': row.tray_qty || '',
      'Tray Counter': row.tray_counter || '',
      'Tray Done': row.tray_done || '',
      'Location': row.location || '',
      'Created Date': row.updated_at || '',
    }));

    const ws = XLSX.utils.json_to_sheet(exportData);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'History');
    XLSX.writeFile(wb, `rfid_history_${date || 'all'}.xlsx`);
  };


  //  Filter
  const filtered = logs.filter((row) => {

    // filter search barcode และ tag id
    const matchSearch = search === ''
      || row.barcode?.toLowerCase().includes(search.toLowerCase())

    // filter sub_process
    const matchSub = filterSub === '' || row.sub_process === filterSub;

    // filter date
    const matchDate = date === '' || row.created_at?.startsWith(date);

    return matchSearch && matchSub && matchDate;
  });

  // Reset filter 
  const handleReset = () => {
    setSearch('');
    setFilterSub('');
    setDate('');
    // setDate(new Date().toISOString().split('T')[0]);
  };

  // Format date
  const formatDate = (val) => {
    if (!val) return '—';
    return new Date(val).toLocaleString('th-TH');
  };

  const formatDateOnly = (val) => {
    if (!val) return '—';
    return new Date(val).toLocaleDateString('th-TH');
  };

  return (
    <div className="flex flex-col gap-3 h-full">

      {/* FILTER BAR */}
      <div className="flex items-center gap-2 flex-wrap">

        {/* วันที่ */}
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-8 px-2 text-xs border border-gray-200 rounded-lg bg-white text-gray-700
                     focus:outline-none focus:ring-1 focus:ring-blue-400"
        />

        {/* ค้นหา barcode */}
        <input
          type="text"
          placeholder="Search barcode..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="h-8 px-3 text-xs border border-gray-200 rounded-lg bg-white text-gray-700 w-48
                     focus:outline-none focus:ring-1 focus:ring-blue-400"
        />

        {/* filter sub_process */}
        <select
          value={filterSub}
          onChange={(e) => setFilterSub(e.target.value)}
          className="h-8 px-2 text-xs border border-gray-200 rounded-lg bg-white text-gray-700
                     focus:outline-none focus:ring-1 focus:ring-blue-400"
        >
          <option value="">All status</option>
          <option value="waiting_register">Waiting Register</option>
          <option value="before_washing">Before Washing</option>
          <option value="after_washing">After Washing</option>
          <option value="on_machine">On Machine</option>
          <option value="completed">Completed</option>
        </select>

        {/* reset */}
        <button
          onClick={handleReset}
          className="h-8 px-3 text-xs border border-gray-200 rounded-lg bg-white text-gray-600 hover:bg-gray-50"
        >
          Reset
        </button>

        {/* refresh */}
        {/* <button
          onClick={fetchLogs}
          className="h-8 px-3 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 ml-auto"
        >
          ↻ Refresh
        </button> */}
        
        <button
          onClick={exportExcel}
          className="h-8 px-3 text-xs rounded-lg bg-green-600 text-white hover:bg-green-700"
        >
          Export Excel
        </button>

        <span className="text-xs text-red-400 ml-auto">
          Auto refresh in {countdown}s
        </span>

        <span className='text-gray-400'>/</span>

        {/* นับ event */}
        <span className="text-xs text-gray-400">
          Showing {filtered.length} events
        </span>

      </div>

      {/* ERROR */}
      {error && (
        <div className="text-xs text-red-500 bg-red-50 border border-red-100 rounded-lg px-3 py-2">
          ❌ {error}
        </div>
      )}

      {/* TABLE */}
      <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">

        <div className="overflow-y-auto flex-1">
          <table className="w-full text-xs">

            {/* Header sticky */}
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr>
                {COLUMNS.map((col) => (
                  <th
                    key={col}
                    className="text-left px-3 py-2 text-[10px] font-medium text-gray-400
                               border-b border-gray-100 whitespace-nowrap"
                  >
                    {col}
                  </th>
                ))}
              </tr>
            </thead>

            <tbody>

              {/* Loading */}
              {loading && (
                <tr>
                  <td colSpan={COLUMNS.length} className="text-center py-10 text-gray-300 text-xs">
                    Loading...
                  </td>
                </tr>
              )}

              {/* Data */}
              {!loading && filtered.map((row, i) => {
                const sc = STATUS_CONFIG[row.sub_process] || {};
                return (
                  <tr
                    key={row.id}
                    className="border-b border-gray-50 hover:bg-gray-50 transition-colors"
                  >

                    <td className="px-3 py-2 text-gray-400">
                      {i + 1}
                    </td>

                    {/* <td className="px-3 py-2 font-mono text-gray-500">
                      {row.tag_id || '—'}
                    </td> */}

                    <td className="px-3 py-2 font-mono font-medium text-gray-800">
                      {row.barcode || '—'}
                    </td>


                    {/* Sub Process pill */}
                    <td className="px-3 py-2">
                      {sc.label ? (
                        <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[10px] font-medium whitespace-nowrap ${sc.pill}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${sc.dot}`} />
                          {sc.label}
                        </span>
                      ) : (
                        <span className="text-gray-300">{row.sub_process || '—'}</span>
                      )}
                    </td>

                    <td className="px-3 py-2 text-gray-500">
                      {row.lot_no || '—'}
                    </td>

                    <td className="px-3 py-2 text-gray-500">
                      {row.material_no || '—'}
                    </td>

                    <td className="px-3 py-2 font-medium text-gray-700 whitespace-nowrap">
                      {row.part_no || '—'}
                    </td>

                    <td className="px-3 py-2 text-gray-500">
                      {row.machine_no || '—'}
                    </td>

                    <td className="px-3 py-2 text-gray-500">
                      {row.process_code || '—'}
                    </td>

                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                      {row.process || '—'}
                    </td>

                    <td className="px-3 py-2 text-gray-500">
                      {row.coil || '-'}
                    </td>

                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                      {row.ir_diameter || '-'}
                    </td>

                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                      {row.rw_diameter || '-'}
                    </td>

                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">
                      {formatDateOnly(row.process_date)}
                    </td>

                    <td className="px-3 py-2 text-gray-700">
                      {row.quantity?.toLocaleString() || '—'}
                    </td>

                    <td className="px-3 py-2 text-gray-500">
                      {row.tray_qty || '-'}
                    </td>

                    <td className="px-3 py-2 text-gray-500">
                      {row.tray_counter || '-'}
                    </td>

                    <td className="px-3 py-2 text-gray-500">
                      {row.tray_done || '-'}
                    </td>
                    {/* Location */}
                    <td className="px-3 py-2 text-gray-500">
                      {row.location || '—'}
                    </td>

                    {/* Update Date */}
                    <td className="px-3 py-2 text-gray-400 whitespace-nowrap">
                      {formatDate(row.updated_at)}
                    </td>

                  </tr>
                );
              })}

              {/* ไม่มีข้อมูล */}
              {!loading && filtered.length === 0 && (
                <tr>
                  <td colSpan={COLUMNS.length} className="text-center py-10 text-gray-300 text-xs">
                    No records found
                  </td>
                </tr>
              )}

            </tbody>
          </table>
        </div>

      </div>

    </div>
  );
};

export default History;