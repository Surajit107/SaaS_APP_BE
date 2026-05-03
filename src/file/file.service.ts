import {
  BadRequestException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectModel } from '@nestjs/mongoose';
import { Cron, CronExpression } from '@nestjs/schedule';
import { v2 as cloudinary } from 'cloudinary';
import { randomUUID } from 'crypto';
import type { Express } from 'express';
import { ClientSession, Model, Types } from 'mongoose';
import { AuthenticatedRequestUser } from '../auth/types/auth-request-user.types';
import type { ApiSuccessResponse } from '../common/types/api-response.types';
import { SubscriptionEntitlementsService } from '../billing/services/subscription-entitlements.service';
import { Task } from '../workspace/schemas/task.schema';
import { CreateUploadSignatureDto } from './dto/create-upload-signature.dto';
import { FinalizeFileAssetDto } from './dto/finalize-file-asset.dto';
import { RegisterFileAssetDto } from './dto/register-file-asset.dto';
import { FileAssetRepository } from './repositories/file-asset.repository';
import { FileUploadStage } from './schemas/file-asset.schema';

const DEFAULT_TEMP_FILE_TTL_MINUTES = 30;
const MIN_TEMP_FILE_TTL_MINUTES = 5;
const MAX_TEMP_FILE_TTL_MINUTES = 180;
const DEFAULT_CLEANUP_BATCH_SIZE = 25;

export type FinalizeTemporaryAssetsParams = {
  tenantId: string;
  taskId: string;
  temporaryPublicIds: string[];
  scope: string;
  session?: ClientSession;
};

export type FinalizedAssetItem = {
  previousPublicId: string;
  publicId: string;
  secureUrl: string;
  uploadStage: FileUploadStage;
};

@Injectable()
export class FileService {
  private readonly logger = new Logger(FileService.name);
  private readonly cloudName: string;
  private readonly apiKey: string;
  private readonly apiSecret: string;
  private readonly cloudinaryConfigured: boolean;
  private readonly tempFileTtlMinutes: number;

  constructor(
    private readonly fileAssetRepository: FileAssetRepository,
    private readonly configService: ConfigService,
    private readonly entitlements: SubscriptionEntitlementsService,
    @InjectModel(Task.name) private readonly taskModel: Model<Task>,
  ) {
    this.cloudName =
      this.configService.get<string>('CLOUDINARY_CLOUD_NAME')?.trim() ?? '';
    this.apiKey = this.configService.get<string>('CLOUDINARY_API_KEY')?.trim() ?? '';
    this.apiSecret =
      this.configService.get<string>('CLOUDINARY_API_SECRET')?.trim() ?? '';
    this.cloudinaryConfigured =
      this.cloudName.length > 0 &&
      this.apiKey.length > 0 &&
      this.apiSecret.length > 0;
    this.tempFileTtlMinutes = this.resolveTempFileTtlMinutes();

    if (this.cloudinaryConfigured) {
      cloudinary.config({
        cloud_name: this.cloudName,
        api_key: this.apiKey,
        api_secret: this.apiSecret,
        secure: true,
      });
    }
  }

  getModuleStatus(): ApiSuccessResponse<{
    module: string;
    dbReady: boolean;
    cloudinaryConfigured: boolean;
    tempFileTtlMinutes: number;
  }> {
    return {
      success: true,
      message: 'File module ready',
      data: {
        module: 'file',
        dbReady: this.fileAssetRepository.isMongooseReady(),
        cloudinaryConfigured: this.cloudinaryConfigured,
        tempFileTtlMinutes: this.tempFileTtlMinutes,
      },
    };
  }

  async createUploadSignature(
    user: AuthenticatedRequestUser,
    dto: CreateUploadSignatureDto,
  ): Promise<
    ApiSuccessResponse<{
      cloudName: string;
      apiKey: string;
      timestamp: number;
      signature: string;
      folder: string;
      publicId: string;
      resourceType: string;
      allowedFormats: string[];
      expiresAt: string;
    }>
  > {
    this.assertCloudinaryConfigured();
    await this.cleanupExpiredTemporaryAssets(DEFAULT_CLEANUP_BATCH_SIZE);

    const currentAssetCount = await this.fileAssetRepository.countFinalizedByTenant(
      user.tenantId,
    );
    await this.entitlements.assertWithinFileAssetLimit(user.tenantId, currentAssetCount);

    if (dto.taskId) {
      await this.assertTaskExistsInTenant(user.tenantId, dto.taskId);
    }

    const folder = this.getTenantTempFolder(user.tenantId);
    const publicId = `${folder}/${randomUUID()}`;
    const timestamp = Math.floor(Date.now() / 1000);
    const resourceType = dto.resourceType ?? 'auto';
    const allowedFormats = this.resolveAllowedFormats(dto.mimeType);
    const expiresAt = this.buildTemporaryExpiryDate().toISOString();

    const signature = cloudinary.utils.api_sign_request(
      {
        public_id: publicId,
        timestamp,
      },
      this.apiSecret,
    );

    return {
      success: true,
      message: 'Upload signature generated',
      data: {
        cloudName: this.cloudName,
        apiKey: this.apiKey,
        timestamp,
        signature,
        folder,
        publicId,
        resourceType,
        allowedFormats,
        expiresAt,
      },
    };
  }

