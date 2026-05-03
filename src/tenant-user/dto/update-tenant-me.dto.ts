import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength } from 'class-validator';

/** PATCH /tenant/me — self-service profile fields for the signed-in tenant user. */
export class UpdateTenantMeDto {
  @ApiProperty({
    description:
      'Visible name in the workspace (max 120). Send an empty string to clear.',
    example: 'Jane Doe',
    maxLength: 120,
  })
  @IsString()
  @MaxLength(120)
  displayName: string;
}
