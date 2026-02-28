// k6/stress.js
// Stress test — find the breaking point
// Keeps ramping up until error rate spikes or latency degrades
// Run AFTER load.js passes cleanly.
//
// Run: k6 run -e EMAIL=owner@demo.com -e PASS=yourpass k6/stress.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:3000';
const EMAIL = __ENV.EMAIL || 'obaidurapu12@gmail.com';
const PASS = __ENV.PASS || 'your-password-here';

const errorRate = new Rate('errors');

// Ramp up aggressively — watch where things break
export const options = {
  stages: [
    { duration: '2m', target: 50 },
    { duration: '2m', target: 100 },
    { duration: '2m', target: 200 },
    { duration: '2m', target: 300 },
    { duration: '2m', target: 0 }, // cool down
  ],
  thresholds: {
    // Test "fails" if these are breached — tells you your limit
    http_req_duration: ['p(99)<3000'], // 3s max at stress
    errors: ['rate<0.05'], // allow up to 5% errors under stress
  },
};

export function setup() {
  const res = http.post(
    `${BASE}/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASS }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  const body = res.json();
  return { token: body.accessToken, orgId: body.user?.orgId };
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  };

  // Most common endpoint — inbox polling
  const res = http.get(`${BASE}/v1/inbox/conversations?limit=20`, { headers });

  const ok = check(res, {
    'status 200': (r) => r.status === 200,
    'under 2s': (r) => r.timings.duration < 2000,
  });
  errorRate.add(!ok);

  sleep(0.5);
}