  async registerAsset(
    user: AuthenticatedRequestUser,
    dto: RegisterFileAssetDto,
  ): Promise<
    ApiSuccessResponse<{
      publicId: string;
      secureUrl: string;
      resourceType: string;
      format?: string;
      bytes?: number;
      mimeType: string;
      uploadStage: FileUploadStage;
      expiresAt?: string;
    }>
  > {
    this.assertCloudinaryConfigured();
    await this.cleanupExpiredTemporaryAssets(DEFAULT_CLEANUP_BATCH_SIZE);

    if (dto.taskId) {
      await this.assertTaskExistsInTenant(user.tenantId, dto.taskId);
    }

    const tenantTempFolder = this.getTenantTempFolder(user.tenantId);
    if (!this.isTenantScopedPublicId(tenantTempFolder, dto.publicId)) {
      throw new BadRequestException(
        'Cloudinary publicId is not in tenant temporary folder',
      );
    }

    const existing = await this.fileAssetRepository.findByTenantAndPublicId(
      user.tenantId,
      dto.publicId,
    );
    if (existing) {
      throw new BadRequestException('File metadata already exists for this asset');
    }

    const currentStorageBytes = await this.fileAssetRepository.sumFinalizedBytesByTenant(
      user.tenantId,
    );
    await this.entitlements.assertWithinStorageLimit(
      user.tenantId,
      currentStorageBytes,
      dto.bytes ?? 0,
    );

    const saved = await this.fileAssetRepository.create({
      tenantId: user.tenantId,
      storageKey: dto.publicId,
      publicId: dto.publicId,
      secureUrl: dto.secureUrl,
      resourceType: dto.resourceType,
      format: dto.format,
      bytes: dto.bytes,
      mimeType: dto.mimeType,
      uploadStage: 'TEMPORARY',
      taskId: dto.taskId ?? null,
      expiresAt: this.buildTemporaryExpiryDate(),
      finalizedAt: null,
    });

    return {
      success: true,
      message: 'Temporary file metadata stored',
      data: {
        publicId: saved.publicId,
        secureUrl: saved.secureUrl,
        resourceType: saved.resourceType,
        format: saved.format,
        bytes: saved.bytes,
        mimeType: saved.mimeType,
        uploadStage: saved.uploadStage,
        expiresAt: saved.expiresAt?.toISOString(),
      },
    };
  }

  async uploadViaApiForTesting(
    user: AuthenticatedRequestUser,
    file: Express.Multer.File,
    taskId?: string,
  ): Promise<
    ApiSuccessResponse<{
      publicId: string;
      secureUrl: string;
      mimeType: string;
      uploadStage: FileUploadStage;
      taskId: string | null;
      finalized: boolean;
      expiresAt?: string;
    }>
  > {
    this.assertCloudinaryConfigured();
    await this.cleanupExpiredTemporaryAssets(DEFAULT_CLEANUP_BATCH_SIZE);

    if (!file || !file.buffer || file.size <= 0) {
      throw new BadRequestException('File is required');
    }

    const temporaryPublicId = `${this.getTenantTempFolder(user.tenantId)}/${randomUUID()}`;
    const uploaded = await this.uploadBufferToCloudinary({
      buffer: file.buffer,
      publicId: temporaryPublicId,
      resourceType: 'auto',
      mimeType: file.mimetype,
      originalFilename: file.originalname,
    });

    const registered = await this.registerAsset(user, {
      publicId: uploaded.publicId,
      secureUrl: uploaded.secureUrl,
      resourceType: uploaded.resourceType,
      format: uploaded.format,
      bytes: uploaded.bytes,
      mimeType: file.mimetype,
      taskId,
    });

    if (!taskId) {
      return {
        success: true,
        message: 'File uploaded to temporary storage via API testing endpoint',
        data: {
          publicId: registered.data.publicId,
          secureUrl: registered.data.secureUrl,
          mimeType: registered.data.mimeType,
          uploadStage: registered.data.uploadStage,
          taskId: null,
          finalized: false,
          expiresAt: registered.data.expiresAt,
        },
      };
    }

    const finalizedItems = await this.finalizeTemporaryAssets({
      tenantId: user.tenantId,
      taskId,
      temporaryPublicIds: [registered.data.publicId],
      scope: 'workspace-tasks',
    });
    const finalized = finalizedItems[0];
    if (!finalized) {
      throw new InternalServerErrorException('File finalize failed');
    }

    return {
      success: true,
      message: 'File uploaded and finalized via API testing endpoint',
      data: {
        publicId: finalized.publicId,
        secureUrl: finalized.secureUrl,
        mimeType: registered.data.mimeType,
        uploadStage: finalized.uploadStage,
        taskId,
        finalized: true,
      },
    };
  }

