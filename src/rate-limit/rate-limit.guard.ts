import {
    CanActivate,
    ExecutionContext,
    HttpException,
    HttpStatus,
    Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { FastifyReply, FastifyRequest } from 'fastify';
import { MetricsService } from '../metrics/metrics.service';
import { RATE_LIMIT_KEY, RateLimitOptions } from './rate-limit.decorator';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MemoryStoreService } from './memory-store.service';
import { RateLimitService } from './rate-limit.service';
import { HeaderEnum } from '../utils/enum/header.enum';
import { MetricsLabelEnum, MetricsResultEnum } from '../utils/enum/metrics.enum';
import { MessageEnum } from '../utils/enum/message.enum';

@Injectable()
export class RateLimitGuard implements CanActivate {
    constructor(
        private readonly reflector: Reflector,
        private readonly circuitBreaker: CircuitBreakerService,
        private readonly memoryStore: MemoryStoreService,
        private readonly metricsService: MetricsService,
        private readonly rateLimitService: RateLimitService,
    ) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const options = this.reflector.getAllAndOverride<RateLimitOptions>(
            RATE_LIMIT_KEY,
            [context.getHandler(), context.getClass()],
        );

        if (!options) return true;

        const req = context.switchToHttp().getRequest<FastifyRequest>();
        const res = context.switchToHttp().getResponse<FastifyReply>();

        const clientId = req.ip;
        const route = (req as any).routerPath ?? req.url;
        const key = `rl:${options.algorithm}:${clientId}:${route}`;
        const refillRate = options.limit / options.window;

        let result;
        let usedFallback = false;

        if (this.circuitBreaker.shouldBypassRedis()) {
            result = this.memoryStore.check(key, options.limit, refillRate);
            usedFallback = true;
        } else {
            const stopRedisTimer = this.metricsService.redisDuration.startTimer({
                [MetricsLabelEnum.ALGORITHM]: options.algorithm,
            });
            try {
                result = await this.rateLimitService.check(
                    options.algorithm,
                    key,
                    options.limit,
                    options.window,
                );
                this.circuitBreaker.recordSuccess();
            } catch (error) {
                this.circuitBreaker.recordFailure();
                result = this.memoryStore.check(key, options.limit, refillRate);
                usedFallback = true;
            } finally {
                stopRedisTimer();
            }
        }

        if (usedFallback) {
            this.metricsService.fallbackTotal.inc();
        }

        this.metricsService.requestsTotal.inc({
            [MetricsLabelEnum.ALGORITHM]: options.algorithm,
            [MetricsLabelEnum.RESULT]: result.allowed
                ? MetricsResultEnum.ALLOWED
                : MetricsResultEnum.DENIED,
        });

        res.header(HeaderEnum.RATE_LIMIT_LIMIT, options.limit);
        res.header(HeaderEnum.RATE_LIMIT_REMAINING, result.remaining);
        res.header(HeaderEnum.RATE_LIMIT_RESET, result.resetAt);

        if (!result.allowed) {
            res.header(HeaderEnum.RETRY_AFTER, result.resetAt - Math.floor(Date.now() / 1000));
            throw new HttpException(
                {
                    statusCode: 429,
                    message: MessageEnum.TOO_MANY_REQUESTS,
                    retryAfter: result.resetAt,
                },
                HttpStatus.TOO_MANY_REQUESTS,
            );
        }

        return true;
    }
}
