import { Module } from '@nestjs/common';
import { RedisModule } from './redis/redis.module';
import { RateLimitModule } from './rate-limit/rate-limit.module';
import { AppController } from './app.controller';

@Module({
    imports: [RedisModule, RateLimitModule],
    controllers: [AppController],
})
export class AppModule {}
