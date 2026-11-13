import React, { useState, useEffect, useRef, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { backendApi, pythonApi, readerApi } from "../../config/instance";
import Swal from "sweetalert2";

const STEP_LABEL = {
  waiting_register: "Waiting Register",
  registered: "Registered",
  before_washing: "Before Washing",
  after_washing: "After Washing",
  on_machine: "On Machine",
  completed: "Completed",
};

const STEP_BADGE = {
  registered: { bg: "bg-blue-100", text: "text-blue-600" },
  before_washing: { bg: "bg-amber-100", text: "text-amber-600" },
  after_washing: { bg: "bg-emerald-100", text: "text-emerald-600" },
  on_machine: { bg: "bg-violet-100", text: "text-violet-600" },
  completed: { bg: "bg-gray-100", text: "text-gray-500" },
};

const showAlert = (msg, type) => {
  Swal.fire({
    position: "center",
    icon: type,
    title: msg,
    showConfirmButton: false,
    timer: 1800,
  });
};

const formatDate = (str) => {
  try {
    const s = String(str).replace("T", " ").slice(0, 16);
    const [date, time] = s.split(" ");
    const [yyyy, mm, dd] = date.split("-");
    if (!dd || !mm || !yyyy || !time) return "-";
    return `${dd}/${mm}/${yyyy} ${time}`;
  } catch (err) {
    console.error("[Date Formatting Error]:", err);
    return "-";
  }
};

const MultiRegister = () => {
  const [searchParams] = useSearchParams();
  const location = searchParams.get("location");

  // --- States ---
  const [deviceApi, setDeviceApi] = useState(null);
  const [deviceReady, setDeviceReady] = useState(false);
  const [barcode, setBarcode] = useState("");
  const [jobs, setJobs] = useState([]);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [activeJob, setActiveJob] = useState(null);
  const [tagId, setTagId] = useState("");

  const [history, setHistory] = useState([]);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [viewMode, setViewMode] = useState("active");

  const inputRef = useRef(null);

  // --- Effects ---

  useEffect(() => {
    setDeviceReady(false);
    setDeviceApi(() => (location ? readerApi(location) : pythonApi));
    setDeviceReady(true);
  }, [location]);

  useEffect(() => {
    if (location) localStorage.setItem("rfid_location_register", location);
  }, [location]);

  // Focus Management (Zero-touch approach)
  useEffect(() => {
    if (started) return;
    const refocus = () => setTimeout(() => inputRef.current?.focus(), 0);
    refocus();
    document.addEventListener("click", refocus);
    return () => document.removeEventListener("click", refocus);
  }, [started, loading]);

  // Fetch History เมื่อไม่มี Active Jobs
  useEffect(() => {
    if (jobs.length === 0 && !started) {
      setViewMode("history");
      fetchTodayHistory();
    } else {
      setViewMode("active");
    }
  }, [jobs.length, started]);

  // RFID Polling
  useEffect(() => {
    if (!started || !deviceReady || !deviceApi) return;
    const interval = setInterval(async () => {
      try {
        const res = await deviceApi.get("/new-tag");
        if (res.data?.tag_id) setTagId(res.data.tag_id);
      } catch (err) {
        // เงียบไว้เพื่อไม่ให้ Console รกจากการ Poll ปกติ
      }
    }, 300);
    return () => clearInterval(interval);
  }, [started, deviceApi, deviceReady]);

  // Trigger Register เมื่อได้ Tag ใหม่
  useEffect(() => {
    if (!tagId) return;
    if (!activeJob) {
      showAlert("Please select an active job first!", "warning");
      setTagId("");
      return;
    }
    registerTray(tagId, activeJob);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tagId]);

  // Barcode Scanning
  useEffect(() => {
    if (!barcode) return;
    const timer = setTimeout(async () => {
      const target = barcode.trim();
      if (!target) return;

      if (jobs.some((j) => j.job_ticket_no === target)) {
        showAlert("Job already in list!", "warning");
        setBarcode("");
        return;
      }

      setLoading(true);
      try {
        const res = await backendApi.get(`/job-ticket/${target}`);
        const data = res.data;

        const regRes = await backendApi.post("/register-lot", {
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

        const result = regRes.data?.result;

        if (result === "BARCODE_COMPLETED") {
          showAlert("This lot is already completed!", "warning");
        } else if (result === "OK" || result === "RESUME") {
          setJobs((prev) => [
            ...prev,
            {
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
            },
          ]);
          showAlert(result === "RESUME" ? "Resumed!" : "Job added!", "success");
        } else if (result === "BARCODE_IN_USE") {
          showAlert("Barcode already in use!", "error");
        } else {
          showAlert(result || "Unknown error occurred", "error");
        }
      } catch (err) {
        showAlert("Barcode not found or network error!", "error");
      } finally {
        setLoading(false);
        setBarcode("");
      }
    }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [barcode]);

  // --- Handlers & API Calls ---

  const fetchTodayHistory = async () => {
    try {
      setLoadingHistory(true);
      const res = await backendApi.get("/register-history/today");
      setHistory(Array.isArray(res.data) ? res.data : []);
    } catch (error) {
      console.error("Fetch history error:", error);
      setHistory([]);
    } finally {
      setLoadingHistory(false);
    }
  };

  const todaysHistory = useMemo(() => {
    const todayStr = new Date().toDateString();
    return (
      history?.filter((row) => {
        if (!row.updated_at) return false;
        const cleanDate = String(row.updated_at).replace(/Z|\+00:00/g, "");
        return new Date(cleanDate).toDateString() === todayStr;
      }) || []
    );
  }, [history]);

  const removeJob = (jobTicketNo) => {
    setJobs((prev) => prev.filter((j) => j.job_ticket_no !== jobTicketNo));
    if (activeJob === jobTicketNo) setActiveJob(null);
  };

  const startRegistering = () => {
    if (jobs.length === 0) {
      showAlert("Add at least one job first!", "warning");
      return;
    }
    setStarted(true);
    setActiveJob(jobs[0].job_ticket_no);
    setTagId("");
    deviceApi?.get("/new-tag").catch(() => {});
    showAlert("Started! Scan tags now", "success");
  };

  const cancelAll = () => {
    setBarcode("");
    setJobs([]);
    setStarted(false);
    setActiveJob(null);
    setTagId("");
  };

  const findNextIncompleteJob = (jobList, currentJobTicketNo) => {
    const currentIndex = jobList.findIndex(
      (j) => j.job_ticket_no === currentJobTicketNo,
    );
    for (let i = 1; i <= jobList.length; i++) {
      const next = jobList[(currentIndex + i) % jobList.length];
      if (next.tray_done < next.tray_counter) return next.job_ticket_no;
    }
    return null;
  };

  const registerTray = async (tag, jobTicketNo,isForce = false) => {
    try {
      const res = await backendApi.post("/register-tray", {
        tag_id: tag,
        barcode: jobTicketNo,
        forceClear: isForce,
      });
      const data = res.data;

      if (data.result === "OK") {
        setJobs((prev) => {
          const updated = prev.map((j) =>
            j.job_ticket_no !== jobTicketNo
              ? j
              : { ...j, tray_done: j.tray_done + 1 },
          );
          const finished = updated.find((j) => j.job_ticket_no === jobTicketNo);
          const justDone = finished.tray_done >= finished.tray_counter;
          const allDone = updated.every((j) => j.tray_done >= j.tray_counter);

          if (allDone) {
            showAlert("All jobs complete!", "success");
            setTimeout(cancelAll, 1500);
          } else if (justDone) {
            showAlert(`${jobTicketNo} complete!`, "success");
            setActiveJob(findNextIncompleteJob(updated, jobTicketNo));
          }
          return updated;
        });
        setTagId("");
      } else if (data.result === "TAG_IN_USE") {
        setTagId(""); 
        const rawProcess = data.sub_process || "";
        const safeStatus = rawProcess.toLowerCase();
        const processLabel = STEP_LABEL[safeStatus] || rawProcess || "-";
        const badge = STEP_BADGE[safeStatus] || { bg: "bg-red-100", text: "text-red-600" };

        Swal.fire({
          title: "Tag In Use!",
          width: "600px",
          html: `
            <div class="text-left mt-5">
              <p>แท็กนี้ติดค้างอยู่ที่งานเก่า:</p>
              <ul class="mt-3 text-xl space-y-2">
                <li>Barcode: <strong class="text-blue-600">${data.jobtag || "-"}</strong></li>
                <li>Part No: <strong class="text-gray-600">${data.part_no || "-"}</strong></li>
                
                <li class="flex items-center gap-2">
                  Sub Process: 
                  <span class="px-2.5 py-0.5 rounded-full text-base font-medium ${badge.bg} ${badge.text}">
                    ${processLabel}
                  </span>
                </li>
                
                <li>Process: <strong class="text-gray-700">[${data.process_code || "-"}] ${data.process}</strong></li>
              </ul>
              <p class="mt-5 text-base text-gray-600">ต้องการบังคับจบงานเก่าแล้วนำมาใช้ใหม่เลยหรือไม่?</p>
            </div>
          `,
          icon: "warning",
          showCancelButton: true,
          confirmButtonColor: "#3b82f6",
          cancelButtonColor: "#ef4444",
          confirmButtonText: "ตกลง",
          cancelButtonText: "ยกเลิก"
        }).then((result) => {
          if (result.isConfirmed) {
            registerTray(tag, jobTicketNo, true);
          }
        });
      }else if (data.result === "DUPLICATE_TAG_STUCK") {
        
        Swal.fire({
          title: "Duplicate Tag!",
          text: "TAG นี้ถูกลงทะเบียนในงานนี้ไปแล้ว (ถาดซ้ำ) กรุณาใช้แท็กอื่น",
          icon: "warning",
          showConfirmButton: false,
          time: 1800,
        });
        setTagId("");
      }else if (data.result === "TRAY_FULL") {
        showAlert(`${jobTicketNo} already complete!`, "warning");
        setTagId("");
      } else {
        showAlert(data.message || data.result, "error");
        setTagId("");
      }
    } catch (err) {
      showAlert(
        err.response?.data?.error || err.message || "Network Error",
        "error",
      );
      setTagId("");
    }
  };

  // --- Render ---
  return (
    <div className="flex flex-col gap-4 h-full">
      {/* 1. SCAN BARCODE */}
      {!started && (
        <div className="bg-white border border-gray-100 rounded-xl p-4">
          <p className="text-xl font-bold text-gray-500 mb-2">
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
            className="w-full h-10 px-3 text-base font-mono border border-gray-200 rounded-lg
                       bg-gray-50 focus:outline-none focus:ring-1 focus:ring-blue-400 disabled:opacity-50"
          />
        </div>
      )}

      {/* 2. JOB LIST CONTAINER */}
      <div className="flex-1 bg-white border border-gray-100 rounded-xl flex flex-col overflow-hidden min-h-0">
        <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between">
          <div className="flex gap-6">
            {/* Tab 1: Jobs Today (แสดงเมื่อเริ่มสแกนงาน) */}
            <button
              onClick={() => setViewMode("active")}
              className={`text-lg font-bold pb-1 border-b-2 transition-colors ${
                viewMode === "active"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              Jobs Today ({jobs.length})
            </button>

            {/* Tab 2: Today's History (แสดงเมื่อจอว่าง) */}
            <button
              onClick={() => {
                setViewMode("history");
                fetchTodayHistory();
              }}
              className={`text-lg font-bold pb-1 border-b-2 transition-colors ${
                viewMode === "history"
                  ? "border-blue-600 text-blue-600"
                  : "border-transparent text-gray-400 hover:text-gray-600"
              }`}
            >
              Today's History
            </button>
          </div>
          <div className="flex gap-2">
            {(jobs.length > 0 || started) && (
              <button
                onClick={cancelAll}
                className="h-9 px-4 text-base rounded-lg border border-red-200 text-red-500 hover:bg-red-50"
              >
                Cancel All
              </button>
            )}
            {!started ? (
              <button
                onClick={startRegistering}
                disabled={jobs.length === 0}
                className="h-9 px-5 text-base rounded-lg bg-green-600 text-white hover:bg-green-700 disabled:opacity-50"
              >
                Start Registering →
              </button>
            ) : (
              <span className="text-base px-3 py-1 rounded-full bg-blue-50 text-blue-600">
                Scanning in progress
              </span>
            )}
          </div>
        </div>

        <div className="overflow-y-auto flex-1">
          {jobs.length > 0 || started ? (
            <table className="w-full">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {[
                    "",
                    "Job Ticket",
                    "Lot No.",
                    "Part No.",
                    "Machine",
                    "Qty",
                    "Pcs/Tray",
                    "Process",
                    "RW",
                    "Progress",
                    "",
                  ].map((col, i) => (
                    <th
                      key={i}
                      className="text-left px-3 py-2.5 text-base font-medium text-gray-400 border-b border-gray-100 whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {jobs.map((job) => {
                  const isActive = activeJob === job.job_ticket_no;
                  const isDone = job.tray_done >= job.tray_counter;

                  return (
                    <tr
                      key={job.job_ticket_no}
                      onClick={() =>
                        started && !isDone && setActiveJob(job.job_ticket_no)
                      }
                      className={`border-b border-gray-50 transition-colors
                                  ${started && !isDone ? "cursor-pointer" : ""}
                                  ${isActive ? "bg-blue-50" : isDone ? "bg-green-50" : "hover:bg-gray-50"}`}
                    >
                      <td className="px-3 py-3.5">
                        <span
                          className={`block w-2.5 h-2.5 rounded-full ${isActive ? "bg-blue-600" : isDone ? "bg-green-500" : "bg-gray-200"}`}
                        />
                      </td>
                      <td className="px-4 py-2.5 text-base font-semibold text-gray-700">
                        {job.job_ticket_no}
                      </td>
                      <td className="px-4 py-2.5 text-base font-semibold text-gray-700">
                        {job.lot_no}
                      </td>
                      <td className="px-4 py-2.5 text-base font-semibold text-gray-700">
                        {job.part_no}
                      </td>
                      <td className="px-3 py-3.5 text-base text-gray-500">
                        {job.machine_no || "—"}
                      </td>
                      <td className="px-3 py-3.5 text-base text-gray-500">
                        {job.quantity?.toLocaleString()}
                      </td>
                      <td className="px-3 py-3.5 text-base text-gray-500">
                        {job.tray_qty?.toLocaleString() ?? "—"}
                      </td>
                      <td className="px-3 py-3.5 text-base text-gray-500">
                        {job.process || "—"}
                      </td>
                      <td className="px-3 py-3.5 text-base text-gray-500">
                        {job.rw_diameter || "—"}
                      </td>
                      <td className="px-3 py-3.5">
                        <div className="flex items-center gap-2">
                          <div className="w-28 bg-gray-100 rounded-full h-2">
                            <div
                              className={`h-2 rounded-full transition-all ${isDone ? "bg-green-500" : "bg-blue-500"}`}
                              style={{
                                width:
                                  job.tray_counter > 0
                                    ? `${(job.tray_done / job.tray_counter) * 100}%`
                                    : "0%",
                              }}
                            />
                          </div>
                          <span className="text-base text-blue-600 whitespace-nowrap">
                            {job.tray_done}/{job.tray_counter}
                          </span>
                        </div>
                      </td>
                      <td className="px-3 py-3.5">
                        {isActive && started && (
                          <span className="text-sm bg-blue-600 text-white px-2 py-1 rounded-full">
                            ACTIVE
                          </span>
                        )}
                        {isDone && (
                          <span className="text-sm bg-green-600 text-white px-2 py-1 rounded-full">
                            DONE
                          </span>
                        )}
                        {!started && (
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              removeJob(job.job_ticket_no);
                            }}
                            className="text-base text-gray-300 hover:text-red-500"
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
          ) : (
            <table className="w-full">
              <thead className="bg-slate-50 sticky top-0 shadow-sm">
                <tr>
                  {[
                    "Last Update",
                    "Barcode",
                    "Sub Process",
                    "Part No.",
                    "Qty",
                    "Tray/Total",
                  ].map((col, i) => (
                    <th
                      key={i}
                      className="text-left px-4 py-2.5 text-base font-medium text-slate-500 border-b border-gray-100 whitespace-nowrap"
                    >
                      {col}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {loadingHistory ? (
                  <tr>
                    <td colSpan="6" className="text-center py-8 text-gray-400">
                      Loading history...
                    </td>
                  </tr>
                ) : todaysHistory.length === 0 ? (
                  <tr>
                    <td
                      colSpan="6"
                      className="text-center py-12 text-gray-300 text-xl"
                    >
                      No registration history today
                    </td>
                  </tr>
                ) : (
                  todaysHistory.map((row, i) => {
                    const currentStep = row.sub_process;
                    const label = STEP_LABEL[currentStep] || currentStep || "-";
                    const badge = STEP_BADGE[currentStep] || {
                      bg: "bg-gray-100",
                      text: "text-gray-500",
                    };

                    return (
                      <tr
                        key={i}
                        className="border-b border-gray-50 hover:bg-slate-50 transition-colors"
                      >
                        <td className="px-4 py-3 text-base font-bold text-gray-500">
                          {formatDate(row.updated_at)}
                        </td>
                        <td className="px-4 py-3 text-base text-blue-600 font-bold">
                          {row.barcode || "-"}
                        </td>

                        <td className="px-4 py-3 text-base">
                          <span
                            className={`px-2.5 py-1 rounded-full text-sm font-bold ${badge.bg} ${badge.text} whitespace-nowrap`}
                          >
                            {label}
                          </span>
                        </td>

                        <td className="px-4 py-3 text-base font-bold text-gray-600">
                          {row.part_no || "-"}
                        </td>
                        <td className="px-4 py-3 text-base font-bold text-gray-700">
                          {row.quantity?.toLocaleString() || "-"}
                        </td>
                        <td className="px-4 py-3 text-base font-bold text-blue-600">
                          {row.tray_done || 0} / {row.tray_counter || 0}
                        </td>
                      </tr>
                    );
                  })
                )}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* 3. SCAN TAG STATUS */}
      {started && (
        <div className="bg-white border border-gray-100 rounded-xl px-4 py-3">
          <p className="text-sm text-gray-400 mb-1">
            Scanning into:{" "}
            <span className="font-mono text-blue-600 font-medium">
              {activeJob || "—"}
            </span>
          </p>
          <p
            className={`text-base font-mono ${tagId ? "text-blue-600" : "text-gray-300"}`}
          >
            {tagId || "Waiting for tag..."}
          </p>
        </div>
      )}
    </div>
  );
};

export default MultiRegister;
