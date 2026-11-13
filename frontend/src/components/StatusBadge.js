import React from 'react';

// ประกาศไว้นอก Component เพื่อประหยัด Memory
const STEP_LABEL = {
  waiting_register: "Waiting Register",
  registered: "Registered",
  before_washing: "Before Washing",
  after_washing: "After Washing",
  on_machine: "On Machine",
  completed: "Completed",
};

const STEP_BADGE = {
  waiting_register: { bg: "bg-gray-100", text: "text-gray-500" }, // เติมค่าเริ่มต้นให้ครบ
  registered: { bg: "bg-blue-100", text: "text-blue-600" },
  before_washing: { bg: "bg-amber-100", text: "text-amber-600" },
  after_washing: { bg: "bg-emerald-100", text: "text-emerald-600" },
  on_machine: { bg: "bg-violet-100", text: "text-violet-600" },
  completed: { bg: "bg-gray-100", text: "text-gray-500" },
};

/**
 * Component สำหรับแสดง Badge สถานะ
 * @param {Object} props
 * @param {string} props.status - ค่า sub_process ที่ได้จาก Database
 * @returns {JSX.Element}
 */
const StatusBadge = ({ status }) => {
  // Error Handling: ป้องกันค่า null/undefined และเตรียม Fallback
  const safeStatus = status?.toLowerCase() || "waiting_register";
  
  const label = STEP_LABEL[safeStatus] || status || "Unknown";
  const badge = STEP_BADGE[safeStatus] || { bg: "bg-red-100", text: "text-red-600" }; // ถ้าหลุดเคสให้เป็นสีแดงเตือนไว้

  return (
    <span className={`px-2.5 py-1 rounded-full text-sm font-medium whitespace-nowrap ${badge.bg} ${badge.text}`}>
      {label}
    </span>
  );
};

export default StatusBadge;