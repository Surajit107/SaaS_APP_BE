import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';
import { BillingModule } from '../billing/billing.module';
import { Task, TaskSchema } from '../workspace/schemas/task.schema';
import { FileAssetRepository } from './repositories/file-asset.repository';
import { FileController } from './file.controller';
import { FileService } from './file.service';
import { FileAsset, FileAssetSchema } from './schemas/file-asset.schema';

@Module({
  imports: [
    BillingModule,
    MongooseModule.forFeature([
      { name: FileAsset.name, schema: FileAssetSchema },
      { name: Task.name, schema: TaskSchema },
    ]),
  ],
  controllers: [FileController],
  providers: [FileAssetRepository, FileService],
  exports: [FileService],
})
export class FileModule {}
