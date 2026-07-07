import React, { useState, useEffect, useRef } from 'react';
import { backendApi, pythonApi, jobTicketApi, urlParameter } from '../../config/instance';
import { useSearchParams } from 'react-router-dom';
// import { getOperator } from '../../config/auth';
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

const InfoField = ({ label, value, mono = false }) => {
  const isEmpty = value === null || value === undefined || value === '';
  return (
    <div className="bg-white border border-gray-100 rounded-xl p-4">
      <p className="text-[11px] text-gray-400 uppercase tracking-wider mb-1">
        {label}
      </p>
      <p className={`text-sm font-medium ${isEmpty ? 'text-gray-300' : 'text-gray-800'} ${mono ? 'font-mono' : ''}`}>
        {isEmpty ? '—' : value}
      </p>
    </div>
  );
};

const Register = () => {

  const [searchParams] = useSearchParams();
  const location = searchParams.get('location');
  const deviceApi = urlParameter(location) || pythonApi;

  // State
  const [barcode, setBarcode] = useState('');
  const [info, setInfo] = useState(null);    // ข้อมูลจาก API
  const [lotSaved, setLotSaved] = useState(false);   // INSERT lot แล้วไหม
  const [tagId, setTagId] = useState('');      // tag ล่าสุดที่ scan
  const [trayDone, setTrayDone] = useState(0);       // scan tag ไปแล้วกี่อัน
  const [trayCounter, setTrayCounter] = useState(0);       // ต้องการทั้งหมดกี่อัน
  const [loading, setLoading] = useState(false);
  const [trayQty, setTrayQty] = useState(0); // จำนวนชิ้นต่อ tray

  const inputRef = useRef(null);
  const confirmRef = useRef(null);


  // ไปช่อง input แรก
  useEffect(() => {
    if (!lotSaved) {
      setTimeout(() => {
        inputRef.current?.focus();
      }, 50);
    }
  }, [lotSaved]);

  // new-tag ทุก 500ms
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        // const res = await pythonApi.get('/new-tag');
        const res = await deviceApi.get('/new-tag');
        if (res.data.tag_id) {
          setTagId(res.data.tag_id);
        }
      } catch {
      }
    }, 1000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location]);

  // ถ้าได้ tag และ lot saved แล้ว → registerTray อัตโนมัติ
  useEffect(() => {
    if (!tagId) return;

    if (!lotSaved) {
      showAlert('Please confirm lot first!', 'warning');
      setTagId('');
      return;
    }

    registerTray(tagId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagId]);

  //กด Enter ที่ปุ่ม Confirm
  useEffect(() => {
    if (info && !lotSaved) {
      confirmRef.current?.focus();
    }
  }, [info, lotSaved]);


  //  ดึงข้อมูลจาก API Jobticket
  const fetchInfo = async (value) => {
    const target = value || barcode.trim();
    if (!target) return;
    setLoading(true);

    try {
      const res = await backendApi.get(`/job-ticket/${target.trim()}`);
      const data = res.data;

      setInfo({
        job_ticket_no: data.job_ticket_no,
        lot_no: data.lot_no,
        material_lot: data.material_lot,
        part_no: data.part_no,
        machine_no: data.machine_number,
        process_code: data.process_code,
        process: data.process,
        coil: data.coil,
        ir_diameter: data.id_diameter,
        rw_diameter: data.rw_diameter,
        date: data.date,
        quantity: data.quantity,
      });

      showAlert('Job ticket found!', 'success');

    } catch {
      setInfo(null);
      showAlert('Barcode not found!', 'error');
    } finally {
      setLoading(false);
    }
  };

  // Confirm INSERT lot
  const registerLot = async () => {
    if (!info) {
      showAlert('Please scan barcode first!', 'warning');
      return;
    }

    // const operator = getOperator();
    setLoading(true);

    try {
      const res = await backendApi.post('/register-lot', {
        barcode: info.job_ticket_no,
        lot_no: info.lot_no,
        material_no: info.material_lot,
        part_no: info.part_no,
        machine_no: info.machine_no,
        process_code: info.process_code,
        process: info.process,
        coil: info.coil,
        ir_diameter: info.ir_diameter,
        rw_diameter: info.rw_diameter,
        process_date: info.date,
        quantity: info.quantity,
        // operator: operator?.emp_code,
      });

      const result = res.data.result;

      if (result === 'OK') {
        setLotSaved(true);
        setTrayCounter(res.data.tray_counter);
        setTrayQty(res.data.tray_qty);
        showAlert('Lot registered! Please scan tags', 'success');

      } else if (result === 'RESUME') {
        // resume ต่อจากที่ค้างไว้
        setLotSaved(true);
        setTrayCounter(res.data.tray_counter);
        setTrayDone(res.data.tray_done);
        showAlert(`Resuming... ${res.data.tray_done}/${res.data.tray_counter} scanned`, 'info');

      } else if (result === 'BARCODE_IN_USE') {
        showAlert('Barcode already in use!', 'error');

      } else if (result === 'PART_NOT_FOUND') {
        showAlert('Part not found in master tray!', 'error');

      } else {
        showAlert(result, 'error');
      }

    } catch (err) {
      showAlert(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  // scan tag INSERT tray
  const registerTray = async (tag) => {
    // const operator = getOperator();

    try {
      const res = await backendApi.post('/register-tray', {
        tag_id: tag,
        barcode: info.job_ticket_no,
        // operator: operator?.emp_code,
      });

      const result = res.data.result;

      if (result === 'OK') {
        const newDone = trayDone + 1;
        setTrayDone(newDone);
        setTagId('');

        // ครบทุก tray
        if (newDone >= trayCounter) {
          showAlert('All trays registered!', 'success');
          clearAll();
        }

      } else if (result === 'TAG_IN_USE') {
        showAlert('Tag already in use!', 'error');
        setTagId('');

      } else if (result === 'TRAY_FULL') {
        showAlert('All trays already scanned!', 'warning');
        setTagId('');

      } else {
        showAlert(result, 'error');
        setTagId('');
      }

    } catch (err) {
      showAlert(err.message, 'error');
    }
  };

  // Clear
  const clearAll = () => {
    setBarcode('');
    setInfo(null);
    setLotSaved(false);
    setTagId('');
    setTrayDone(0);
    setTrayCounter(0);
  };

  return (
    <div className="flex flex-col gap-4 h-full">

      {/* SCAN BARCODE  */}
      <div className="bg-white border border-gray-100 rounded-xl p-3">

        <p className="text-xs font-medium text-gray-500 mb-3">
          Scan barcode
        </p>

        <div className="flex gap-2">
          <input
            ref={inputRef}
            type="text"
            value={barcode}
            onChange={(e) => setBarcode(e.target.value.toUpperCase())}
            onKeyDown={(e) => e.key === 'Enter' && fetchInfo()}
            // สแกนหา tag ใน 1 วิ
            onChange={(e) => {
              setBarcode(e.target.value.toUpperCase());
              clearTimeout(window._barcodeTimer);
              window._barcodeTimer = setTimeout(() => {
                if (e.target.value.trim()) fetchInfo(e.target.value.trim());
              }, 500);
            }}
            // onChange={(e) => setBarcode(e.target.value.toUpperCase())}
            // onKeyDown={(e) => {
            //   if (e.key === 'Enter') {
            //     if (e.target.value.trim()) fetchInfo(e.target.value.trim());
            //   }
            // }}
            placeholder="Waiting for scanner..."
            disabled={loading || lotSaved}
            className="flex-1 h-10 px-3 text-sm font-mono border border-gray-200 rounded-lg
                                   bg-gray-50 text-gray-800 placeholder-gray-300
                                   focus:outline-none focus:ring-1 focus:ring-blue-400
                                   disabled:opacity-50"
          />

          {/* ปุ่ม Confirm INSERT lot */}
          {info && !lotSaved && (
            <button
              ref={confirmRef}
              onClick={registerLot}
              disabled={loading}
              className="h-10 px-4 text-xs rounded-lg bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50"
            >
              Confirm
            </button>
          )}

          <button
            onClick={clearAll}
            className="h-10 px-4 text-xs rounded-lg border border-gray-200 bg-white text-gray-500 hover:bg-gray-50"
          >
            ✕ Clear
          </button>
        </div>

      </div>

      {/* LOT INFO */}
      <div className="grid grid-cols-3 gap-3">
        <InfoField label="Job Ticket" value={info?.job_ticket_no} mono />
        <InfoField label="Lot No." value={info?.lot_no} mono />
        <InfoField label="Material Lot" value={info?.material_lot} mono />
        <InfoField label="Part No." value={info?.part_no} />
        <InfoField label="Machine No." value={info?.machine_no} />
        <InfoField label="Process Code" value={info?.process_code} />
        <InfoField label="Process" value={info?.process} />
        <InfoField label="Coil" value={info?.coil} />
        <InfoField label="Quantity" value={info?.quantity?.toLocaleString()} />
        <InfoField label="IR Diameter" value={info?.ir_diameter} />
        <InfoField label="RW Diameter" value={info?.rw_diameter} />
        <InfoField label="Date" value={info?.date} />
      </div>

      {/* TRAY PROGRESS */}
      {lotSaved && (
        <div className="bg-white border border-gray-100 rounded-xl p-2">

          <p className="text-xs font-medium text-gray-500 mb-3">
            Scan tag
          </p>

          {/* progress */}
          <div className="flex items-center gap-3 mb-3">
            <p className="text-2xl font-semibold text-blue-600">
              {trayDone}/{trayCounter}
            </p>
            <p className="text-sm text-gray-400">trays :</p>
            <span className="text-sm text-gray-400">
              ({trayQty > 0 ? trayQty.toLocaleString() : '-'} PCS/TRY)
            </span>
          </div>

          {/* progress bar */}
          <div className="w-full bg-gray-100 rounded-full h-2">
            <div
              className="bg-blue-600 h-2 rounded-full transition-all duration-300"
              style={{ width: trayCounter > 0 ? `${(trayDone / trayCounter) * 100}%` : '0%' }}
            />
          </div>

          {/* tag id ล่าสุด */}
          <p className={`text-sm font-mono mt-3 ${tagId ? 'text-blue-600' : 'text-gray-300'}`}>
            {tagId || 'Waiting for tag...'}
          </p>

        </div>
      )}

    </div>
  );
};

export default Register;