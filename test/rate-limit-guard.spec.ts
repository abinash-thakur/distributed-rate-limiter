import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MetricsService } from '../src/metrics/metrics.service';
import { CircuitBreakerService } from '../src/rate-limit/circuit-breaker.service';
import { RATE_LIMIT_KEY, RateLimitOptions } from '../src/rate-limit/rate-limit.decorator';
import { RateLimitGuard } from '../src/rate-limit/rate-limit.guard';
import { MemoryStoreService } from '../src/rate-limit/memory-store.service';
import { RateLimitService } from '../src/rate-limit/rate-limit.service';
import { CircuitBreakerConfigEnum } from '../src/utils/enum/circuit-breaker-config.enum';
import { CircuitBreakerStateEnum } from '../src/utils/enum/circuit-breaker-state.enum';
import { HeaderEnum } from '../src/utils/enum/header.enum';
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
        options.algorithm = RateLimitAlgorithmEnum.TOKEN_BUCKET;
        options.limit = 2;
        options.window = 60;
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

    afterEach(() => {
        vi.useRealTimers();
    });

    it('uses the in-memory fallback when Redis fails', async () => {
        vi.mocked(rateLimitService.check).mockRejectedValueOnce(new Error('redis down'));

        const { context } = createContext();
        const result = await guard.canActivate(context);

        expect(result).toBe(true);
        expect(rateLimitService.check).toHaveBeenCalledTimes(1);
        expect(circuitBreaker.getState()).toBe(CircuitBreakerStateEnum.CLOSED);
    });

    it('opens the circuit after repeated Redis failures and bypasses Redis', async () => {
        vi.mocked(rateLimitService.check).mockRejectedValue(new Error('redis down'));

        for (let i = 0; i < CircuitBreakerConfigEnum.FAILURE_THRESHOLD; i++) {
            const { context } = createContext(`/token-${i}`);
            await guard.canActivate(context);
        }

        expect(circuitBreaker.getState()).toBe(CircuitBreakerStateEnum.OPEN);

        vi.mocked(rateLimitService.check).mockClear();
        const { context } = createContext('/token-open');
        await guard.canActivate(context);

        expect(rateLimitService.check).not.toHaveBeenCalled();
    });

    it('keeps fixed-window semantics when the fallback store is used', async () => {
        vi.useFakeTimers();
        options.algorithm = RateLimitAlgorithmEnum.FIXED_WINDOW;
        options.limit = 2;
        options.window = 60;
        vi.spyOn(circuitBreaker, 'shouldBypassRedis').mockReturnValue(true);

        const request = createContext('/fixed-fallback');

        await expect(guard.canActivate(request.context)).resolves.toBe(true);
        await expect(guard.canActivate(request.context)).resolves.toBe(true);

        vi.advanceTimersByTime(30_000);

        await expect(guard.canActivate(request.context)).rejects.toBeDefined();
    });

    it('writes reset and retry-after headers in seconds', async () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-03T12:00:00Z'));
        options.algorithm = RateLimitAlgorithmEnum.FIXED_WINDOW;

        const resetAt = Math.floor(Date.now() / 1000) + 42;
        vi.mocked(rateLimitService.check).mockResolvedValueOnce({
            allowed: false,
            remaining: 0,
            resetAt,
        });

        const request = createContext('/fixed-denied');

        try {
            await guard.canActivate(request.context);
        } catch (error) {
            const response = (error as { getResponse: () => unknown }).getResponse() as Record<
                string,
                unknown
            >;

            expect(request.headers[HeaderEnum.RATE_LIMIT_RESET]).toBe(resetAt);
            expect(request.headers[HeaderEnum.RETRY_AFTER]).toBe(42);
            expect(response.retryAfter).toBe(42);
            expect(response.resetAt).toBe(resetAt);
            return;
        }

        throw new Error('Expected rate limit guard to reject the request');
    });
});

function createContext(url = '/token'): {
    context: ExecutionContext;
    headers: Record<string, unknown>;
} {
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
        context: {
            getHandler: vi.fn(),
            getClass: vi.fn(),
            switchToHttp: () => ({
                getRequest: () => req,
                getResponse: () => res,
            }),
        } as unknown as ExecutionContext,
        headers,
    };
}