  async finalizeAsset(
    user: AuthenticatedRequestUser,
    dto: FinalizeFileAssetDto,
  ): Promise<
    ApiSuccessResponse<{
      previousPublicId: string;
      publicId: string;
      secureUrl: string;
      taskId: string;
      uploadStage: FileUploadStage;
    }>
  > {
    this.assertCloudinaryConfigured();
    const finalizedItems = await this.finalizeTemporaryAssets({
      tenantId: user.tenantId,
      taskId: dto.taskId,
      temporaryPublicIds: [dto.publicId],
      scope: 'workspace-tasks',
    });
    const finalized = finalizedItems[0];
    if (!finalized) {
      throw new InternalServerErrorException('Failed to finalize file asset');
    }

    return {
      success: true,
      message: 'Temporary file finalized for workspace task',
      data: {
        previousPublicId: dto.publicId,
        publicId: finalized.publicId,
        secureUrl: finalized.secureUrl,
        taskId: dto.taskId,
        uploadStage: finalized.uploadStage,
      },
    };
  }

  async finalizeTemporaryAssets(
    params: FinalizeTemporaryAssetsParams,
  ): Promise<FinalizedAssetItem[]> {
    this.assertCloudinaryConfigured();
    await this.cleanupExpiredTemporaryAssets(DEFAULT_CLEANUP_BATCH_SIZE);
    await this.assertTaskExistsInTenant(
      params.tenantId,
      params.taskId,
      params.session,
    );

    const uniquePublicIds = Array.from(
      new Set(
        params.temporaryPublicIds
          .map((publicId) => publicId.trim())
          .filter((publicId) => publicId.length > 0),
      ),
    );
    if (uniquePublicIds.length === 0) {
      return [];
    }

    const tempFolder = this.getTenantTempFolder(params.tenantId);
    const invalidPublicId = uniquePublicIds.find(
      (publicId) => !this.isTenantScopedPublicId(tempFolder, publicId),
    );
    if (invalidPublicId) {
      throw new BadRequestException(
        `Temporary asset is outside tenant temp folder: ${invalidPublicId}`,
      );
    }

    const temporaryAssets =
      await this.fileAssetRepository.findTemporaryByTenantAndPublicIds(
        params.tenantId,
        uniquePublicIds,
        params.session,
      );
    if (temporaryAssets.length !== uniquePublicIds.length) {
      throw new NotFoundException('One or more temporary assets were not found');
    }

    const now = Date.now();
    for (const asset of temporaryAssets) {
      if (asset.expiresAt && asset.expiresAt.getTime() < now) {
        throw new BadRequestException(
          `Temporary asset expired: ${asset.publicId}. Upload again.`,
        );
      }
    }

    const publicIdOrder = new Map(uniquePublicIds.map((id, index) => [id, index]));
    temporaryAssets.sort((a, b) => {
      const aIndex = publicIdOrder.get(a.publicId) ?? 0;
      const bIndex = publicIdOrder.get(b.publicId) ?? 0;
      return aIndex - bIndex;
    });

    const renamedPairs: Array<{ from: string; to: string; resourceType: string }> = [];
    const finalizedItems: FinalizedAssetItem[] = [];

    try {
      for (const asset of temporaryAssets) {
        const finalPublicId = this.buildFinalScopedPublicId(
          params.tenantId,
          params.scope,
          params.taskId,
          asset.publicId,
        );

        const renameResponse = await cloudinary.uploader.rename(
          asset.publicId,
          finalPublicId,
          {
            resource_type: asset.resourceType,
            invalidate: true,
            overwrite: false,
          },
        );
        const secureUrl = this.extractSecureUrl(renameResponse) ?? asset.secureUrl;

        const finalized = await this.fileAssetRepository.finalize(
          {
            tenantId: params.tenantId,
            previousPublicId: asset.publicId,
            publicId: finalPublicId,
            secureUrl,
            taskId: params.taskId,
          },
          params.session,
        );
        if (!finalized) {
          throw new InternalServerErrorException(
            `Metadata finalize failed for asset: ${asset.publicId}`,
          );
        }

        renamedPairs.push({
          from: asset.publicId,
          to: finalPublicId,
          resourceType: asset.resourceType,
        });
        finalizedItems.push({
          previousPublicId: asset.publicId,
          publicId: finalized.publicId,
          secureUrl: finalized.secureUrl,
          uploadStage: finalized.uploadStage,
        });
      }

      return finalizedItems;
    } catch (error) {
      await this.rollbackRenamedAssets(renamedPairs);
      throw error;
    }
  }

