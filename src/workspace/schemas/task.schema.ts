import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { TASK_STATUS_VALUES, type TaskStatus } from '../types/task.types';

export type TaskDocument = HydratedDocument<Task>;

@Schema({ timestamps: true, collection: 'workspace_tasks' })
export class Task {
  @Prop({ required: true })
  title: string;

  @Prop({ type: String, required: false, default: null })
  description: string | null;

  @Prop({ type: [String], required: false, default: [] })
  attachmentUrls: string[];

  @Prop({
    type: String,
    enum: TASK_STATUS_VALUES,
    required: true,
    default: 'TODO',
  })
  status: TaskStatus;

  @Prop({ type: String, required: false, default: null })
  assignedTo: string | null;

  @Prop({ required: true, index: true })
  tenantId: string;

  @Prop({ required: true, index: true })
  workspaceId: string;

  @Prop({ required: true })
  createdBy: string;

  @Prop({ type: Date, required: false, default: null })
  deletedAt: Date | null;

  createdAt: Date;
  updatedAt: Date;
}

export const TaskSchema = SchemaFactory.createForClass(Task);
TaskSchema.index({ tenantId: 1, workspaceId: 1, status: 1 });
TaskSchema.index({ tenantId: 1, workspaceId: 1, assignedTo: 1 });
TaskSchema.index({ tenantId: 1, workspaceId: 1, createdAt: -1 });
TaskSchema.index({ tenantId: 1, workspaceId: 1, title: 'text', description: 'text' });
