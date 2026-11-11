import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { backendApi } from "../../config/instance";
import Swal from "sweetalert2";

const POLL_MS = 5000;
const STALE_MS = 30000; // ข้อมูลเก่ากว่านี้ → เวลาอัปเดตเป็นสีแดง (จอค้าง)
const LONG_MIN = 30; // Part mismatch ค้างนานเกินนี้ (นาที) → ป้ายแดง
const MIS_PAGE_SIZE = 9; // ทีวี: แถว Part mismatch ต่อหน้า

const pad = (n) => String(n).padStart(2, "0");
const hhmm = (t) => {
  const d = new Date(t);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
};
const hhmmss = (t) => `${hhmm(t)}:${pad(new Date(t).getSeconds())}`;
const ddmmyyyy = (t) => {
  const d = new Date(t);
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
};
const byMachine = (a, b) =>
  `${a.location}`.localeCompare(`${b.location}`, undefined, { numeric: true });
const splitNo = (s) => {
  const m = `${s}`.trim().match(/^(.*?)(\d+)$/);
  return m ? [m[1], Number(m[2])] : [`${s}`.trim(), NaN];
};
const alarmKey = (r) => `${r.location}|${r.alarm_barcode ?? ""}`;

const statusOf = (r) => {
  if (!r.connected) return "offline";
  if (r.alarm) return "mis";
  if (r.low_qty) return "low";
  if (!(r.min_qty > 0) && !(r.current_qty > 0)) return;
  return "ok";
};

const STATUS_ORDER = ["ok", "low", "mis", "offline"];
const ST = {
  ok: {
    label: "Normal",
    card: "bg-white border-gray-100",
    qty: "text-gray-700",
    badge: "bg-green-50 text-green-600",
    dot: "bg-green-500",
    bar: "bg-green-500",
    track: "bg-gray-100",
  },
  low: {
    label: "Low",
    card: "bg-white border-red-200",
    qty: "text-red-600",
    badge: "bg-red-50 text-red-600",
    dot: "bg-red-500 animate-pulse",
    bar: "bg-red-500",
    track: "bg-red-50",
  },
  mis: {
    label: "Part mismatch",
    card: "bg-orange-50 border-orange-200",
    qty: "text-orange-700",
    badge: "bg-white text-orange-700 border border-orange-200",
    dot: "bg-orange-500 animate-pulse",
    bar: "bg-orange-500",
    track: "bg-orange-100",
  },
  offline: {
    label: "Offline",
    card: "bg-gray-50 border-dashed border-gray-300",
    qty: "text-gray-300",
    badge: "bg-gray-100 text-gray-500",
    dot: "bg-gray-400",
  },
};