  async deleteAsset(
    user: AuthenticatedRequestUser,
    publicId: string,
  ): Promise<ApiSuccessResponse<{ publicId: string; deleted: boolean }>> {
    this.assertCloudinaryConfigured();

    const existing = await this.fileAssetRepository.findByTenantAndPublicId(
      user.tenantId,
      publicId,
    );
    if (!existing) {
      throw new NotFoundException('File asset not found');
    }

    const cloudinaryResponse = await cloudinary.uploader.destroy(publicId, {
      resource_type: existing.resourceType,
      invalidate: true,
    });
    const cloudinaryResult = this.extractDestroyResult(cloudinaryResponse);
    if (cloudinaryResult !== 'ok' && cloudinaryResult !== 'not found') {
      throw new InternalServerErrorException(
        `Cloudinary deletion failed with result: ${cloudinaryResult}`,
      );
    }

    const deleteResult = await this.fileAssetRepository.deleteByTenantAndPublicId(
      user.tenantId,
      publicId,
    );

    return {
      success: true,
      message: 'File asset deleted',
      data: {
        publicId,
        deleted: deleteResult.deletedCount > 0,
      },
    };
  }

  @Cron(CronExpression.EVERY_10_MINUTES)
  async cleanupExpiredTemporaryAssetsJob(): Promise<void> {
    if (!this.cloudinaryConfigured) {
      return;
    }
    await this.cleanupExpiredTemporaryAssets(100);
  }

  private getTenantFolder(tenantId: string): string {
    return `tenants/${tenantId}`;
  }

  private getTenantTempFolder(tenantId: string): string {
    return `${this.getTenantFolder(tenantId)}/tmp/workspace-tasks`;
  }

  private assertCloudinaryConfigured(): void {
    if (!this.cloudinaryConfigured) {
      throw new InternalServerErrorException(
        'Cloudinary credentials are not configured',
      );
    }
  }

  private isTenantScopedPublicId(tenantFolder: string, publicId: string): boolean {
    return publicId.startsWith(`${tenantFolder}/`);
  }

  private resolveAllowedFormats(mimeType: string): string[] {
    if (mimeType.startsWith('image/')) return ['jpg', 'jpeg', 'png', 'webp', 'gif'];
    if (mimeType.startsWith('video/')) return ['mp4', 'webm', 'mov'];
    if (mimeType === 'application/pdf') return ['pdf'];
    return [];
  }

