import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { PrismaModule } from '../../prisma/prisma.module';
import { ExportProcessor } from './processors/export.processor';
import { ImportProcessor } from './processors/import.processor';

@Module({
  imports: [
    PrismaModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      useFactory: (config: ConfigService) => ({
        connection: {
          host: config.get<string>('redis.host'),
          port: config.get<number>('redis.port'),
          password: config.get<string | undefined>('redis.password'),
          tls: config.get<object | undefined>('redis.tls'),
        },
      }),
      inject: [ConfigService],
    }),
    BullModule.registerQueue({ name: 'export' }, { name: 'import' }),
  ],
  providers: [ExportProcessor, ImportProcessor],
  exports: [BullModule],
})
export class JobsModule {}
