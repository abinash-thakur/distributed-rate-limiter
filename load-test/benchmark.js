import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
const PEAK_VUS = Number(__ENV.PEAK_VUS || 300);
const P99_TARGET = Number(__ENV.P99_TARGET || 5);
// Per-user think time (seconds). Models real concurrent users instead of
// saturating the server with threads. Set THINK=0 for a pure stress test.
const THINK = Number(__ENV.THINK ?? 1);

const expectedStatuses = http.expectedStatuses(200, 429);
http.setResponseCallback(expectedStatuses);

const deniedRate = new Rate('http_429_rate');
const decisionDuration = new Trend('rate_limit_decision_duration', true);

export const options = {
    scenarios: {
        sustained_concurrency: {
            executor: 'ramping-vus',
            startVUs: 0,
            stages: [
                { duration: '30s', target: PEAK_VUS },
                { duration: '60s', target: PEAK_VUS },
                { duration: '10s', target: 0 },
            ],
            exec: 'hitRateLimiter',
            tags: { scenario: 'sustained-concurrency' },
        },
    },
    thresholds: {
        rate_limit_decision_duration: [`p(99) < ${P99_TARGET}`],
        http_req_failed: ['rate < 0.01'],
    },
    summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

const endpoints = ['/fixed', '/sliding', '/token'];

export function hitRateLimiter() {
    const endpoint = endpoints[__ITER % endpoints.length];
    const res = http.get(`${BASE_URL}${endpoint}`);

    decisionDuration.add(res.timings.duration);
    deniedRate.add(res.status === 429);

    check(res, {
        'status is 200 or 429': (r) => r.status === 200 || r.status === 429,
    });

    if (THINK > 0) {
        sleep(THINK);
    }
}
