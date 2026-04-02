import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import Redis from 'ioredis';

@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
    private readonly logger = new Logger(RedisService.name);
    // assigned during onModuleInit
    client!: Redis;

    onModuleInit() {
        this.client = new Redis({
            host: process.env.REDIS_HOST ?? 'localhost',
            port: parseInt(process.env.REDIS_PORT ?? '6379', 10),
            password: process.env.REDIS_PASSWORD,
            lazyConnect: true,
        });

        this.client.on('error', (err) => this.logger.error('Redis error', err));
        this.client.on('connect', () => this.logger.log('Redis connected'));
    }

    async onModuleDestroy() {
        await this.client.quit();
    }
}
