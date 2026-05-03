import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsString, MaxLength } from 'class-validator';

export class DeleteFileAssetDto {
  @ApiProperty({ example: 'tenants/tenant_123/avatars/abcxyz' })
  @IsString()
  @MaxLength(400)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  publicId: string;
}
