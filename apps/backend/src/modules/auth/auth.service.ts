import { Injectable, UnauthorizedException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma/prisma.service';
import { LoginDto } from './dto/login.dto';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) {
      throw new UnauthorizedException('User already exists.');
    }

    const user = await this.prisma.user.create({
      data: {
        email: dto.email,
        name: dto.name,
        passwordHash: this.hash(dto.password),
      },
    });

    return this.issueTokens(user.id, user.email);
  }

  async login(dto: LoginDto) {
    const user = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (!user || user.passwordHash !== this.hash(dto.password)) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    return this.issueTokens(user.id, user.email);
  }

  async refresh(refreshToken: string) {
    const payload = await this.jwtService.verifyAsync<{ sub: string; email: string }>(refreshToken, {
      secret: process.env.REFRESH_SECRET ?? 'dev_refresh_secret',
    });

    const session = await this.prisma.session.findFirst({
      where: {
        userId: payload.sub,
        refreshTokenHash: this.hash(refreshToken),
        expiresAt: { gt: new Date() },
      },
    });

    if (!session) {
      throw new UnauthorizedException('Invalid refresh token.');
    }

    return this.issueTokens(payload.sub, payload.email, session.id);
  }

  async issueTokens(userId: string, email: string, existingSessionId?: string) {
    const accessToken = await this.jwtService.signAsync(
      { sub: userId, email },
      {
        secret: process.env.JWT_SECRET ?? 'dev_jwt_secret',
        expiresIn: '15m',
      },
    );

    const refreshToken = await this.jwtService.signAsync(
      { sub: userId, email },
      {
        secret: process.env.REFRESH_SECRET ?? 'dev_refresh_secret',
        expiresIn: '7d',
      },
    );

    const refreshTokenHash = this.hash(refreshToken);

    if (existingSessionId) {
      await this.prisma.session.update({
        where: { id: existingSessionId },
        data: {
          refreshTokenHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    } else {
      await this.prisma.session.create({
        data: {
          userId,
          refreshTokenHash,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      });
    }

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: 900,
    };
  }

  async findOrCreateGoogleUser(googleUser: {
    email?: string;
    firstName?: string;
    lastName?: string;
    providerId: string;
  }) {
    if (!googleUser.email) {
      throw new UnauthorizedException('Google account does not provide email.');
    }

    const existing = await this.prisma.user.findUnique({ where: { email: googleUser.email } });

    if (existing) {
      return existing;
    }

    return this.prisma.user.create({
      data: {
        email: googleUser.email,
        name: `${googleUser.firstName ?? ''} ${googleUser.lastName ?? ''}`.trim() || null,
        provider: 'GOOGLE',
        providerId: googleUser.providerId,
      },
    });
  }

  private hash(value: string) {
    return createHash('sha256').update(value).digest('hex');
  }
}
