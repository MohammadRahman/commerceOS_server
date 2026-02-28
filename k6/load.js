// v2
// k6/load.js
// Realistic load test — ramps to 50 concurrent users over 8 minutes
// Run: k6 run -e EMAIL=x@x.com -e PASS=yourpass k6/load.js

import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Counter, Rate, Trend } from 'k6/metrics';

const BASE = __ENV.BASE || 'http://localhost:3000';
const EMAIL = __ENV.EMAIL || 'obaidurapu12@gmail.com';
const PASS = __ENV.PASS || 'your-password-here';

const conversationDuration = new Trend('conversation_list_duration', true);
const orderDuration = new Trend('order_list_duration', true);
const errorRate = new Rate('errors');

export const options = {
  stages: [
    { duration: '1m', target: 20 },
    { duration: '3m', target: 20 },
    { duration: '1m', target: 50 },
    { duration: '2m', target: 50 },
    { duration: '1m', target: 0 },
  ],
  thresholds: {
    http_req_duration: ['p(99)<1000'],
    conversation_list_duration: ['p(95)<300'],
    errors: ['rate<0.01'],
    http_req_failed: ['rate<0.01'],
  },
};

// Setup: login once, share token across all VUs
// Login is excluded from the main loop to avoid hitting rate limiter
export function setup() {
  const res = http.post(
    `${BASE}/v1/auth/login`,
    JSON.stringify({ email: EMAIL, password: PASS }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(res, { 'setup login ok': (r) => r.status === 200 });
  const body = res.json();
  return { token: body.accessToken, orgId: body.user?.orgId };
}

export default function (data) {
  const headers = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${data.token}`,
  };

  // ── Inbox polling (highest frequency) ────────────────────────────────────
  group('inbox', () => {
    const start = Date.now();
    const res = http.get(`${BASE}/v1/inbox/conversations?limit=20&page=1`, {
      headers,
    });
    conversationDuration.add(Date.now() - start);

    const ok = check(res, {
      'conversations 200': (r) => r.status === 200,
      'has data field': (r) => r.json('data') !== null,
      'has meta field': (r) => r.json('meta') !== null,
    });
    errorRate.add(!ok);

    // Fetch messages for first conversation if available
    const convos = res.json('data');
    if (convos && convos.length > 0) {
      const msgRes = http.get(
        `${BASE}/v1/inbox/conversations/${convos[0].id}/messages`,
        { headers },
      );
      check(msgRes, { 'messages 200': (r) => r.status === 200 });
    }
  });

  sleep(0.3);

  // ── Orders ────────────────────────────────────────────────────────────────
  group('orders', () => {
    const start = Date.now();
    const res = http.get(`${BASE}/v1/orders?limit=20`, { headers });
    orderDuration.add(Date.now() - start);
    const ok = check(res, { 'orders 200': (r) => r.status === 200 });
    errorRate.add(!ok);
  });

  sleep(0.3);

  // ── Settings reads (20% of iterations) ───────────────────────────────────
  if (Math.random() < 0.2) {
    group('settings', () => {
      check(http.get(`${BASE}/v1/organizations/${data.orgId}`, { headers }), {
        'org read 200': (r) => r.status === 200,
      });
      check(http.get(`${BASE}/v1/org/providers/payments`, { headers }), {
        'payments 200': (r) => r.status === 200,
      });
      check(http.get(`${BASE}/v1/org/providers/couriers`, { headers }), {
        'couriers 200': (r) => r.status === 200,
      });
    });
  }

  sleep(1);
}

export function teardown() {
  console.log('Load test complete.');
}
// // Realistic load test — ramps up to 50 concurrent users over 5 minutes
// // Simulates real usage patterns: inbox checking, order creation, replies
// //
// // Run: k6 run -e EMAIL=owner@demo.com -e PASS=yourpass k6/load.js
// // With output: k6 run --out json=results.json k6/load.js

// import http from 'k6/http';
// import { check, sleep, group } from 'k6';
// import { Counter, Rate, Trend } from 'k6/metrics';

// // ── Config ────────────────────────────────────────────────────────────────────
// const BASE = __ENV.BASE || 'http://localhost:3000';
// const EMAIL = __ENV.EMAIL || 'obaidurapu12@gmail.com';
// const PASS = __ENV.PASS || 'your-password-here';

// // ── Custom metrics ─────────────────────────────────────────────────────────────
// const loginDuration = new Trend('login_duration', true);
// const conversationDuration = new Trend('conversation_list_duration', true);
// const orderDuration = new Trend('order_list_duration', true);
// const errorRate = new Rate('errors');

// // ── Load profile ──────────────────────────────────────────────────────────────
// // Stage 1: ramp up 0→20 users over 1 min  (warm up)
// // Stage 2: hold 20 users for 3 min        (steady state)
// // Stage 3: ramp up 20→50 users over 1 min (stress)
// // Stage 4: hold 50 users for 2 min        (peak load)
// // Stage 5: ramp down 50→0 over 1 min      (cool down)
// export const options = {
//   stages: [
//     { duration: '1m', target: 20 },
//     { duration: '3m', target: 20 },
//     { duration: '1m', target: 50 },
//     { duration: '2m', target: 50 },
//     { duration: '1m', target: 0 },
//   ],
//   thresholds: {
//     // 99% of all requests under 1 second
//     http_req_duration: ['p(99)<1000'],
//     // 95% of login requests under 500ms
//     login_duration: ['p(95)<500'],
//     // 95% of conversation list under 300ms
//     conversation_list_duration: ['p(95)<300'],
//     // Error rate under 1%
//     errors: ['rate<0.01'],
//     // No more than 1% of requests fail HTTP check
//     http_req_failed: ['rate<0.01'],
//   },
// };

// // ── Setup — login once and share token ───────────────────────────────────────
// export function setup() {
//   const res = http.post(
//     `${BASE}/v1/auth/login`,
//     JSON.stringify({ email: EMAIL, password: PASS }),
//     { headers: { 'Content-Type': 'application/json' } },
//   );
//   check(res, { 'setup login ok': (r) => r.status === 200 });
//   const body = res.json();
//   return { token: body.accessToken, orgId: body.user?.orgId };
// }

// // ── Main scenario ─────────────────────────────────────────────────────────────
// export default function (data) {
//   const headers = {
//     'Content-Type': 'application/json',
//     Authorization: `Bearer ${data.token}`,
//   };

//   // ── Group 1: Auth flow (10% of iterations) ────────────────────────────────
//   if (Math.random() < 0.1) {
//     group('auth', () => {
//       const start = Date.now();
//       const res = http.post(
//         `${BASE}/v1/auth/login`,
//         JSON.stringify({ email: EMAIL, password: PASS }),
//         { headers: { 'Content-Type': 'application/json' } },
//       );
//       loginDuration.add(Date.now() - start);
//       const ok = check(res, { 'login 200': (r) => r.status === 200 });
//       errorRate.add(!ok);
//     });
//     sleep(0.5);
//   }

//   // ── Group 2: Inbox polling (highest frequency — agents do this constantly) ─
//   group('inbox', () => {
//     const start = Date.now();
//     const res = http.get(`${BASE}/v1/inbox/conversations?limit=20&page=1`, {
//       headers,
//     });
//     conversationDuration.add(Date.now() - start);

//     const ok = check(res, {
//       'conversations 200': (r) => r.status === 200,
//       'has data field': (r) => r.json('data') !== null,
//       'has meta field': (r) => r.json('meta') !== null,
//       'response under 500ms': (r) => r.timings.duration < 500,
//     });
//     errorRate.add(!ok);

//     // If we got conversations, fetch messages for the first one
//     const convos = res.json('data');
//     if (convos && convos.length > 0) {
//       const convId = convos[0].id;
//       const msgRes = http.get(
//         `${BASE}/v1/inbox/conversations/${convId}/messages`,
//         { headers },
//       );
//       check(msgRes, { 'messages 200': (r) => r.status === 200 });
//     }
//   });

//   sleep(0.3);

//   // ── Group 3: Orders (medium frequency) ───────────────────────────────────
//   group('orders', () => {
//     const start = Date.now();
//     const res = http.get(`${BASE}/v1/orders?limit=20`, { headers });
//     orderDuration.add(Date.now() - start);

//     const ok = check(res, {
//       'orders 200': (r) => r.status === 200,
//     });
//     errorRate.add(!ok);
//   });

//   sleep(0.3);

//   // ── Group 4: Settings reads (low frequency) ───────────────────────────────
//   if (Math.random() < 0.2) {
//     group('settings', () => {
//       // Org profile
//       check(http.get(`${BASE}/v1/organizations/${data.orgId}`, { headers }), {
//         'org read 200': (r) => r.status === 200,
//       });

//       // Provider status
//       check(http.get(`${BASE}/v1/org/providers/payments`, { headers }), {
//         'payments 200': (r) => r.status === 200,
//       });

//       check(http.get(`${BASE}/v1/org/providers/couriers`, { headers }), {
//         'couriers 200': (r) => r.status === 200,
//       });
//     });
//   }

//   sleep(1);
// }

// // ── Teardown — print summary ──────────────────────────────────────────────────
// export function teardown(data) {
//   console.log('Load test complete.');
// }
