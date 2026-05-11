import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { AuthModule } from '../auth/auth.module';
import { BillingModule } from '../billing/billing.module';
import { FileModule } from '../file/file.module';
import { UserModule } from '../user/user.module';
import { TaskRepository } from './repositories/task.repository';
import { WorkspaceRepository } from './repositories/workspace.repository';
import { WorkspaceController } from './workspace.controller';
import { WorkspaceService } from './workspace.service';
import { WorkspaceBoardRealtimeGateway } from './realtime/workspace-board-realtime.gateway';
import { WorkspaceBoardRealtimePublisher } from './realtime/workspace-board-realtime.publisher';
import { Task, TaskSchema } from './schemas/task.schema';
import { Workspace, WorkspaceSchema } from './schemas/workspace.schema';

@Module({
  imports: [
    AuthModule,
    BillingModule,
    FileModule,
    UserModule,
    MongooseModule.forFeature([
      { name: Task.name, schema: TaskSchema },
      { name: Workspace.name, schema: WorkspaceSchema },
    ]),
  ],
  controllers: [WorkspaceController],
  providers: [
    TaskRepository,
    WorkspaceRepository,
    WorkspaceService,
    WorkspaceBoardRealtimeGateway,
    WorkspaceBoardRealtimePublisher,
  ],
  exports: [WorkspaceService],
})
export class WorkspaceModule {}
