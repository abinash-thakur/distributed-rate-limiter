import { Injectable, OnModuleInit } from '@nestjs/common';
import { RedisService } from '../redis/redis.service';
import { RateLimitAlgorithm } from './rate-limit.decorator';
import { RateLimitAlgorithmEnum } from '../utils/enum/rate-limit.enum';
import * as fs from 'fs';
import * as path from 'path';

export interface RateLimitResult {
    allowed: boolean;
    remaining: number;
    resetAt: number;
}

@Injectable()
export class RateLimitService implements OnModuleInit {
    private scripts: Record<RateLimitAlgorithm, string> = {} as any;

    constructor(private readonly redis: RedisService) {}

    onModuleInit() {
        const luaDir = path.join(process.cwd(), 'lua');
        this.scripts[RateLimitAlgorithmEnum.FIXED_WINDOW] = fs.readFileSync(
            path.join(luaDir, 'fixed-window.lua'),
            'utf8',
        );
        this.scripts[RateLimitAlgorithmEnum.SLIDING_WINDOW] = fs.readFileSync(
            path.join(luaDir, 'sliding-window.lua'),
            'utf8',
        );
        this.scripts[RateLimitAlgorithmEnum.TOKEN_BUCKET] = fs.readFileSync(
            path.join(luaDir, 'token-bucket.lua'),
            'utf8',
        );
    }

    async check(
        algorithm: RateLimitAlgorithm,
        key: string,
        limit: number,
        window: number,
    ): Promise<RateLimitResult> {
        const now = Date.now();
        const script = this.scripts[algorithm];

        const secondArg =
            algorithm === RateLimitAlgorithmEnum.TOKEN_BUCKET ? limit / window : window;

        const result = (await this.redis.client.eval(
            script,
            1,
            key,
            limit,
            secondArg,
            now,
        )) as [number, number, number];

        return {
            allowed: result[0] === 1,
            remaining: result[1],
            resetAt: result[2],
        };
    }
}
