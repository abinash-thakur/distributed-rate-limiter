import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStoreService } from '../src/rate-limit/memory-store.service';

describe('MemoryStoreService', () => {
    let service: MemoryStoreService;

    beforeEach(() => {
        service = new MemoryStoreService();
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-04-03T12:00:00Z'));
    });

    it('limits requests when the in-memory bucket is exhausted', () => {
        const key = 'memory:test:1';

        for (let i = 0; i < 5; i++) {
            expect(service.check(key, 5, 1).allowed).toBe(true);
        }

        expect(service.check(key, 5, 1).allowed).toBe(false);
    });

    it('refills tokens over time', () => {
        const key = 'memory:test:2';

        for (let i = 0; i < 5; i++) {
            service.check(key, 5, 1);
        }

        vi.advanceTimersByTime(1_500);

        const result = service.check(key, 5, 1);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBeGreaterThanOrEqual(0);
    });
});
