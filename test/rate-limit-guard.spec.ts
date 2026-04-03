import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsService } from '../src/metrics/metrics.service';
import { CircuitBreakerService } from '../src/rate-limit/circuit-breaker.service';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../src/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../src/rate-limit/rate-limit.guard';
import { MemoryStoreService } from '../src/rate-limit/memory-store.service';
import { RateLimitService } from '../src/rate-limit/rate-limit.service';
import { CircuitBreakerConfigEnum } from '../src/utils/enum/circuit-breaker-config.enum';
import { CircuitBreakerStateEnum } from '../src/utils/enum/circuit-breaker-state.enum';
import { RateLimitAlgorithmEnum } from '../src/utils/enum/rate-limit.enum';

describe('RateLimitGuard', () => {
    let reflector: Reflector;
    let circuitBreaker: CircuitBreakerService;
    let memoryStore: MemoryStoreService;
    let metricsService: MetricsService;
    let rateLimitService: Pick<RateLimitService, 'check'>;
    let guard: RateLimitGuard;

    const options: RateLimitOptions = {
        algorithm: RateLimitAlgorithmEnum.TOKEN_BUCKET,
        limit: 2,
        window: 60,
    };

    beforeEach(() => {
        reflector = {
            getAllAndOverride: vi.fn().mockReturnValue(options),
        } as unknown as Reflector;
        metricsService = new MetricsService();
        circuitBreaker = new CircuitBreakerService(metricsService);
        memoryStore = new MemoryStoreService();
        rateLimitService = {
            check: vi.fn(),
        };

        guard = new RateLimitGuard(
            reflector,
            circuitBreaker,
            memoryStore,
            metricsService,
            rateLimitService as RateLimitService,
        );
    });

    it('uses the in-memory fallback when Redis fails', async () => {
        vi.mocked(rateLimitService.check).mockRejectedValueOnce(new Error('redis down'));

        const result = await guard.canActivate(createContext());

        expect(result).toBe(true);
        expect(rateLimitService.check).toHaveBeenCalledTimes(1);
        expect(circuitBreaker.getState()).toBe(CircuitBreakerStateEnum.CLOSED);
    });

    it('opens the circuit after repeated Redis failures and bypasses Redis', async () => {
        vi.mocked(rateLimitService.check).mockRejectedValue(new Error('redis down'));

        for (let i = 0; i < CircuitBreakerConfigEnum.FAILURE_THRESHOLD; i++) {
            await guard.canActivate(createContext(`/token-${i}`));
        }

        expect(circuitBreaker.getState()).toBe(CircuitBreakerStateEnum.OPEN);

        vi.mocked(rateLimitService.check).mockClear();
        await guard.canActivate(createContext('/token-open'));

        expect(rateLimitService.check).not.toHaveBeenCalled();
    });
});

function createContext(url = '/token'): ExecutionContext {
    const headers: Record<string, unknown> = {};
    const req = {
        ip: '127.0.0.1',
        url,
        routerPath: url,
    };
    const res = {
        header: vi.fn((name: string, value: unknown) => {
            headers[name] = value;
            return res;
        }),
    };

    return {
        getHandler: vi.fn(),
        getClass: vi.fn(),
        switchToHttp: () => ({
            getRequest: () => req,
            getResponse: () => res,
        }),
    } as unknown as ExecutionContext;
}
