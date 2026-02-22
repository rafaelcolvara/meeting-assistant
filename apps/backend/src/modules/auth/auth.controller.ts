import {
  Body,
  Controller,
  Get,
  Post,
  Req,
  Res,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request, Response } from 'express';
import { Public } from '../../common/decorators/public.decorator';
import { SkipOrganization } from '../../common/decorators/skip-organization.decorator';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterDto } from './dto/register.dto';

@Controller('auth')
@Public()
@SkipOrganization()
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  async register(@Body() dto: RegisterDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.authService.register(dto);
    this.attachRefreshCookie(res, tokens.refreshToken);
    return {
      accessToken: tokens.accessToken,
      tokenType: tokens.tokenType,
      expiresIn: tokens.expiresIn,
    };
  }

  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const tokens = await this.authService.login(dto);
    this.attachRefreshCookie(res, tokens.refreshToken);
    return {
      accessToken: tokens.accessToken,
      tokenType: tokens.tokenType,
      expiresIn: tokens.expiresIn,
    };
  }

  @Post('refresh')
  async refresh(
    @Req() req: Request,
    @Body() body: Partial<RefreshTokenDto>,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.refreshToken ?? body.refreshToken;
    if (!refreshToken) {
      throw new UnauthorizedException('Missing refresh token.');
    }

    const tokens = await this.authService.refresh(refreshToken);
    this.attachRefreshCookie(res, tokens.refreshToken);
    return {
      accessToken: tokens.accessToken,
      tokenType: tokens.tokenType,
      expiresIn: tokens.expiresIn,
    };
  }

  @Get('google')
  @UseGuards(AuthGuard('google'))
  async googleAuth() {
    return;
  }

  @Get('google/callback')
  @UseGuards(AuthGuard('google'))
  async googleAuthCallback(@Req() req: Request, @Res() res: Response) {
    const googleUser = req.user as {
      email?: string;
      firstName?: string;
      lastName?: string;
      providerId: string;
    };

    const user = await this.authService.findOrCreateGoogleUser(googleUser);
    const tokens = await this.authService.issueTokens(user.id, user.email);
    this.attachRefreshCookie(res, tokens.refreshToken);

    const redirectUrl = process.env.FRONTEND_SUCCESS_LOGIN_REDIRECT ?? 'http://localhost:3001';
    res.redirect(`${redirectUrl}?accessToken=${tokens.accessToken}`);
  }

  private attachRefreshCookie(res: Response, refreshToken: string) {
    res.cookie('refreshToken', refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/auth/refresh',
    });
  }
}
