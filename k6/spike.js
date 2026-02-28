// k6/spike.js
// Spike test — simulates a sudden burst (flash sale, viral post, etc.)
// Goes from 0 to 200 users instantly, holds for 1 min, then drops
//
// Run: k6 run -e EMAIL=owner@demo.com -e PASS=yourpass k6/spike.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:3000';
const EMAIL = __ENV.EMAIL || 'obaidurapu12@gmail.com';
const PASS = __ENV.PASS || 'your-password-here';

const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '10s', target: 200 }, // instant spike
    { duration: '1m', target: 200 }, // hold the spike
    { duration: '10s', target: 0 }, // instant drop
  ],
  thresholds: {
    http_req_duration: ['p(95)<5000'], // allow up to 5s during spike
    errors: ['rate<0.10'], // allow up to 10% errors during spike
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
    Authorization: `Bearer ${data.token}`,
    'Content-Type': 'application/json',
  };

  // Hit the most expensive endpoints during spike
  const r1 = http.get(`${BASE}/v1/inbox/conversations?limit=20`, { headers });
  errorRate.add(!check(r1, { 'conversations ok': (r) => r.status === 200 }));

  const r2 = http.get(`${BASE}/v1/orders?limit=20`, { headers });
  errorRate.add(!check(r2, { 'orders ok': (r) => r.status === 200 }));

  sleep(0.2);
}
