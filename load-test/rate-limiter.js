import http from 'k6/http';
import { check, sleep } from 'k6';
import { Rate, Trend } from 'k6/metrics';

const BASE_URL = __ENV.BASE_URL || 'http://localhost:3000';
 const expectedStatuses = http.expectedStatuses(200, 429);

 http.setResponseCallback(expectedStatuses);

const deniedRate = new Rate('http_429_rate');
const fixedDuration = new Trend('fixed_window_duration', true);
const slidingDuration = new Trend('sliding_window_duration', true);
const tokenDuration = new Trend('token_bucket_duration', true);

export const options = {
    scenarios: {
        fixed_window_burst: {
            executor: 'shared-iterations',
            vus: 5,
            iterations: 20,
            maxDuration: '15s',
            exec: 'testFixedWindow',
            startTime: '0s',
            tags: { algorithm: 'fixed-window', scenario: 'burst' },
        },
        sliding_window_burst: {
            executor: 'shared-iterations',
            vus: 5,
            iterations: 20,
            maxDuration: '15s',
            exec: 'testSlidingWindow',
            startTime: '0s',
            tags: { algorithm: 'sliding-window', scenario: 'burst' },
        },
        token_bucket_burst: {
            executor: 'shared-iterations',
            vus: 5,
            iterations: 20,
            maxDuration: '15s',
            exec: 'testTokenBucket',
            startTime: '0s',
            tags: { algorithm: 'token-bucket', scenario: 'burst' },
        },
        sustained_mixed_load: {
            executor: 'constant-arrival-rate',
            rate: 15,
            timeUnit: '1s',
            duration: '30s',
            preAllocatedVUs: 10,
            maxVUs: 30,
            exec: 'testMixedTraffic',
            startTime: '20s',
            tags: { scenario: 'mixed-load' },
        },
    },
    thresholds: {
        http_429_rate: ['rate > 0.05'],
        fixed_window_duration: ['p(95) < 200'],
        sliding_window_duration: ['p(95) < 200'],
        token_bucket_duration: ['p(95) < 200'],
        http_req_failed: ['rate < 0.05'],
    },
    summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'p(99)', 'max'],
};

function getHeaderValue(headers, expectedName) {
    const normalizedName = expectedName.toLowerCase();
    const matchedKey = Object.keys(headers).find((key) => key.toLowerCase() === normalizedName);

    if (!matchedKey) {
        return undefined;
    }

    const value = headers[matchedKey];

    if (Array.isArray(value)) {
        return value[0];
    }

    return value;
}

function validateResponse(res, endpoint) {
    const isExpectedStatus = res.status === 200 || res.status === 429;
    deniedRate.add(res.status === 429);

    check(res, {
        [`${endpoint} returns 200 or 429`]: () => isExpectedStatus,
        [`${endpoint} returns rate limit header`]: (r) => getHeaderValue(r.headers, 'x-ratelimit-limit') !== undefined,
        [`${endpoint} returns remaining header`]: (r) =>
            getHeaderValue(r.headers, 'x-ratelimit-remaining') !== undefined,
        [`${endpoint} returns reset header`]: (r) => getHeaderValue(r.headers, 'x-ratelimit-reset') !== undefined,
    });

    if (res.status === 429) {
        check(res, {
            [`${endpoint} returns retry-after header`]: (r) =>
                getHeaderValue(r.headers, 'retry-after') !== undefined,
        });
    }
}

function runRequest(endpoint, trend) {
    const res = http.get(`${BASE_URL}${endpoint}`);
    trend.add(res.timings.duration);
    validateResponse(res, endpoint);
    return res;
}

export function testFixedWindow() {
    runRequest('/fixed', fixedDuration);
}

export function testSlidingWindow() {
    runRequest('/sliding', slidingDuration);
}

export function testTokenBucket() {
    runRequest('/token', tokenDuration);
}

export function testMixedTraffic() {
    const endpoints = [
        { path: '/fixed', trend: fixedDuration },
        { path: '/sliding', trend: slidingDuration },
        { path: '/token', trend: tokenDuration },
    ];
    const endpoint = endpoints[__ITER % endpoints.length];
    runRequest(endpoint.path, endpoint.trend);
    sleep(0.1);
}
