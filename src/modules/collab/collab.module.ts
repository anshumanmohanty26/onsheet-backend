import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PrismaModule } from '../../prisma/prisma.module';
import { CellsModule } from '../cells/cells.module';
import { UsersModule } from '../users/users.module';
import { CollabGateway } from './collab.gateway';
import { CollabService } from './collab.service';
import { OperationLogModule } from './operation-log.module';

@Module({
  imports: [
    PrismaModule,
    CellsModule,
    UsersModule,
    OperationLogModule,
    JwtModule.register({}), // secrets resolved at verify-time via ConfigService
  ],
  providers: [CollabGateway, CollabService],
})
export class CollabModule {}
