import React, { useState, useRef, useEffect } from 'react';

const InfoPopover = ({ title, content, width = 260 }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  // ปิด popover เมื่อคลิกนอก component
  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>

      {/* ปุ่ม ⓘ */}
      <button
        onClick={() => setOpen(prev => !prev)}
        style={{
          width: 18, height: 18, borderRadius: '50%',
          border: '1.5px solid var(--border)',
          background: open ? 'var(--surface-1)' : 'transparent',
          color: open ? 'var(--text-primary)' : 'var(--text-muted)',
          fontSize: 11, fontWeight: 600, cursor: 'pointer',
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          lineHeight: 1, padding: 0, transition: 'all .15s',
          flexShrink: 0,
        }}
        title="ข้อมูลเพิ่มเติม"
      >
        i
      </button>

      {/* Popover */}
      {open && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', left: '50%',
          transform: 'translateX(-50%)',
          width, zIndex: 999,
          background: 'var(--surface-2)',
          border: '0.5px solid var(--border)',
          borderRadius: 'var(--radius)',
          boxShadow: '0 4px 16px rgba(0,0,0,0.08)',
          padding: '10px 12px',
        }}>

          {/* หัวข้อ */}
          {title && (
            <div style={{
              fontSize: 12, fontWeight: 600, color: 'var(--text-primary)',
              marginBottom: 6, paddingBottom: 6,
              borderBottom: '0.5px solid var(--border)',
            }}>
              {title}
            </div>
          )}

          {/* เนื้อหา */}
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            {content}
          </div>

        </div>
      )}
    </div>
  );
};

export default InfoPopover;