import React, { useState, useEffect } from 'react';
import { backendApi } from '../../config/instance';

const TYPE_LABEL = {
  register: 'Register',
  pallet: 'Pallet',
  washing: 'Washing',
  on_machine: 'On Machine',
  completed: 'Completed',
};

const TYPE_ICON = {
  register: '📝',
  pallet: '📥',
  washing: '🧪',
  on_machine: '🖥️',
  completed: '📁',
};

const ReaderStatus = () => {
  const [readers, setReaders] = useState([]);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    const fetch = async () => {
      try {
        const res = await backendApi.get('/status');
        setReaders(res.data.readers || []);
      } catch { }
    };
    fetch();
    const interval = setInterval(fetch, 3000);
    return () => clearInterval(interval);
  }, []);

  const filtered = readers
    .filter(r => filter === 'all' || r.type === filter)
    .filter(r => !search || r.type?.includes(search)|| r.ip?.includes(search) || r.location?.includes(search.toUpperCase()));

  const types = ['all', ...new Set(readers.map(r => r.type))];

  return (
    <div className="flex flex-col gap-4">

      {/* SEARCH FILTER */}
      <div className="flex gap-2 flex-wrap items-center">

        {/* search input */}
        <input
          type="text"
          placeholder="Search IP / Location..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="h-8 px-3 text-xs border border-gray-200 rounded-lg bg-gray-50 w-48
                               focus:outline-none focus:ring-1 focus:ring-blue-400"
        />

        {/* filter buttons */}
        {types.map(t => (
          <button
            key={t}
            onClick={() => setFilter(t)}
            className={`h-8 px-3 text-xs rounded-lg border transition-colors ${filter === t
              ? 'bg-blue-600 text-white border-blue-600'
              : 'bg-white text-gray-500 border-gray-200 hover:bg-gray-50'
              }`}
          >
            {t === 'all' ? `All (${readers.length})` : `${TYPE_LABEL[t]} (${readers.filter(r => r.type === t).length})`}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Status</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Type</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">IP Address</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Location</th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-400">Port</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.map((r, i) => (
              <tr key={i} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <span className={`inline-flex items-center gap-2 px-2 py-1 rounded-full text-[10px] font-medium
              ${r.connected ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${r.connected ? 'bg-green-500' : 'bg-red-500'}`} />
                    {r.connected ? 'Connected' : 'Disconnected'}
                  </span>
                </td>
                <td className="px-4 py-3 text-gray-700">
                  <span className="mr-2">{TYPE_ICON[r.type]}</span>
                  {TYPE_LABEL[r.type]}
                </td>
                <td className="px-4 py-3 font-mono text-gray-600">{r.ip}</td>
                <td className="px-4 py-3 text-gray-600">{r.location || '—'}</td>
                <td className="px-4 py-3 text-gray-400 font-mono">{r.port}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* ถ้าไม่มี reader */}
      {filtered.length === 0 && (
        <div className="text-center py-12 text-gray-300 text-sm">
          Not found reader
        </div>
      )}

    </div>
  );
};

export default ReaderStatus;