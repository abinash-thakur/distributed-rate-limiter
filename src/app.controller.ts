import { Controller, Get, UseGuards } from '@nestjs/common';
import { RateLimit } from './rate-limit/rate-limit.decorator';
import { RateLimitGuard } from './rate-limit/rate-limit.guard';
import { RateLimitAlgorithmEnum } from './utils/enum/rate-limit.enum';
import { MessageEnum } from './utils/enum/message.enum';

@Controller()
@UseGuards(RateLimitGuard)
export class AppController {
    @Get('/fixed')
    @RateLimit({ algorithm: RateLimitAlgorithmEnum.FIXED_WINDOW, limit: 10, window: 60 })
    fixed() {
        return { algorithm: RateLimitAlgorithmEnum.FIXED_WINDOW, message: 'Request allowed' };
    }

    @Get('/sliding')
    @RateLimit({ algorithm: RateLimitAlgorithmEnum.SLIDING_WINDOW, limit: 10, window: 60 })
    sliding() {
        return { algorithm: RateLimitAlgorithmEnum.SLIDING_WINDOW, message: 'Request allowed' };
    }

    @Get('/token')
    // 10 tokens per minute (capacity=10, refill ≈0.1667/sec)
    @RateLimit({ algorithm: RateLimitAlgorithmEnum.TOKEN_BUCKET, limit: 1, window: 1 })
    token() {
        return { algorithm: RateLimitAlgorithmEnum.TOKEN_BUCKET, message: 'Request allowed' };
    }

    @Get('/health')
    health() {
        return { status: MessageEnum.HEALTH_OK };
    }
}
