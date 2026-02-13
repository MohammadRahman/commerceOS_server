import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class LoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  // multi-tenant: allow specifying orgId if needed
  @IsOptional()
  @IsString()
  orgId?: string;
}
