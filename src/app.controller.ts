import { Controller, Get, Res, UseGuards } from '@nestjs/common';
import { FastifyReply } from 'fastify';
import { MetricsService } from './metrics/metrics.service';
import { RateLimit } from './rate-limit/rate-limit.decorator';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RateLimitAlgorithmEnum } from './utils/enum/rate-limit.enum';
import { MessageEnum } from './utils/enum/message.enum';

@Controller()
@UseGuards(RateLimitGuard)
export class AppController {
    constructor(private readonly metricsService: MetricsService) {}

    @Get('/fixed')
    @RateLimit({ algorithm: RateLimitAlgorithmEnum.FIXED_WINDOW, limit: 10, window: 60 })
    fixed() {
        return { algorithm: RateLimitAlgorithmEnum.FIXED_WINDOW, message: MessageEnum.REQUEST_ALLOWED };
    }

    @Get('/sliding')
    @RateLimit({ algorithm: RateLimitAlgorithmEnum.SLIDING_WINDOW, limit: 10, window: 60 })
    sliding() {
        return {
            algorithm: RateLimitAlgorithmEnum.SLIDING_WINDOW,
            message: MessageEnum.REQUEST_ALLOWED,
        };
    }

    @Get('/token')
    // 10 tokens per minute (capacity=10, refill ≈0.1667/sec)
    @RateLimit({ algorithm: RateLimitAlgorithmEnum.TOKEN_BUCKET, limit: 1, window: 1 })
    token() {
        return { algorithm: RateLimitAlgorithmEnum.TOKEN_BUCKET, message: MessageEnum.REQUEST_ALLOWED };
    }

    @Get('/health')
    health() {
        return { status: MessageEnum.HEALTH_OK };
    }

    @Get('/metrics')
    async metrics(@Res() res: FastifyReply) {
        const metrics = await this.metricsService.registry.metrics();
        res.header('Content-Type', this.metricsService.registry.contentType);
        res.send(metrics);
    }
}
