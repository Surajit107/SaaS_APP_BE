import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ClientSession, Model } from 'mongoose';
import { isMongooseConnectionReady } from '../../common/mongoose/connection.util';
import {
  FileAsset,
  FileAssetDocument,
  FileUploadStage,
} from '../schemas/file-asset.schema';

export type CreateFileAssetRecordInput = {
  tenantId: string;
  storageKey: string;
  publicId: string;
  secureUrl: string;
  resourceType: string;
  format?: string;
  bytes?: number;
  mimeType: string;
  uploadStage: FileUploadStage;
  taskId?: string | null;
  expiresAt?: Date | null;
  finalizedAt?: Date | null;
};

export type FinalizeFileAssetRecordInput = {
  tenantId: string;
  previousPublicId: string;
  publicId: string;
  secureUrl: string;
  taskId: string;
};

@Injectable()
export class FileAssetRepository {
  constructor(
    @InjectModel(FileAsset.name) private readonly model: Model<FileAsset>,
  ) {}

  isMongooseReady(): boolean {
    return isMongooseConnectionReady(this.model.db);
  }

  create(
    input: CreateFileAssetRecordInput,
    session?: ClientSession,
  ): Promise<FileAssetDocument> {
    const doc = new this.model({
      tenantId: input.tenantId,
      storageKey: input.storageKey,
      publicId: input.publicId,
      secureUrl: input.secureUrl,
      resourceType: input.resourceType,
      format: input.format,
      bytes: input.bytes,
      mimeType: input.mimeType,
      uploadStage: input.uploadStage,
      taskId: input.taskId ?? null,
      expiresAt: input.expiresAt ?? null,
      finalizedAt: input.finalizedAt ?? null,
    });
    return doc.save({ session });
  }

  findByTenantAndPublicId(
    tenantId: string,
    publicId: string,
    session?: ClientSession,
  ): Promise<FileAssetDocument | null> {
    return this.model
      .findOne({
        tenantId,
        publicId,
      })
      .session(session ?? null)
      .exec();
  }

  deleteByTenantAndPublicId(
    tenantId: string,
    publicId: string,
    session?: ClientSession,
  ): Promise<{ deletedCount: number }> {
    return this.model
      .deleteOne({
        tenantId,
        publicId,
      })
      .session(session ?? null)
      .exec();
  }

  finalize(
    input: FinalizeFileAssetRecordInput,
    session?: ClientSession,
  ): Promise<FileAssetDocument | null> {
    return this.model
      .findOneAndUpdate(
        {
          tenantId: input.tenantId,
          publicId: input.previousPublicId,
          uploadStage: 'TEMPORARY',
        },
        {
          $set: {
            publicId: input.publicId,
            storageKey: input.publicId,
            secureUrl: input.secureUrl,
            uploadStage: 'FINALIZED',
            taskId: input.taskId,
            expiresAt: null,
            finalizedAt: new Date(),
          },
        },
        { returnDocument: 'after', session },
      )
      .exec();
  }

  findTemporaryByTenantAndPublicIds(
    tenantId: string,
    publicIds: string[],
    session?: ClientSession,
  ): Promise<FileAssetDocument[]> {
    if (publicIds.length === 0) {
      return Promise.resolve([]);
    }
    return this.model
      .find({
        tenantId,
        uploadStage: 'TEMPORARY',
        publicId: { $in: publicIds },
      })
      .session(session ?? null)
      .exec();
  }

  findExpiredTemporaryAssets(
    now: Date,
    limit: number,
  ): Promise<FileAssetDocument[]> {
    return this.model
      .find({
        uploadStage: 'TEMPORARY',
        expiresAt: { $ne: null, $lte: now },
      })
      .sort({ expiresAt: 1 })
      .limit(limit)
      .exec();
  }

  /** Count of FINALIZED assets for a tenant (excludes temporary/expired assets). */
  countFinalizedByTenant(tenantId: string): Promise<number> {
    return this.model
      .countDocuments({ tenantId, uploadStage: 'FINALIZED' })
      .exec();
  }

  /**
   * Total bytes consumed by FINALIZED assets for a tenant.
   * Documents without a numeric `bytes` field are excluded from the sum.
   */
  async sumFinalizedBytesByTenant(tenantId: string): Promise<number> {
    const result = await this.model
      .aggregate<{ total: number }>([
        {
          $match: {
            tenantId,
            uploadStage: 'FINALIZED',
            bytes: { $type: 'number' },
          },
        },
        { $group: { _id: null, total: { $sum: '$bytes' } } },
      ])
      .exec();
    return result[0]?.total ?? 0;
  }
}
