import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RateLimitService } from '../src/rate-limit/rate-limit.service';
import { RedisService } from '../src/redis/redis.service';
import { RateLimitAlgorithmEnum } from '../src/utils/enum/rate-limit.enum';

describe('Token bucket algorithm', () => {
    let service: RateLimitService;
    let redis: RedisService;
    const TEST_DB = 2;

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

    it('allows requests under the capacity', async () => {
        const result = await service.check(RateLimitAlgorithmEnum.TOKEN_BUCKET, 'test:tb:1', 5, 1);
        expect(result.allowed).toBe(true);
        expect(result.remaining).toBeGreaterThanOrEqual(3);
    });

    it('denies when bucket is empty', async () => {
        const key = 'test:tb:2';
        for (let i = 0; i < 5; i++) {
            await service.check(RateLimitAlgorithmEnum.TOKEN_BUCKET, key, 5, 1);
        }
        const result = await service.check(RateLimitAlgorithmEnum.TOKEN_BUCKET, key, 5, 1);
        expect(result.allowed).toBe(false);
    });

    it('refills after time passes', async () => {
        const key = 'test:tb:3';
        for (let i = 0; i < 5; i++) {
            await service.check(RateLimitAlgorithmEnum.TOKEN_BUCKET, key, 5, 1);
        }
        await new Promise((resolve) => setTimeout(resolve, 1200));
        const result = await service.check(RateLimitAlgorithmEnum.TOKEN_BUCKET, key, 5, 1);
        expect(result.allowed).toBe(true);
    });
});
