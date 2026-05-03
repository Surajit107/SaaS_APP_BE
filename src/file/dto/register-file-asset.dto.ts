import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsInt,
  IsMongoId,
  IsOptional,
  IsString,
  IsUrl,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

export class RegisterFileAssetDto {
  @ApiProperty({
    example: 'tenants/tenant_123/avatars/abcxyz',
    description: 'Cloudinary public_id returned after direct upload',
  })
  @IsString()
  @MaxLength(400)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  publicId: string;

  @ApiProperty({ example: 'https://res.cloudinary.com/.../image/upload/v1/...' })
  @IsUrl({ require_tld: false })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  secureUrl: string;

  @ApiProperty({ example: 'image' })
  @IsString()
  @MaxLength(50)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  resourceType: string;

  @ApiPropertyOptional({ example: 'png' })
  @IsOptional()
  @IsString()
  @MaxLength(30)
  @Transform(({ value }) => {
    if (typeof value !== 'string') return undefined;
    const trimmed = value.trim().toLowerCase();
    return trimmed.length > 0 ? trimmed : undefined;
  })
  format?: string;

  @ApiPropertyOptional({ example: 204800 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(104857600)
  bytes?: number;

  @ApiProperty({ example: 'image/png' })
  @IsString()
  @MaxLength(255)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  mimeType: string;

  @ApiPropertyOptional({
    description:
      'Existing workspace task id when file is attached to an already-created task',
  })
  @IsOptional()
  @IsMongoId()
  taskId?: string;
}
