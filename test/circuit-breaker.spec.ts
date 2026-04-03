import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CircuitBreakerService } from '../src/rate-limit/circuit-breaker.service';
import { MetricsService } from '../src/metrics/metrics.service';
import { CircuitBreakerConfigEnum } from '../src/utils/enum/circuit-breaker-config.enum';
import { CircuitBreakerStateEnum } from '../src/utils/enum/circuit-breaker-state.enum';

describe('CircuitBreakerService', () => {
    let service: CircuitBreakerService;

    beforeEach(() => {
        service = new CircuitBreakerService(new MetricsService());
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-03T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('opens after the failure threshold is reached', () => {
        for (let i = 0; i < CircuitBreakerConfigEnum.FAILURE_THRESHOLD; i++) {
            service.recordFailure();
        }

        expect(service.getState()).toBe(CircuitBreakerStateEnum.OPEN);
        expect(service.shouldBypassRedis()).toBe(true);
    });

    it('transitions to half-open after the recovery timeout', () => {
        for (let i = 0; i < CircuitBreakerConfigEnum.FAILURE_THRESHOLD; i++) {
            service.recordFailure();
        }

        vi.advanceTimersByTime(CircuitBreakerConfigEnum.RECOVERY_TIMEOUT_MS + 1);

        expect(service.shouldBypassRedis()).toBe(false);
        expect(service.getState()).toBe(CircuitBreakerStateEnum.HALF_OPEN);
        expect(service.shouldBypassRedis()).toBe(true);
    });

    it('closes after a successful recovery probe', () => {
        for (let i = 0; i < CircuitBreakerConfigEnum.FAILURE_THRESHOLD; i++) {
            service.recordFailure();
        }

        vi.advanceTimersByTime(CircuitBreakerConfigEnum.RECOVERY_TIMEOUT_MS + 1);
        expect(service.shouldBypassRedis()).toBe(false);

        service.recordSuccess();

        expect(service.getState()).toBe(CircuitBreakerStateEnum.CLOSED);
        expect(service.shouldBypassRedis()).toBe(false);
    });
});
