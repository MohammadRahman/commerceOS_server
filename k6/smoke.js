// k6/smoke.js
// Quick sanity check — 1 virtual user, 1 minute, just verifies everything responds
// Run: k6 run k6/smoke.js
//
// Pass credentials via env:
// k6 run -e EMAIL=owner@demo.com -e PASS=yourpass -e BASE=http://localhost:3000 k6/smoke.js

import http from 'k6/http';
import { check, sleep } from 'k6';
import { Trend, Rate } from 'k6/metrics';

// ── Config ────────────────────────────────────────────────────────────────────
const BASE = __ENV.BASE || 'http://localhost:3000';
const EMAIL = __ENV.EMAIL || 'obaidurapu12@gmail.com';
const PASS = __ENV.PASS || 'your-password-here';

export const options = {
  vus: 1,
  duration: '30s',
  thresholds: {
    http_req_failed: ['rate<0.01'], // <1% errors
    http_req_duration: ['p(95)<500'], // 95% of requests under 500ms
  },
};

// ── Shared state ──────────────────────────────────────────────────────────────
let token = '';
let orgId = '';

// ── Setup — runs once before test ─────────────────────────────────────────────
export function setup() {
  const res = http.post(
    `${BASE}/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASS }),
    { headers: { 'Content-Type': 'application/json' } },
  );

  check(res, { 'login 200': (r) => r.status === 200 });

  const body = res.json();
  return {
    token: body.accessToken,
    orgId: body.user?.orgId,
  };
}

// ── Main test loop ─────────────────────────────────────────────────────────────
export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  };

  // Health
  check(http.get(`${BASE}/health/live`), {
    'health live 200': (r) => r.status === 200,
  });

  // Onboarding state
  check(http.get(`${BASE}/v1/onboarding/state`, { headers }), {
    'onboarding state 200': (r) => r.status === 200,
  });

  // Team list
  check(http.get(`${BASE}/v1/organizations/${data.orgId}/team`, { headers }), {
    'team list 200': (r) => r.status === 200,
  });

  // Conversations
  check(http.get(`${BASE}/v1/inbox/conversations?limit=10`, { headers }), {
    'conversations 200': (r) => r.status === 200,
  });

  // Payment providers
  check(http.get(`${BASE}/v1/org/providers/payments`, { headers }), {
    'payments 200': (r) => r.status === 200,
  });

  // Courier providers
  check(http.get(`${BASE}/v1/org/providers/couriers`, { headers }), {
    'couriers 200': (r) => r.status === 200,
  });

  // Orders
  check(http.get(`${BASE}/v1/orders?limit=10`, { headers }), {
    'orders 200': (r) => r.status === 200,
  });

  sleep(1);
}
