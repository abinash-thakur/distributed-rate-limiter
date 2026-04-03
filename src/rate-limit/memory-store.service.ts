import { Injectable } from '@nestjs/common';
import { RateLimitResult } from './rate-limit.service';
import { MemoryStoreEnum } from '../utils/enum/memory-store.enum';

interface Bucket {
    tokens: number;
    lastRefill: number;
}

@Injectable()
export class MemoryStoreService {
    private readonly store = new Map<string, Bucket>();

    check(key: string, capacity: number, refillRate: number): RateLimitResult {
        const now = Date.now();
        const bucket = this.store.get(key) ?? { tokens: capacity, lastRefill: now };
        const elapsedSeconds = (now - bucket.lastRefill) / 1000;

        bucket.tokens = Math.min(capacity, bucket.tokens + elapsedSeconds * refillRate);
        bucket.lastRefill = now;

        if (bucket.tokens < 1) {
            this.store.set(key, bucket);

            const waitSeconds = Math.max((1 - bucket.tokens) / refillRate, 0);
            return {
                allowed: false,
                remaining: 0,
                resetAt: Math.floor(now / 1000 + waitSeconds),
            };
        }

        bucket.tokens -= 1;
        this.store.set(key, bucket);

        const secondsUntilFull = Math.max((capacity - bucket.tokens) / refillRate, 0);
        return {
            allowed: true,
            remaining: Math.floor(bucket.tokens),
            resetAt: Math.floor(now / 1000 + secondsUntilFull),
        };
    }

    cleanup(olderThanMs = MemoryStoreEnum.CLEANUP_OLDER_THAN_MS): void {
        const cutoff = Date.now() - olderThanMs;

        for (const [key, bucket] of this.store.entries()) {
            if (bucket.lastRefill < cutoff) {
                this.store.delete(key);
            }
        }
    }
}
