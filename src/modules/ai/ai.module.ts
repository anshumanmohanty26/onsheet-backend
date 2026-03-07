import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module';
import { AiController } from './ai.controller';
import { AiService } from './ai.service';

/**
 * Module that provides the OnSheet AI agent and LLM utilities.
 *
 * Depends on {@link PrismaModule} so the agent tools can query live sheet data.
 */
@Module({
  imports: [PrismaModule],
  providers: [AiService],
  controllers: [AiController],
})
export class AiModule {}
