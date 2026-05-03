import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsMongoId, IsString, MaxLength } from 'class-validator';

export class FinalizeFileAssetDto {
  @ApiProperty({ example: 'tenants/tenant_123/tmp/workspace-tasks/abcxyz' })
  @IsString()
  @MaxLength(400)
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  publicId: string;

  @ApiProperty({
    description: 'Workspace task id to bind finalized file to',
    example: '6637b8d6f5d57f3fc3b0f93e',
  })
  @IsMongoId()
  taskId: string;
}
