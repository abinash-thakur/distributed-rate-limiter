import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);
    // assigned during onModuleInit
    client!: Redis;

    onModuleInit() {
        const sentinelList = process.env.REDIS_SENTINELS;

        if (sentinelList) {
            const sentinels = sentinelList.split(',').map((s) => {
                const [host, port] = s.split(':');
                return { host, port: parseInt(port, 10) };
            });

            this.client = new Redis({
                sentinels,
                name: process.env.REDIS_SENTINEL_NAME ?? 'mymaster',
                password: process.env.REDIS_PASSWORD,
            });
        } else {
            this.client = new Redis({
                host: process.env.REDIS_HOST ?? 'localhost',
                port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
                password: process.env.REDIS_PASSWORD,
                lazyConnect: true,
            });
        }

        this.client.on('error', (err) => this.logger.error('Redis error', err));
        this.client.on('connect', () => this.logger.log('Redis connected'));
    }

    async onModuleDestroy() {
        await this.client.quit();
    }
}
