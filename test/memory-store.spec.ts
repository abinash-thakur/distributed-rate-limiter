import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStoreService } from '../src/rate-limit/memory-store.service';
import { RateLimitAlgorithmEnum } from '../src/utils/enum/rate-limit.enum';

describe('MemoryStoreService', () => {
    let service: MemoryStoreService;

    beforeEach(() => {
        service = new MemoryStoreService();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-03T12:00:00Z'));
    });

    afterEach(() => {
        vi.useRealTimers();
    });

    it('preserves fixed-window semantics during fallback', () => {
        const key = 'memory:fixed-window:1';

        expect(service.check(RateLimitAlgorithmEnum.FIXED_WINDOW, key, 2, 60).allowed).toBe(true);
        expect(service.check(RateLimitAlgorithmEnum.FIXED_WINDOW, key, 2, 60).allowed).toBe(true);

        vi.advanceTimersByTime(30_000);

        expect(service.check(RateLimitAlgorithmEnum.FIXED_WINDOW, key, 2, 60).allowed).toBe(false);

        vi.advanceTimersByTime(30_000);

        expect(service.check(RateLimitAlgorithmEnum.FIXED_WINDOW, key, 2, 60).allowed).toBe(true);
    });

    it('preserves sliding-window semantics during fallback', () => {
        const key = 'memory:sliding-window:1';

        expect(service.check(RateLimitAlgorithmEnum.SLIDING_WINDOW, key, 2, 1).allowed).toBe(true);
        expect(service.check(RateLimitAlgorithmEnum.SLIDING_WINDOW, key, 2, 1).allowed).toBe(true);
        expect(service.check(RateLimitAlgorithmEnum.SLIDING_WINDOW, key, 2, 1).allowed).toBe(false);

        vi.advanceTimersByTime(1_100);

        expect(service.check(RateLimitAlgorithmEnum.SLIDING_WINDOW, key, 2, 1).allowed).toBe(true);
    });

    it('limits requests when the in-memory token bucket is exhausted', () => {
        const key = 'memory:token-bucket:1';

        for (let i = 0; i < 5; i++) {
            expect(service.check(RateLimitAlgorithmEnum.TOKEN_BUCKET, key, 5, 1).allowed).toBe(true);
        }

        expect(service.check(RateLimitAlgorithmEnum.TOKEN_BUCKET, key, 5, 1).allowed).toBe(false);
    });

    it('refills tokens over time', () => {
        const key = 'memory:token-bucket:2';

        for (let i = 0; i < 5; i++) {
            service.check(RateLimitAlgorithmEnum.TOKEN_BUCKET, key, 5, 1);
        }

        vi.advanceTimersByTime(1_500);

        const result = service.check(RateLimitAlgorithmEnum.TOKEN_BUCKET, key, 5, 1);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBeGreaterThanOrEqual(0);
    });
});
