import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsIn,
  IsMongoId,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

const CLOUDINARY_RESOURCE_TYPES = ['auto', 'image', 'video', 'raw'] as const;
type CloudinaryResourceType = (typeof CLOUDINARY_RESOURCE_TYPES)[number];
const FILE_UPLOAD_INTENT_VALUES = ['WORKSPACE_TASK'] as const;
type FileUploadIntent = (typeof FILE_UPLOAD_INTENT_VALUES)[number];

export class CreateUploadSignatureDto {
  @ApiPropertyOptional({ example: 'avatar.png' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : undefined,
  )
  fileName?: string;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  mimeType: string;

  @ApiPropertyOptional({
    enum: CLOUDINARY_RESOURCE_TYPES,
    default: 'auto',
  })
  @IsOptional()
  @IsIn(CLOUDINARY_RESOURCE_TYPES)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  resourceType?: CloudinaryResourceType;

  @ApiPropertyOptional({
    enum: FILE_UPLOAD_INTENT_VALUES,
    default: 'WORKSPACE_TASK',
  })
  @IsOptional()
  @IsIn(FILE_UPLOAD_INTENT_VALUES)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toUpperCase() : value,
  )
  intent?: FileUploadIntent;

  @ApiPropertyOptional({
    description:
      'Existing task id when uploading for task update; omit for create-task draft flow',
  })
  @IsOptional()
  @IsMongoId()
  taskId?: string;
}
