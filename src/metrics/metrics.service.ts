import { Injectable } from '@nestjs/common';
import { Counter, Gauge, Histogram, Registry } from 'prom-client';
import {
    MetricsHelpEnum,
    MetricsLabelEnum,
    MetricsNameEnum,
} from '../utils/enum/metrics.enum';

@Injectable()
export class MetricsService {
    readonly registry = new Registry();

    readonly requestsTotal = new Counter({
        name: MetricsNameEnum.REQUESTS_TOTAL,
        help: MetricsHelpEnum.REQUESTS_TOTAL,
        labelNames: [MetricsLabelEnum.ALGORITHM, MetricsLabelEnum.RESULT],
        registers: [this.registry],
    });

    readonly redisDuration = new Histogram({
        name: MetricsNameEnum.REDIS_DURATION,
        help: MetricsHelpEnum.REDIS_DURATION,
        labelNames: [MetricsLabelEnum.ALGORITHM],
        buckets: [1, 2, 5, 10, 25, 50, 100],
        registers: [this.registry],
    });

    readonly circuitState = new Gauge({
        name: MetricsNameEnum.CIRCUIT_BREAKER_STATE,
        help: MetricsHelpEnum.CIRCUIT_BREAKER_STATE,
        registers: [this.registry],
    });

    readonly fallbackTotal = new Counter({
        name: MetricsNameEnum.FALLBACK_TOTAL,
        help: MetricsHelpEnum.FALLBACK_TOTAL,
        registers: [this.registry],
    });
}