  private resolveTempFileTtlMinutes(): number {
    const raw = this.configService.get<string>('FILE_TEMP_TTL_MINUTES');
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      return DEFAULT_TEMP_FILE_TTL_MINUTES;
    }
    return Math.min(
      MAX_TEMP_FILE_TTL_MINUTES,
      Math.max(MIN_TEMP_FILE_TTL_MINUTES, Math.floor(parsed)),
    );
  }

  private buildTemporaryExpiryDate(): Date {
    return new Date(Date.now() + this.tempFileTtlMinutes * 60_000);
  }

  private buildFinalTaskPublicId(
    tenantId: string,
    taskId: string,
    temporaryPublicId: string,
  ): string {
    return this.buildFinalScopedPublicId(
      tenantId,
      'workspace-tasks',
      taskId,
      temporaryPublicId,
    );
  }

  private buildFinalScopedPublicId(
    tenantId: string,
    scope: string,
    entityId: string,
    temporaryPublicId: string,
  ): string {
    const assetName =
      temporaryPublicId.split('/').pop()?.trim() || `task-file-${randomUUID()}`;
    const safeScope = scope.trim().replace(/\s+/g, '-').toLowerCase();
    return `${this.getTenantFolder(tenantId)}/${safeScope}/${entityId}/${assetName}`;
  }

  private async assertTaskExistsInTenant(
    tenantId: string,
    taskId: string,
    session?: ClientSession,
  ): Promise<void> {
    if (!Types.ObjectId.isValid(taskId)) {
      throw new BadRequestException('Invalid task id');
    }
    const exists = await this.taskModel
      .exists({
        _id: new Types.ObjectId(taskId),
        tenantId,
        deletedAt: null,
      })
      .session(session ?? null)
      .exec();
    if (!exists) {
      throw new NotFoundException('Workspace task not found');
    }
  }

  private async cleanupExpiredTemporaryAssets(limit: number): Promise<void> {
    const expiredAssets = await this.fileAssetRepository.findExpiredTemporaryAssets(
      new Date(),
      limit,
    );
    if (expiredAssets.length === 0) {
      return;
    }

    for (const asset of expiredAssets) {
      try {
        const response = await cloudinary.uploader.destroy(asset.publicId, {
          resource_type: asset.resourceType,
          invalidate: true,
        });
        const result = this.extractDestroyResult(response);
        if (result !== 'ok' && result !== 'not found') {
          this.logger.warn(
            `Cloudinary temp cleanup skipped for ${asset.publicId}. Result: ${result}`,
          );
          continue;
        }
        await this.fileAssetRepository.deleteByTenantAndPublicId(
          asset.tenantId,
          asset.publicId,
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown cleanup failure';
        this.logger.warn(
          `Cloudinary temp cleanup failed for ${asset.publicId}: ${message}`,
        );
      }
    }
  }

  private extractDestroyResult(response: unknown): string {
    if (typeof response !== 'object' || response === null) {
      return 'unknown';
    }
    const resultValue = (
      response as {
        result?: unknown;
      }
    ).result;
    return typeof resultValue === 'string' ? resultValue : 'unknown';
  }

  private extractSecureUrl(response: unknown): string | null {
    if (typeof response !== 'object' || response === null) {
      return null;
    }
    const secureUrlValue = (
      response as {
        secure_url?: unknown;
      }
    ).secure_url;
    return typeof secureUrlValue === 'string' ? secureUrlValue : null;
  }

  private async uploadBufferToCloudinary(params: {
    buffer: Buffer;
    publicId: string;
    resourceType: 'auto' | 'image' | 'video' | 'raw';
    mimeType: string;
    originalFilename?: string;
  }): Promise<{
    publicId: string;
    secureUrl: string;
    resourceType: string;
    format?: string;
    bytes?: number;
  }> {
    const response = await new Promise<unknown>((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          public_id: params.publicId,
          resource_type: params.resourceType,
          overwrite: false,
          invalidate: true,
          filename_override: params.originalFilename,
        },
        (error, result) => {
          if (error) {
            reject(error);
            return;
          }
          resolve(result);
        },
      );

      uploadStream.end(params.buffer);
    });

    if (typeof response !== 'object' || response === null) {
      throw new InternalServerErrorException('Cloudinary upload returned invalid response');
    }

    const publicIdValue = (response as { public_id?: unknown }).public_id;
    const secureUrlValue = (response as { secure_url?: unknown }).secure_url;
    const resourceTypeValue = (response as { resource_type?: unknown }).resource_type;
    const formatValue = (response as { format?: unknown }).format;
    const bytesValue = (response as { bytes?: unknown }).bytes;

    if (
      typeof publicIdValue !== 'string' ||
      typeof secureUrlValue !== 'string' ||
      typeof resourceTypeValue !== 'string'
    ) {
      throw new InternalServerErrorException('Cloudinary upload missing required fields');
    }

    return {
      publicId: publicIdValue,
      secureUrl: secureUrlValue,
      resourceType: resourceTypeValue,
      format: typeof formatValue === 'string' ? formatValue : undefined,
      bytes: typeof bytesValue === 'number' ? bytesValue : undefined,
    };
  }

  private async rollbackRenamedAssets(
    renamedPairs: Array<{ from: string; to: string; resourceType: string }>,
  ): Promise<void> {
    for (let index = renamedPairs.length - 1; index >= 0; index -= 1) {
      const pair = renamedPairs[index];
      if (!pair) continue;

      try {
        await cloudinary.uploader.rename(pair.to, pair.from, {
          resource_type: pair.resourceType,
          overwrite: false,
          invalidate: true,
        });
      } catch (error) {
        const message =
          error instanceof Error ? error.message : 'Unknown rollback failure';
        this.logger.error(
          `Failed to rollback renamed asset ${pair.to} -> ${pair.from}: ${message}`,
        );
      }
    }
  }
}
