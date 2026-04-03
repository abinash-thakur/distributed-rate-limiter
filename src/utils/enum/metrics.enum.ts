export enum MetricsNameEnum {
    REQUESTS_TOTAL = 'rate_limit_requests_total',
    REDIS_DURATION = 'rate_limit_redis_duration_ms',
    CIRCUIT_BREAKER_STATE = 'rate_limit_circuit_breaker_state',
    FALLBACK_TOTAL = 'rate_limit_fallback_requests_total',
}

export enum MetricsHelpEnum {
    REQUESTS_TOTAL = 'Total rate limit decisions',
    REDIS_DURATION = 'Redis Lua script execution time in ms',
    CIRCUIT_BREAKER_STATE = 'Circuit breaker state: 0=closed 1=open 2=half_open',
    FALLBACK_TOTAL = 'Requests handled by in-memory fallback',
}

export enum MetricsLabelEnum {
    ALGORITHM = 'algorithm',
    RESULT = 'result',
}

export enum MetricsResultEnum {
    ALLOWED = 'allowed',
    DENIED = 'denied',
}

export enum CircuitBreakerStateMetricEnum {
    CLOSED = 0,
    OPEN = 1,
    HALF_OPEN = 2,
}
