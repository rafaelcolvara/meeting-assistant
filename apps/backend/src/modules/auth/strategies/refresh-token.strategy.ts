import { Injectable } from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';

@Injectable()
export class RefreshTokenStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor() {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request: { cookies?: { refreshToken?: string } }) =>
          request?.cookies?.refreshToken ?? null,
      ]),
      ignoreExpiration: false,
      secretOrKey: process.env.REFRESH_SECRET ?? 'dev_refresh_secret',
      passReqToCallback: true,
    });
  }

  async validate(
    request: { cookies?: { refreshToken?: string } },
    payload: { sub: string; email: string },
  ) {
    return {
      ...payload,
      refreshToken: request.cookies?.refreshToken,
    };
  }
}
