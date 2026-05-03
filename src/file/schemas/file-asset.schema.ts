import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FileAssetDocument = HydratedDocument<FileAsset>;
export const FILE_UPLOAD_STAGE_VALUES = ['TEMPORARY', 'FINALIZED'] as const;
export type FileUploadStage = (typeof FILE_UPLOAD_STAGE_VALUES)[number];

@Schema({ timestamps: true, collection: 'file_assets' })
export class FileAsset {
  @Prop({ required: true, index: true })
  tenantId: string;

  @Prop({ required: true })
  storageKey: string;

  @Prop({ required: true, index: true })
  publicId: string;

  @Prop({ required: true })
  secureUrl: string;

  @Prop({ required: true })
  resourceType: string;

  @Prop()
  format?: string;

  @Prop()
  bytes?: number;

  @Prop({ required: true })
  mimeType: string;

  @Prop({
    type: String,
    enum: FILE_UPLOAD_STAGE_VALUES,
    required: true,
    default: 'TEMPORARY',
    index: true,
  })
  uploadStage: FileUploadStage;

  @Prop({ type: String, required: false, default: null, index: true })
  taskId: string | null;

  @Prop({ type: Date, required: false, default: null, index: true })
  expiresAt: Date | null;

  @Prop({ type: Date, required: false, default: null })
  finalizedAt: Date | null;
}

export const FileAssetSchema = SchemaFactory.createForClass(FileAsset);
FileAssetSchema.index({ tenantId: 1, createdAt: -1 });
FileAssetSchema.index({ tenantId: 1, publicId: 1 }, { unique: true });
FileAssetSchema.index({ tenantId: 1, uploadStage: 1, expiresAt: 1 });
