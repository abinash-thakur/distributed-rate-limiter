export enum MessageEnum {
    TOO_MANY_REQUESTS = 'Too many requests',
    HEALTH_OK = 'ok',
    REQUEST_ALLOWED = 'Request allowed',
    CIRCUIT_BREAKER_HALF_OPEN = 'Circuit breaker: HALF_OPEN - probing Redis',
    CIRCUIT_BREAKER_CLOSED = 'Circuit breaker: CLOSED - Redis recovered',
    CIRCUIT_BREAKER_OPEN = 'Circuit breaker: OPEN - switching to in-memory fallback',
}
