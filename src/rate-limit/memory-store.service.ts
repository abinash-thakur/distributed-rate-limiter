import { Injectable } from '@nestjs/common';
import { RateLimitAlgorithm } from './rate-limit.decorator';
import { RateLimitResult } from './rate-limit.service';
import { MemoryStoreEnum } from '../utils/enum/memory-store.enum';
import { RateLimitAlgorithmEnum } from '../utils/enum/rate-limit.enum';

interface TokenBucketState {
    tokens: number;
    lastRefill: number;
}

interface FixedWindowState {
    count: number;
    resetAt: number;
}

interface SlidingWindowState {
    timestamps: number[];
}

type MemoryStoreEntry = TokenBucketState | FixedWindowState | SlidingWindowState;

@Injectable()
export class MemoryStoreService {
    private readonly store = new Map<string, MemoryStoreEntry>();

    check(
        algorithm: RateLimitAlgorithm,
        key: string,
        limit: number,
        window: number,
    ): RateLimitResult {
        switch (algorithm) {
            case RateLimitAlgorithmEnum.FIXED_WINDOW:
                return this.checkFixedWindow(key, limit, window);
            case RateLimitAlgorithmEnum.SLIDING_WINDOW:
                return this.checkSlidingWindow(key, limit, window);
            case RateLimitAlgorithmEnum.TOKEN_BUCKET:
                return this.checkTokenBucket(key, limit, window);
            default:
                return this.checkTokenBucket(key, limit, window);
        }
    }

    private checkFixedWindow(key: string, limit: number, window: number): RateLimitResult {
        const now = Date.now();
        const windowMs = window * 1000;
        const existing = this.store.get(key) as FixedWindowState | undefined;
        const bucket =
            existing && existing.resetAt > now
                ? existing
                : { count: 0, resetAt: now + windowMs };

        if (bucket.count >= limit) {
            this.store.set(key, bucket);

            return {
                allowed: false,
                remaining: 0,
                resetAt: Math.floor(bucket.resetAt / 1000),
            };
        }

        bucket.count += 1;
        this.store.set(key, bucket);

        return {
            allowed: true,
            remaining: limit - bucket.count,
            resetAt: Math.floor(bucket.resetAt / 1000),
        };
    }

    private checkSlidingWindow(key: string, limit: number, window: number): RateLimitResult {
        const now = Date.now();
        const windowMs = window * 1000;
        const windowStart = now - windowMs;
        const existing = this.store.get(key) as SlidingWindowState | undefined;
        const timestamps = (existing?.timestamps ?? []).filter((timestamp) => timestamp > windowStart);

        if (timestamps.length >= limit) {
            this.store.set(key, { timestamps });

            return {
                allowed: false,
                remaining: 0,
                resetAt: Math.floor((timestamps[0] + windowMs) / 1000),
            };
        }

        timestamps.push(now);
        this.store.set(key, { timestamps });

        return {
            allowed: true,
            remaining: limit - timestamps.length,
            resetAt: Math.floor((now + windowMs) / 1000),
        };
    }

    private checkTokenBucket(key: string, capacity: number, window: number): RateLimitResult {
        const now = Date.now();
        const refillRate = capacity / window;
        const bucket = (this.store.get(key) as TokenBucketState | undefined) ?? {
            tokens: capacity,
            lastRefill: now,
        };
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

        for (const [key, entry] of this.store.entries()) {
            if ('lastRefill' in entry) {
                if (entry.lastRefill < cutoff) {
                    this.store.delete(key);
                }
                continue;
            }

            if ('resetAt' in entry) {
                if (entry.resetAt <= Date.now()) {
                    this.store.delete(key);
                }
                continue;
            }

            if (entry.timestamps.length === 0 || entry.timestamps[entry.timestamps.length - 1] < cutoff) {
                this.store.delete(key);
            }
        }
    }
}
