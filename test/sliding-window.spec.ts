import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RateLimitService } from '../src/rate-limit/rate-limit.service';
import { RedisService } from '../src/redis/redis.service';
import { RateLimitAlgorithmEnum } from '../src/utils/enum/rate-limit.enum';

describe('Sliding window algorithm', () => {
    let service: RateLimitService;
    let redis: RedisService;
    const TEST_DB = 1;

    beforeEach(async () => {
        redis = new RedisService();
        await redis.onModuleInit();
        await redis.client.select(TEST_DB);
        service = new RateLimitService(redis);
        service.onModuleInit();
        await redis.client.flushdb();
    });

    afterEach(async () => {
        await redis.onModuleDestroy();
    });

    it('allows requests under the limit', async () => {
        const result = await service.check(RateLimitAlgorithmEnum.SLIDING_WINDOW, 'test:sw:1', 5, 60);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBe(4);
    });

    it('denies request exactly at the limit', async () => {
        const key = 'test:sw:2';
        for (let i = 0; i < 5; i++) {
            await service.check(RateLimitAlgorithmEnum.SLIDING_WINDOW, key, 5, 60);
        }
        const result = await service.check(RateLimitAlgorithmEnum.SLIDING_WINDOW, key, 5, 60);
        expect(result.allowed).toBe(false);
        expect(result.remaining).toBe(0);
    });

    it('resets after the window expires', async () => {
        const key = 'test:sw:3';
        for (let i = 0; i < 5; i++) {
            await service.check(RateLimitAlgorithmEnum.SLIDING_WINDOW, key, 5, 1);
        }
        await redis.client.del(key);
        const result = await service.check(RateLimitAlgorithmEnum.SLIDING_WINDOW, key, 5, 1);
        expect(result.allowed).toBe(true);
    });
});
