import {
  Body,
  Controller,
  Delete,
  Get,
  ParseFilePipeBuilder,
  Post,
  UnauthorizedException,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import {
  ApiBody,
  ApiBearerAuth,
  ApiConsumes,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import type { Express } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TenantGuard } from '../auth/guards/tenant.guard';
import { AuthenticatedRequestUser } from '../auth/types/auth-request-user.types';
import { CreateUploadSignatureDto } from './dto/create-upload-signature.dto';
import { DeleteFileAssetDto } from './dto/delete-file-asset.dto';
import { FinalizeFileAssetDto } from './dto/finalize-file-asset.dto';
import { RegisterFileAssetDto } from './dto/register-file-asset.dto';
import { UploadFileTestingDto } from './dto/upload-file-testing.dto';
import { FileService } from './file.service';

@ApiTags('File')
@Controller('files')
export class FileController {
  constructor(private readonly fileService: FileService) {}

  @Get('status')
  @ApiOperation({ summary: 'File module health' })
  status() {
    return this.fileService.getModuleStatus();
  }

  @Post('upload-signature')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Generate signed Cloudinary direct-upload payload (tenant-scoped)',
  })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Token has no tenant context' })
  createUploadSignature(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: CreateUploadSignatureDto,
  ) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.fileService.createUploadSignature(user, body);
  }

  @Post('assets')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Store uploaded file metadata (tenant-scoped)',
  })
  @ApiResponse({ status: 400, description: 'Invalid payload' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Token has no tenant context' })
  registerFileAsset(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: RegisterFileAssetDto,
  ) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.fileService.registerAsset(user, body);
  }

  @Post('testing/upload')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @UseInterceptors(FileInterceptor('file'))
  @ApiBearerAuth('access-token')
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['file'],
      properties: {
        file: { type: 'string', format: 'binary' },
        taskId: {
          type: 'string',
          description:
            'Optional task id. If provided, upload is finalized immediately.',
        },
      },
    },
  })
  @ApiOperation({
    summary:
      'Swagger testing upload endpoint (multipart). Uses same temp/finalize lifecycle.',
  })
  @ApiResponse({ status: 400, description: 'Invalid file or payload' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Token has no tenant context' })
  @ApiResponse({ status: 404, description: 'Task not found (if taskId provided)' })
  uploadFileForTesting(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: UploadFileTestingDto,
    @UploadedFile(
      new ParseFilePipeBuilder()
        .addMaxSizeValidator({ maxSize: 20 * 1024 * 1024 })
        .build({ fileIsRequired: true }),
    )
    file: Express.Multer.File,
  ) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.fileService.uploadViaApiForTesting(user, file, body.taskId);
  }

  @Post('assets/finalize')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Finalize temp upload into task-scoped permanent storage',
  })
  @ApiResponse({ status: 400, description: 'Invalid payload or temp asset scope' })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Token has no tenant context' })
  @ApiResponse({ status: 404, description: 'Task or temp asset not found' })
  finalizeFileAsset(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: FinalizeFileAssetDto,
  ) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.fileService.finalizeAsset(user, body);
  }

  @Delete('assets')
  @UseGuards(JwtAuthGuard, TenantGuard)
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Delete Cloudinary asset and metadata (tenant-scoped)',
  })
  @ApiResponse({ status: 401, description: 'Missing or invalid access token' })
  @ApiResponse({ status: 403, description: 'Token has no tenant context' })
  @ApiResponse({ status: 404, description: 'Asset not found' })
  deleteFileAsset(
    @CurrentUser() user: AuthenticatedRequestUser | undefined,
    @Body() body: DeleteFileAssetDto,
  ) {
    if (!user) {
      throw new UnauthorizedException();
    }
    return this.fileService.deleteAsset(user, body.publicId);
  }
}
