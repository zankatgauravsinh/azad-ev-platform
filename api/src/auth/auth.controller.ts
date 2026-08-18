import { Body, Controller, Get, HttpCode, Ip, Patch, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { ApiBearerAuth, ApiBody, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import {
  changePasswordSchema,
  loginSchema,
  refreshSchema,
  type AuthUser,
  type ChangePasswordInput,
  type LoginInput,
  type LoginResponse,
  type RefreshInput,
} from '@azad/shared';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser } from '../common/decorators/current-user.decorator';
import { ZodValidationPipe } from '../common/pipes/zod-validation.pipe';
import { AuthService } from './auth.service';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Sign in with email and password' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['email', 'password'],
      properties: {
        email: { type: 'string', format: 'email', example: 'owner@azadev.in' },
        password: { type: 'string', example: 'Azad@12345' },
      },
    },
  })
  @ApiResponse({ status: 200, description: 'Access + refresh tokens and the user profile' })
  @ApiResponse({ status: 401, description: 'Invalid email or password' })
  login(
    @Body(new ZodValidationPipe(loginSchema)) dto: LoginInput,
    @Ip() ip: string,
  ): Promise<LoginResponse> {
    return this.auth.login(dto, ip);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange a refresh token for a rotated token pair' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['refreshToken'],
      properties: { refreshToken: { type: 'string' } },
    },
  })
  refresh(@Body(new ZodValidationPipe(refreshSchema)) dto: RefreshInput): Promise<LoginResponse> {
    return this.auth.refresh(dto.refreshToken);
  }

  @Post('logout')
  @HttpCode(204)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Invalidate the current refresh session' })
  async logout(@CurrentUser('id') userId: string): Promise<void> {
    await this.auth.logout(userId);
  }

  @Get('me')
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Get the authenticated user profile' })
  me(@CurrentUser() user: AuthUser): Promise<AuthUser> {
    return this.auth.me(user.id);
  }

  @Patch('password')
  @HttpCode(204)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Change the authenticated user password' })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['current', 'next'],
      properties: {
        current: { type: 'string' },
        next: { type: 'string', minLength: 8 },
      },
    },
  })
  async changePassword(
    @CurrentUser('id') userId: string,
    @Body(new ZodValidationPipe(changePasswordSchema)) dto: ChangePasswordInput,
  ): Promise<void> {
    await this.auth.changePassword(userId, dto);
  }
}
