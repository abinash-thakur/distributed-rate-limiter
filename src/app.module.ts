import { Module } from '@nestjs/common';
import { MetricsModule } from './metrics/metrics.module';
import { RedisModule } from './redis/redis.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { AppController } from './app.controller';

@Module({
    imports: [MetricsModule, RedisModule, RateLimitModule],
    controllers: [AppController],
})
export class AppModule {}
