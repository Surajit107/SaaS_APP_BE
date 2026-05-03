import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type WorkspaceDocument = HydratedDocument<Workspace>;

@Schema({ timestamps: true, collection: 'workspaces' })
export class Workspace {
  @Prop({ required: true, index: true })
  tenantId: string;

  @Prop({ required: true })
  name: string;

  createdAt: Date;
  updatedAt: Date;
}

export const WorkspaceSchema = SchemaFactory.createForClass(Workspace);
WorkspaceSchema.index({ tenantId: 1, createdAt: -1 });
