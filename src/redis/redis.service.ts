import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import Redis, { RedisOptions } from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);
    // assigned during onModuleInit
    client!: Redis;

    onModuleInit() {
        const sentinelList = process.env.REDIS_SENTINELS;
        const baseOptions: RedisOptions = {
            password: process.env.REDIS_PASSWORD,
            maxRetriesPerRequest: 1,
            enableOfflineQueue: false,
            autoResendUnfulfilledCommands: false,
            connectTimeout: 1_000,
            lazyConnect: true,
        };

        if (sentinelList) {
            const sentinels = sentinelList.split(',').map((s) => {
                const [host, port] = s.split(':');
                return { host, port: parseInt(port, 10) };
            });

            this.client = new Redis({
                ...baseOptions,
                sentinels,
                name: process.env.REDIS_SENTINEL_NAME ?? 'mymaster',
                sentinelRetryStrategy: (times) => Math.min(times * 50, 500),
                retryStrategy: (times) => Math.min(times * 50, 500),
            });
        } else {
            this.client = new Redis({
                ...baseOptions,
                host: process.env.REDIS_HOST ?? 'localhost',
                port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
                retryStrategy: (times) => Math.min(times * 50, 500),
            });
        }

        this.client.on('error', (err) => this.logger.error('Redis error', err));
        this.client.on('connect', () => this.logger.log('Redis connected'));
    }

    async onModuleDestroy() {
        if (this.client.status === 'end') {
            return;
        }

        if (this.client.status !== 'ready') {
            this.client.disconnect();
            return;
        }

        await this.client.quit();
    }
}
