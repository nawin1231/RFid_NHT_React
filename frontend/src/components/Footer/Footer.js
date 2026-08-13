import React from 'react';
import InfoPopover from '../InfoPopover';

const Footer = () => {
  const currentYear = new Date().getFullYear();
  
  // 📍 จุดที่แก้ไข: นำตัวแปร FLOW_SVG มาประกาศไว้ "ข้างใน" Footer 
  // เพื่อให้ระบบมองเห็นและนำไปใช้งานในบรรทัดล่างสุดได้
  const FLOW_SVG = `
<svg width="100%" viewBox="0 0 680 160" role="img">
  <defs>
    <marker id="arr2" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
      <path d="M2 1L8 5L2 9" fill="none" stroke="context-stroke" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    </marker>
  </defs>
  <rect x="20"  y="40" width="100" height="52" rx="8" fill="#f1efe8" stroke="#b4b2a9" stroke-width="0.5"/>
  <text x="70"  y="62" text-anchor="middle" font-size="18">📋</text>
  <text x="70"  y="82" text-anchor="middle" font-size="11" fill="#5f5e5a" font-weight="500">Register</text>
  <line x1="120" y1="66" x2="144" y2="66" stroke="#b4b2a9" stroke-width="1" marker-end="url(#arr2)"/>
  <rect x="144" y="40" width="100" height="52" rx="8" fill="#e6f1fb" stroke="#85b7eb" stroke-width="0.5"/>
  <text x="194" y="62" text-anchor="middle" font-size="18">📦</text>
  <text x="194" y="82" text-anchor="middle" font-size="11" fill="#185fa5" font-weight="500">Pallet in</text>
  <line x1="244" y1="66" x2="268" y2="66" stroke="#b4b2a9" stroke-width="1" marker-end="url(#arr2)"/>
  <rect x="268" y="40" width="100" height="52" rx="8" fill="#e1f5ee" stroke="#5dcaa5" stroke-width="0.5"/>
  <text x="318" y="62" text-anchor="middle" font-size="18">🧪</text>
  <text x="318" y="82" text-anchor="middle" font-size="11" fill="#0f6e56" font-weight="500">Washing</text>
  <line x1="368" y1="66" x2="392" y2="66" stroke="#b4b2a9" stroke-width="1" marker-end="url(#arr2)"/>
  <rect x="392" y="40" width="100" height="52" rx="8" fill="#eeedfe" stroke="#afa9ec" stroke-width="0.5"/>
  <text x="442" y="62" text-anchor="middle" font-size="18">⚙️</text>
  <text x="442" y="82" text-anchor="middle" font-size="11" fill="#534ab7" font-weight="500">On machine</text>
  <line x1="492" y1="66" x2="516" y2="66" stroke="#b4b2a9" stroke-width="1" marker-end="url(#arr2)"/>
  <rect x="516" y="40" width="108" height="52" rx="8" fill="#eaf3de" stroke="#97c459" stroke-width="0.5"/>
  <text x="570" y="62" text-anchor="middle" font-size="18">✅</text>
  <text x="570" y="82" text-anchor="middle" font-size="11" fill="#3b6d11" font-weight="500">Completed</text>
  <text x="340" y="120" text-anchor="middle" font-size="11" fill="#888780">ส่งข้อมูลไป AS400 อัตโนมัติทุก step</text>
  <line x1="144" y1="112" x2="516" y2="112" stroke="#888780" stroke-width="0.8" stroke-dasharray="4 3" marker-end="url(#arr2)"/>
</svg>
`;

  return (
    <footer className="bg-white border-t border-gray-200 py-3 px-6 flex items-center justify-between shrink-0">

      <div className="text-xs text-gray-500 font-medium">
        &copy; {currentYear} Developed by the organization
      </div>

      <div className="text-xs text-gray-400 flex items-center gap-4">
        <a href="/location-reader" className="hover:text-blue-600 transition-colors duration-150">
          Dx Staff
        </a>
        <span className="w-1 h-1 bg-gray-300 rounded-full"></span>
        <span>Version : 1.0.0</span>
      </div>
      
      <InfoPopover
        title="RFID Bearing Lot Tracking System"
        width={520}
        content={
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>

            {/* จุดประสงค์ */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {[
                { icon: '🏭', text: 'ติดตาม lot bearing ด้วย RFID ตลอดกระบวนการ washing ในองค์กร' },
                { icon: '🔍', text: 'ตรวจสอบและ trace ย้อนหลังได้ทุก lot ทุก tray ตั้งแต่รับงานจนเสร็จ' },
                { icon: '🔗', text: 'เชื่อมต่อกับ AS400 อัตโนมัติ ลดการบันทึกข้อมูลด้วยมือ' },
              ].map((item, i) => (
                <div key={i} style={{ display: 'flex', gap: 8 }}>
                  <span>{item.icon}</span>
                  <p style={{ margin: 0, lineHeight: 1.6 }}>{item.text}</p>
                </div>
              ))}
            </div>

            {/* Divider */}
            <div style={{ height: 0.5, background: '#e5e7eb' }} />

            {/* 📍 จุดเรียกใช้งาน FLOW_SVG */}
            <p style={{ margin: 0, fontWeight: 500, fontSize: 12 }}>Sub process flow</p>
            <div dangerouslySetInnerHTML={{ __html: FLOW_SVG }} />

          </div>
        }
      />

    </footer>
  );
};

export default Footer;