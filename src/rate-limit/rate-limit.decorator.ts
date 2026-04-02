import { SetMetadata } from '@nestjs/common';
import { RateLimitAlgorithmEnum } from '../utils/enum/rate-limit.enum';

export type RateLimitAlgorithm = RateLimitAlgorithmEnum;

export interface RateLimitOptions {
    algorithm: RateLimitAlgorithm;
    limit: number;
    window: number; // in seconds
}

export const RATE_LIMIT_KEY = 'rate_limit';
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
