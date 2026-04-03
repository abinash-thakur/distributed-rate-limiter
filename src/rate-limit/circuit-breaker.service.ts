import { Injectable, Logger } from '@nestjs/common';
import { MetricsService } from '../metrics/metrics.service';
import { CircuitBreakerConfigEnum } from '../utils/enum/circuit-breaker-config.enum';
import { CircuitBreakerStateEnum } from '../utils/enum/circuit-breaker-state.enum';
import { CircuitBreakerStateMetricEnum } from '../utils/enum/metrics.enum';
import { MessageEnum } from '../utils/enum/message.enum';

@Injectable()
export class CircuitBreakerService {
    private readonly logger = new Logger(CircuitBreakerService.name);
    private state: CircuitBreakerStateEnum = CircuitBreakerStateEnum.CLOSED;
    private failureCount = 0;
    private lastFailureTime = 0;
    private halfOpenProbeInFlight = false;

    private readonly failureThreshold = CircuitBreakerConfigEnum.FAILURE_THRESHOLD;
    private readonly recoveryTimeoutMs = CircuitBreakerConfigEnum.RECOVERY_TIMEOUT_MS;

    constructor(private readonly metricsService: MetricsService) {
        this.updateGauge();
    }

    shouldBypassRedis(): boolean {
        if (this.state === CircuitBreakerStateEnum.OPEN) {
            const elapsed = Date.now() - this.lastFailureTime;

            if (elapsed >= this.recoveryTimeoutMs) {
                this.state = CircuitBreakerStateEnum.HALF_OPEN;
                this.halfOpenProbeInFlight = false;
                this.updateGauge();
                this.logger.log(MessageEnum.CIRCUIT_BREAKER_HALF_OPEN);
            } else {
                return true;
            }
        }

        if (this.state === CircuitBreakerStateEnum.HALF_OPEN) {
            if (this.halfOpenProbeInFlight) {
                return true;
            }

            this.halfOpenProbeInFlight = true;
        }

        return false;
    }

    recordSuccess(): void {
        this.failureCount = 0;
        this.lastFailureTime = 0;
        this.halfOpenProbeInFlight = false;

        if (this.state !== CircuitBreakerStateEnum.CLOSED) {
            this.state = CircuitBreakerStateEnum.CLOSED;
            this.updateGauge();
            this.logger.log(MessageEnum.CIRCUIT_BREAKER_CLOSED);
        }
    }

    recordFailure(): void {
        this.lastFailureTime = Date.now();

        if (this.state === CircuitBreakerStateEnum.HALF_OPEN) {
            this.openCircuit();
            return;
        }

        this.failureCount += 1;
        if (this.failureCount >= this.failureThreshold) {
            this.openCircuit();
        }
    }

    getState(): CircuitBreakerStateEnum {
        return this.state;
    }

    private openCircuit(): void {
        this.state = CircuitBreakerStateEnum.OPEN;
        this.halfOpenProbeInFlight = false;
        this.updateGauge();
        this.logger.warn(MessageEnum.CIRCUIT_BREAKER_OPEN);
    }

    private updateGauge(): void {
        const metricValue = {
            [CircuitBreakerStateEnum.CLOSED]: CircuitBreakerStateMetricEnum.CLOSED,
            [CircuitBreakerStateEnum.OPEN]: CircuitBreakerStateMetricEnum.OPEN,
            [CircuitBreakerStateEnum.HALF_OPEN]: CircuitBreakerStateMetricEnum.HALF_OPEN,
        }[this.state];

        this.metricsService.circuitState.set(metricValue);
    }
}
