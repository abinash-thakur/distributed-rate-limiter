import { Module } from '@nestjs/common';
import { MetricsModule } from '../metrics/metrics.module';
import { CircuitBreakerService } from './circuit-breaker.service';
import { MemoryStoreService } from './memory-store.service';
import { RateLimitGuard } from './rate-limit.guard';
import { RateLimitService } from './rate-limit.service';

@Module({
    imports: [MetricsModule],
    providers: [CircuitBreakerService, MemoryStoreService, RateLimitService, RateLimitGuard],
    exports: [CircuitBreakerService, MemoryStoreService, RateLimitService, RateLimitGuard],
})
export class RateLimitModule {}