const MbrMonitor_qty = () => {
  const [params, setParams] = useSearchParams();
  const tv = params.get("tv") === "1";
  const rotateRaw = Number(params.get("rotate") ?? 15);
  const rotateSec =
    Number.isFinite(rotateRaw) && rotateRaw >= 0 ? rotateRaw : 15;
  const machinesParam = params.get("machines") || "";
  const rangeParam = params.get("range") || "";
  const q = params.get("q") || "";
  const fStatus = params.get("status") || "";
  const fPart = params.get("part") || "";

  const [readers, setReaders] = useState([]);
  const [machineList, setMachineList] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [lastOk, setLastOk] = useState(null);
  const [now, setNow] = useState(Date.now());
  const [tab, setTab] = useState(params.get("view") === "mis" ? "mis" : "mbr");
  const [misPage, setMisPage] = useState(0);
  // `${location}|${barcode}` → เวลาที่จอนี้เห็น alarm ครั้งแรก (/status ไม่มีเวลา · refresh จอ = เริ่มนับใหม่)
  const alarmSinceRef = useRef(new Map());
  const rotateAtRef = useRef(Date.now()); // เวลาที่สลับแท็บ/หน้าครั้งล่าสุด
  const tvRef = useRef(tv);
  useEffect(() => {
    tvRef.current = tv;
  }, [tv]);

  // fetch machine list ทุก 30 นาที (part ที่เครื่องใช้)
  useEffect(() => {
    const fetchMachineList = async () => {
      try {
        const res = await backendApi.get("/machine-list");
        setMachineList(res.data || []);
      } catch {}
    };
    fetchMachineList();
    const interval = setInterval(fetchMachineList, 30 * 60 * 1000);
    return () => clearInterval(interval);
  }, []);

  // fetch status ทุก 5 วิ · ดึงพลาด → ใช้ข้อมูลล่าสุดต่อ (เวลาอัปเดตจะแดงเมื่อเก่าเกิน 30 วิ)
  useEffect(() => {
    const fetchData = async () => {
      try {
        const res = await backendApi.get("/status");
        const onMachine = (res.data.readers || []).filter(
          (r) => r.type === "on_machine",
        );
        const since = alarmSinceRef.current;
        const keys = onMachine.filter((r) => r.alarm).map(alarmKey);
        const fresh = keys.filter((k) => !since.has(k));
        for (const k of [...since.keys()])
          if (!keys.includes(k)) since.delete(k);
        fresh.forEach((k) => since.set(k, Date.now()));
        // mismatch เกิดใหม่ → ทีวีสลับไปแท็บ Part mismatch ทันที
        if (fresh.length && tvRef.current) {
          setTab("mis");
          setMisPage(0);
          rotateAtRef.current = Date.now();
        }
        setReaders(onMachine);
        setLastOk(Date.now());
      } catch {
      } finally {
        setLoaded(true);
      }
    };
    fetchData();
    const interval = setInterval(fetchData, POLL_MS);
    return () => clearInterval(interval);
  }, []);

  // นาฬิกา + นับถอยหลังสลับแท็บ
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  // ขอบเขตเครื่อง (machines= / range=) — ตั้งครั้งเดียวต่อจอ
  const machineFilter = machinesParam
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const [rFrom, rTo] = rangeParam.split(":");
  const inScope = (loc) => {
    if (machineFilter.length && !machineFilter.includes(loc)) return false;
    if (rFrom && rTo) {
      const [p, n] = splitNo(loc);
      const [p1, a] = splitNo(rFrom);
      const [p2, b] = splitNo(rTo);
      if (p !== p1 || p !== p2 || !(n >= a && n <= b)) return false;
    }
    return true;
  };

  // เรียงตามเลขเครื่องตายตัว (ไม่เรียงตามสถานะ) → คนหน้างานจำตำแหน่งได้
  const all = readers
    .map((r) => {
      const m = machineList.find((x) => x.machineNoProd === r.location);
      return {
        ...r,
        part: m?.innerRingPart || "",
        outerPart: m?.outerRingPart || "",
        rp: m?.rp || "",
        status: statusOf(r),
      };
    })
    .sort(byMachine);
  const scoped = all.filter((r) => inScope(r.location));
  const s = q.trim().toLowerCase();
  const shown = scoped.filter(
    (r) =>
      (!s ||
        `${r.location} ${r.part} ${r.alarm_barcode ?? ""}`
          .toLowerCase()
          .includes(s)) &&
      (!fStatus || r.status === fStatus) &&
      (!fPart || r.part === fPart),
  );
  const counts = Object.fromEntries(
    STATUS_ORDER.map((k) => [k, scoped.filter((r) => r.status === k).length]),
  );
  const partOptions = [
    ...new Set(scoped.map((r) => r.part).filter(Boolean)),
  ].sort();

  // Part mismatch: ทุกเครื่อง ไม่สนตัวกรอง (ไม่ให้พลาด) · ค้างนานสุดก่อน
  const misRows = all
    .filter((r) => r.alarm)
    .map((r) => ({
      ...r,
      since: alarmSinceRef.current.get(alarmKey(r)) ?? now,
    }))
    .sort((a, b) => a.since - b.since);
  const misCount = misRows.length;
  const misPages = tv ? Math.max(1, Math.ceil(misCount / MIS_PAGE_SIZE)) : 1;
  const page = Math.min(misPage, misPages - 1);
  const misVisible = tv
    ? misRows.slice(page * MIS_PAGE_SIZE, (page + 1) * MIS_PAGE_SIZE)
    : misRows;

  // ทีวี: ไม่มี mismatch → อยู่แท็บเครื่องตลอด · มี → สลับทุก rotate วิ (แท็บ mismatch หลายหน้า → ไล่หน้าก่อน)
  const rotating = tv && rotateSec > 0 && misCount > 0;
  useEffect(() => {
    if (!tv) return;
    if (misCount === 0) {
      rotateAtRef.current = now;
      if (tab !== "mbr") setTab("mbr");
      return;
    }
    if (!rotating || now - rotateAtRef.current < rotateSec * 1000) return;
    rotateAtRef.current = now;
    if (tab === "mis" && page < misPages - 1) setMisPage(page + 1);
    else if (tab === "mis") {
      setTab("mbr");
      setMisPage(0);
    } else setTab("mis");
  }, [now]); // eslint-disable-line react-hooks/exhaustive-deps

  const left = Math.max(
    0,
    Math.ceil((rotateSec * 1000 - (now - rotateAtRef.current)) / 1000),
  );
  const nextLabel =
    tab === "mis" && page < misPages - 1
      ? `page ${page + 2}`
      : tab === "mis"
        ? "Machines"
        : "Part mismatch";
  const stale = !lastOk || now - lastOk > STALE_MS;
  const scopeLabel =
    rFrom && rTo
      ? `${rFrom} – ${rTo}`
      : machineFilter.length
        ? machineFilter.join(", ")
        : "All machines";

  const setParam = (key, value) =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        if (value) p.set(key, value);
        else p.delete(key);
        return p;
      },
      { replace: true },
    );
  const clearFilters = () =>
    setParams(
      (prev) => {
        const p = new URLSearchParams(prev);
        ["q", "status", "part"].forEach((k) => p.delete(k));
        return p;
      },
      { replace: true },
    );
  const enterTv = () => {
    setParam("tv", "1");
    document.documentElement.requestFullscreen?.().catch(() => {});
  };
  const exitTv = () => {
    setParam("tv", "");
    if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {});
  };

  if (!loaded)
    return (
      <div className="flex items-center justify-center h-full min-h-[60vh]">
        <p className="text-gray-400 text-base">Loading...</p>
      </div>
    );

  // แท็บแบบปุ่มสลับเดิม (By machine / By part)
  const tabBtn = (id, label, count) => {
    const active = tab === id;
    const alert = id === "mis" && count > 0;
    return (
      <button
        key={id}
        onClick={() => {
          setTab(id);
          setMisPage(0);
          rotateAtRef.current = Date.now();
        }}
        className={`flex items-center gap-2 rounded-md font-medium transition-all ${active ? "bg-white text-gray-800 shadow-sm" : "text-gray-400"} ${tv ? "px-5 py-2 text-xl" : "px-3 py-1 text-xs"}`}
      >
        {alert && (
          <span
            className={`rounded-full bg-orange-500 animate-pulse motion-reduce:animate-none ${tv ? "w-3 h-3" : "w-2 h-2"}`}
          />
        )}
        {label}
        <span
          className={`rounded-full ${alert ? "bg-orange-50 text-orange-600" : "bg-gray-100 text-gray-500"} ${tv ? "px-2.5 text-lg" : "px-2 text-[11px]"}`}
        >
          {count}
        </span>
      </button>
    );
  };

  const renderCard = (r) => {
    const st = ST[r.status];
    const qty = r.current_qty ?? 0;
    const min = r.min_qty ?? 0;
    const hasQty = r.status !== "offline";
    const max = Math.max(min * 2.5, qty, 1);
    const badge =
      r.status === "low"
        ? `Add ${Math.max(0, min - qty).toLocaleString()}`
        : st.label;

    const rawJobs = Array.isArray(r.barcodes) ? r.barcodes : [];
    const jobs = rawJobs.map((j) =>
      typeof j === "string" ? { barcode: j, qty: 0 } : j,
    );
    const hasJobs = jobs.length > 0;
    const firstJob = hasJobs ? jobs[0].barcode : null;
    const moreCount = jobs.length - 1;
    const alarmJobs =
      r.status === "mis" && r.alarm_barcode
        ? r.alarm_barcode
            .split(",")
            .map((b) => b.trim())
            .filter(Boolean)
        : [];

    const handleShowJobs = () => {
      if (tv) return;

      const hasAlarm = r.status === "mis" && alarmJobs.length > 0;
      const hasNormal = hasJobs;

      if (!hasAlarm && !hasNormal) return;

      // 📍 ฝั่งซ้าย: ตารางงานที่ผิด (สีส้ม)
      const alarmHtml = hasAlarm
        ? `
            <div class="flex-1 flex flex-col min-w-0">
                <p class="text-sm font-semibold text-orange-600 mb-2">❌ Mismatch</p>
                <div class="border border-orange-200 rounded-xl overflow-y-auto max-h-60 custom-scrollbar">
                    <table class="w-full text-left">
                        <thead class="bg-orange-50 sticky top-0 z-10">
                            <tr>
                                <th class="px-3 py-2 text-xs font-semibold text-orange-500 uppercase">Job Ticket</th>
                                <th class="px-3 py-2 text-right text-xs font-semibold text-orange-500 uppercase">Status</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${alarmJobs
                              .map(
                                (b) => `
                                <tr class="border-b border-orange-50 hover:bg-orange-50">
                                    <td class="px-3 py-2 text-sm font-semibold text-orange-600 font-mono break-words">${b}</td>
                                    <td class="px-3 py-2 text-sm font-bold text-orange-600 text-right whitespace-nowrap">Mismatch</td>
                                </tr>
                            `,
                              )
                              .join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `
        : "";

      // 📍 ฝั่งขวา: ตารางงานปกติ (สีฟ้า)
      const normalHtml = hasNormal
        ? `
            <div class="flex-1 flex flex-col min-w-0">
                <p class="text-sm font-semibold text-blue-600 mb-2">✅ Matching Machine</p>
                <div class="border border-blue-200 rounded-xl overflow-y-auto max-h-60 custom-scrollbar">
                    <table class="w-full text-left">
                        <thead class="bg-blue-50 sticky top-0 z-10">
                            <tr>
                                <th class="px-3 py-2 text-xs font-semibold text-blue-500 uppercase">Job Ticket</th>
                                <th class="px-3 py-2 text-right text-xs font-semibold text-blue-500 uppercase">Qty</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${jobs
                              .map(
                                (j) => `
                                <tr class="border-b border-blue-50 hover:bg-blue-50">
                                    <td class="px-3 py-2 text-sm font-semibold text-gray-700 font-mono break-words">${j.barcode || "-"}</td>
                                    <td class="px-3 py-2 text-sm font-bold text-gray-700 text-right tabular-nums whitespace-nowrap">${(j.qty || 0).toLocaleString()}</td>
                                </tr>
                            `,
                              )
                              .join("")}
                        </tbody>
                    </table>
                </div>
            </div>
        `
        : "";

      Swal.fire({
        title: `<div class="text-left text-sm font-semibold text-gray-600 border-b border-gray-100 pb-2">Location: ${r.location}</div>`,
        html: `
                <div class="mt-4 flex flex-col md:flex-row gap-4 text-left">
                    ${alarmHtml}
                    ${normalHtml}
                </div>
            `,
        // ขยายกรอบเป็น 800px ถ้ามีทั้ง 2 ตาราง
        width: hasAlarm && hasNormal ? "800px" : "500px",
        showCloseButton: true,
        showConfirmButton: false,
        customClass: { popup: "rounded-xl border border-gray-100 p-4" },
      });
    };

    const isClickable =
      !tv &&
      ((r.status === "mis" && alarmJobs.length > 0) ||
        (r.status !== "mis" && hasJobs));
    return (
      <div
        key={r.location}
        onClick={handleShowJobs}
        className={`
                border rounded-xl flex flex-col justify-between min-h-0 overflow-hidden 
                ${st.card} ${tv ? "p-4 gap-1" : "p-3 gap-2 h-40"}
                ${isClickable ? "cursor-pointer hover:shadow-md hover:border-blue-300 transition-all duration-200" : ""}
            `}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-2">
          <span
            className={`flex items-center gap-2 font-medium text-gray-800 leading-none ${tv ? "text-3xl" : "text-lg"}`}
          >
            <span
              className={`rounded-full shrink-0 motion-reduce:animate-none ${st.dot} ${tv ? "w-3 h-3" : "w-2 h-2"}`}
            />
            {r.location}
          </span>
          <span
            className={`font-medium rounded-full whitespace-nowrap ${st.badge} ${tv ? "text-base px-2.5 py-1" : "text-[11px] px-2 py-0.5"}`}
          >
            {badge}
          </span>
        </div>

        {/* Qty & Progress */}
        {hasQty ? (
          <>
            <div className="flex items-baseline gap-1 min-w-0">
              <span
                className={`font-medium leading-none tabular-nums ${st.qty} ${tv ? "text-4xl" : "text-2xl"}`}
              >
                {qty.toLocaleString()}
              </span>
              <span className={`text-gray-400 ${tv ? "text-base" : "text-xs"}`}>
                pcs
              </span>
              {min > 0 && (
                <span
                  className={`ml-auto whitespace-nowrap tabular-nums text-gray-400 ${tv ? "text-base" : "text-[11px]"}`}
                >
                  Min {min.toLocaleString()}
                </span>
              )}
            </div>
            <div className={`relative h-1.5 rounded-full ${st.track}`}>
              <div
                className={`h-full rounded-full ${st.bar}`}
                style={{ width: `${(qty / max) * 100}%` }}
              />
              {min > 0 && (
                <div
                  className="absolute -top-1 -bottom-1 w-0.5 bg-gray-400"
                  style={{ left: `${(min / max) * 100}%` }}
                />
              )}
            </div>
          </>
        ) : (
          <span
            className={`font-medium leading-none ${st.qty} ${tv ? "text-4xl" : "text-2xl"}`}
          >
            —
          </span>
        )}

        <div
          className={`whitespace-nowrap overflow-hidden text-ellipsis text-gray-500 ${tv ? "text-lg" : "text-xs"}`}
        >
          {r.status === "mis" ? (
            <span className="text-orange-700">
              Job <b>{r.alarm_barcode || "-"}</b> ไม่ตรง
            </span>
          ) : r.status === "offline" ? (
            "Reader ไม่ตอบ"
          ) : (
            <>
              Part {r.part || "—"}
              {r.rp && <span className="text-gray-400"> · RP {r.rp}</span>}
            </>
          )}
        </div>
      </div>
    );
  };

  const th = `text-left font-medium text-gray-400 border-b border-gray-100 whitespace-nowrap ${tv ? "px-6 py-3 text-base" : "px-4 py-3 text-xs"}`;
  const td = tv ? "px-6" : "px-4 py-4";
  const gridRows = Math.max(4, Math.ceil(shown.length / 6));

  return (
    <div
      className={
        tv
          ? "fixed inset-0 z-50 flex flex-col gap-4 p-6 bg-gray-100 overflow-hidden"
          : "flex flex-col gap-3 h-full min-h-0"
      }
    >
      {/* Header */}
      <div
        className={`flex items-center justify-between gap-4 bg-white border border-gray-100 rounded-xl ${tv ? "px-6 py-3" : "px-4 py-2.5"}`}
      >
        <div className="min-w-0">
          <p
            className={`font-medium text-gray-800 leading-tight ${tv ? "text-3xl" : "text-base"}`}
          >
            MBR Monitor
          </p>
          <p className={`text-gray-400 ${tv ? "text-base" : "text-xs"}`}>
            {scopeLabel}
          </p>
        </div>
        <div className="flex flex-col items-center gap-1.5">
          <div className="flex bg-gray-100 rounded-lg p-1 gap-1">
            {tabBtn("mbr", "Machines", scoped.length)}
            {tabBtn("mis", "Part mismatch", misCount)}
          </div>
          {rotating && (
            <div
              className={`flex items-center gap-2 text-gray-400 ${tv ? "text-sm" : "text-[11px]"}`}
            >
              <div className="w-40 h-1 rounded-full bg-gray-100 overflow-hidden">
                <div
                  className="h-full bg-gray-400 transition-all duration-1000 ease-linear"
                  style={{ width: `${(1 - left / rotateSec) * 100}%` }}
                />
              </div>
              <span className="tabular-nums">
                {nextLabel} in {left}s
              </span>
            </div>
          )}
        </div>
        <div className="text-right">
          <p
            className={`font-medium text-gray-700 tabular-nums leading-tight ${tv ? "text-3xl" : "text-base"}`}
          >
            {hhmm(now)}
          </p>
          <p
            className={`tabular-nums ${tv ? "text-sm" : "text-[11px]"} text-gray-400`}
          >
            {ddmmyyyy(now)} ·{" "}
            <span className={stale ? "text-red-500 font-medium" : ""}>
              Updated {lastOk ? hhmmss(lastOk) : "—"}
            </span>
          </p>
        </div>
      </div>

      {/* Toolbar (บนคอมเท่านั้น) */}
      {!tv && tab === "mbr" && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex gap-2 items-center flex-wrap">
            <input
              type="text"
              placeholder="Search..."
              value={q}
              onChange={(e) => setParam("q", e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300 w-44"
            />
            <select
              value={fStatus}
              onChange={(e) => setParam("status", e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300"
            >
              <option value="">All status</option>
              {STATUS_ORDER.map((k) => (
                <option key={k} value={k}>
                  {ST[k].label}
                </option>
              ))}
            </select>
            <select
              value={fPart}
              onChange={(e) => setParam("part", e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm text-gray-700 focus:outline-none focus:ring-1 focus:ring-gray-300"
            >
              <option value="">All parts</option>
              {partOptions.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
            {(q || fStatus || fPart) && (
              <button
                onClick={clearFilters}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5"
              >
                Clear
              </button>
            )}
          </div>
          <button
            onClick={enterTv}
            className="text-xs font-medium text-gray-600 bg-white border border-gray-200 hover:bg-gray-50 rounded-lg px-3 py-1.5"
          >
            TV mode
          </button>
        </div>
      )}

      {/* แท็บ 1: Machines */}
      {tab === "mbr" && (
        <>
          <div className="flex gap-3">
            {STATUS_ORDER.map((k) => (
              <div
                key={k}
                className={`flex-1 flex items-center gap-3 bg-white border border-gray-100 rounded-xl ${tv ? "h-16 px-5" : "h-12 px-4"}`}
              >
                <span
                  className={`rounded-full motion-reduce:animate-none ${counts[k] > 0 ? ST[k].dot : "bg-gray-200"} ${tv ? "w-3 h-3" : "w-2 h-2"}`}
                />
                <span
                  className={`font-medium tabular-nums ${counts[k] > 0 ? ST[k].qty : "text-gray-300"} ${tv ? "text-3xl" : "text-xl"}`}
                >
                  {counts[k]}
                </span>
                <span className={`text-gray-400 ${tv ? "text-lg" : "text-xs"}`}>
                  {ST[k].label}
                </span>
              </div>
            ))}
          </div>
          {shown.length === 0 ? (
            <div className="flex-1 flex items-center justify-center bg-white border border-gray-100 rounded-xl">
              <p className={`text-gray-400 ${tv ? "text-xl" : "text-sm"}`}>
                No machines
              </p>
            </div>
          ) : tv ? (
            <div
              className="flex-1 min-h-0 grid gap-3"
              style={{
                gridTemplateColumns: "repeat(6, minmax(0, 1fr))",
                gridTemplateRows: `repeat(${gridRows}, minmax(0, 1fr))`,
              }}
            >
              {shown.map(renderCard)}
            </div>
          ) : (
            <div className="flex-1 min-h-0 overflow-y-auto">
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6 gap-3">
                {shown.map(renderCard)}
              </div>
            </div>
          )}
        </>
      )}

      {/* แท็บ 2: Part mismatch */}
      {tab === "mis" && (
        <div className="flex-1 min-h-0 flex flex-col gap-3">
          {misCount > 0 && (
            <div
              className={`bg-orange-50 border border-orange-200 rounded-xl flex items-center gap-2 ${tv ? "px-6 py-4" : "px-4 py-3"}`}
            >
              <span
                className={`rounded-full bg-orange-500 animate-pulse motion-reduce:animate-none ${tv ? "w-3.5 h-3.5" : "w-2.5 h-2.5"}`}
              />
              <span
                className={`font-semibold text-orange-700 ${tv ? "text-2xl" : "text-sm"}`}
              >
                ⚠ PART MISMATCH · {misCount} machine{misCount > 1 ? "s" : ""}
              </span>
              <span
                className={`ml-auto text-orange-500 ${tv ? "text-lg" : "text-xs"}`}
              >
                ให้เอาถาดออกจากเครื่อง · รายการหายเองเมื่อเอาถาดออก
              </span>
            </div>
          )}
          <div className="flex-1 min-h-0 bg-white border border-gray-100 rounded-xl overflow-hidden flex flex-col">
            <div
              className={
                tv ? "flex-1 min-h-0" : "flex-1 min-h-0 overflow-y-auto"
              }
            >
              <table className="w-full">
                <thead className="bg-gray-50 sticky top-0">
                  <tr>
                    {[
                      "M/C",
                      "Job",
                      "Part (placed)",
                      "Part (machine)",
                      "Since",
                      "Duration",
                    ].map((c) => (
                      <th key={c} className={th}>
                        {c}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {misVisible.length === 0 ? (
                    <tr>
                      <td
                        colSpan={6}
                        className={`px-4 py-10 text-center text-gray-400 ${tv ? "text-xl" : "text-sm"}`}
                      >
                        No part mismatch
                      </td>
                    </tr>
                  ) : (
                    misVisible.map((r) => {
                      const mins = Math.max(
                        0,
                        Math.floor((now - r.since) / 60000),
                      );
                      return (
                        <tr
                          key={alarmKey(r)}
                          className={`border-b border-gray-50 hover:bg-orange-50 transition-colors ${tv ? "h-[88px]" : ""}`}
                        >
                          <td
                            className={`${td} font-medium text-orange-700 ${tv ? "text-4xl" : "text-2xl"}`}
                          >
                            {r.location}
                          </td>
                          <td className="px-4 py-3 text-sm font-semibold text-orange-600 font-mono whitespace-normal break-words">
                            {r.alarm_barcode || "-"}
                          </td>
                          <td className="px-4 py-3 text-sm text-gray-700 whitespace-normal break-words">
                            {r.alarm_part || "-"}
                          </td>
                          <td
                            className={`${td} text-gray-600 ${tv ? "text-2xl" : "text-sm"}`}
                          >
                            {[r.part, r.outerPart]
                              .filter(Boolean)
                              .join(" / ") || "—"}
                          </td>
                          <td
                            className={`${td} text-gray-500 tabular-nums ${tv ? "text-2xl" : "text-sm"}`}
                          >
                            {hhmm(r.since)}
                          </td>
                          <td className={td}>
                            <span
                              className={`inline-block rounded-full font-medium tabular-nums whitespace-nowrap ${mins >= LONG_MIN ? "bg-red-50 text-red-600" : "text-gray-500"} ${tv ? "text-2xl px-4 py-1" : "text-xs px-3 py-1.5"}`}
                            >
                              {mins} min
                            </span>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
            {tv && misPages > 1 && (
              <p className="text-right text-base text-gray-400 px-6 py-2 tabular-nums">
                Page {page + 1}/{misPages}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Footer (ทีวี): legend สี */}
      {tv && (
        <div className="flex items-center gap-6 text-base text-gray-500">
          {STATUS_ORDER.map((k) => (
            <span key={k} className="flex items-center gap-2">
              <span
                className={`w-2.5 h-2.5 rounded-full motion-reduce:animate-none ${ST[k].dot}`}
              />
              {ST[k].label}
            </span>
          ))}
          <span className="text-gray-400">
            · ตำแหน่งการ์ดคงที่ตามเลขเครื่อง
          </span>
          <button
            onClick={exitTv}
            className="ml-auto text-xs text-gray-300 hover:text-gray-500"
          >
            Exit TV mode
          </button>
        </div>
      )}
    </div>
  );
};

export default MbrMonitor_qty;
