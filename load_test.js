import http from 'k6/http';
import { sleep, check } from 'k6';
import { Counter, Trend } from 'k6/metrics';

const BASE_URL = 'http://localhost:5000/api/rfid';
const HEADERS  = { 'Content-Type': 'application/json' };

const failedRequests = new Counter('failed_requests');
const lotDuration    = new Trend('lot_flow_duration');

export const options = {

  scenarios: {

    // ==============================
    // Scenario 1 — Load Test
    // 400 VUs พร้อมกัน = reader 400 ตัว
    // uncomment อันนี้ แล้ว comment อีก 2 อัน
    // ==============================
    // load_test: {
    //   executor: 'per-vu-iterations',
    //   vus: 200,
    //   iterations: 5,
    //   maxDuration: '5m',
    // },

    // ==============================
    // Scenario 2 — Spike Test
    // ยิง VUs พุ่งขึ้นกะทันหัน แล้วลดทันที
    // ==============================
    // spike_test: {
    //   executor: 'ramping-vus',
    //   startVUs: 0,
    //   stages: [
    //     { duration: '10s', target: 0   },  // เริ่มที่ 0
    //     { duration: '10s', target: 400 },  // พุ่งขึ้น 400 ทันที
    //     { duration: '30s', target: 400 },  // คงที่
    //     { duration: '10s', target: 0   },  // ลงทันที
    //   ],
    // },

    // ==============================
    // Scenario 3 — Soak Test
    // VUs น้อย แต่รันนาน 30 นาที
    // ดูว่า server ช้าลง / memory leak ไหม
    // ==============================
    soak_test: {
      executor: 'constant-vus',
      vus: 200,
      duration: '30m',
    },

  },

  thresholds: {
    http_req_duration: ['p(95)<2000'],
    http_req_failed:   ['rate<0.01'],
    failed_requests:   ['count<5'],
  },
};

const randomBarcode = (vuId) => `TEST-LOT-${String(vuId).padStart(4, '0')}`;
const randomTagId   = (vuId, trayNo) => `TESTTAG${String(vuId).padStart(4, '0')}${String(trayNo).padStart(2, '0')}`;

const post = (path, body, label) => {
  const res = http.post(`${BASE_URL}${path}`, JSON.stringify(body), { headers: HEADERS });
  const ok  = check(res, {
    [`${label} status 200`]: (r) => r.status === 200,
    [`${label} no error`]:   (r) => !JSON.parse(r.body || '{}').error,
  });
  if (!ok) failedRequests.add(1);
  return res;
};

export default function () {
  const vuId    = __VU;
  const barcode = randomBarcode(vuId);

  const lotData = {
    barcode,
    lot_no:       `H${String(vuId).padStart(6, '0')}`,
    material_no:  `MAT-${vuId}`,
    part_no:      '2SFR-830X10ZZMT',
    machine_no:   `M-${vuId}`,
    process_code: '1201',
    process:      'WATER WASHING 1',
    coil:         null,
    ir_diameter:  null,
    rw_diameter:  'A/F S/F -6~-3(P13)',
    process_date: new Date().toISOString(),
    quantity:     3248,
    operator:     'TEST',
  };

  const startTime = Date.now();

  // Step 1: Register lot
  const lotRes  = post('/register-lot', lotData, 'register-lot');
  const lotBody = JSON.parse(lotRes.body || '{}');

  if (lotBody.result === 'BARCODE_IN_USE') {
    console.log(`[VU${vuId}] barcode in use — skip`);
    return;
  }

  const trayCounter = lotBody.tray_counter || 2;
  sleep(0.1);

  // Step 2: Register tray
  for (let t = 1; t <= trayCounter; t++) {
    post('/register-tray', {
      tag_id: randomTagId(vuId, t),
      barcode,
      operator: 'TEST'
    }, `register-tray-${t}`);
    sleep(0.1);
  }
  sleep(0.5);

  // Step 3: Washing
  for (let t = 1; t <= trayCounter; t++) {
    post('/washing', {
      tag_id:       randomTagId(vuId, t),
      location:     'BFW1',
      machine_no:   'WS-01',
      process_code: '1201',
      process:      'WATER WASHING 1',
    }, `washing-${t}`);
    sleep(0.1);
  }
  sleep(0.5);

  // Step 4: On machine
  for (let t = 1; t <= trayCounter; t++) {
    post('/on-machine', {
      tag_id:       randomTagId(vuId, t),
      machine_no:   `FL-0${(vuId % 5) + 1}`,
      process_code: '1520',
      process:      'AUTO MATCHING',
    }, `on-machine-${t}`);
    sleep(0.1);
  }
  sleep(0.5);

  // Step 5: Completed
  for (let t = 1; t <= trayCounter; t++) {
    post('/completed', {
      tag_id: randomTagId(vuId, t)
    }, `completed-${t}`);
    sleep(0.1);
  }

  lotDuration.add(Date.now() - startTime);
}