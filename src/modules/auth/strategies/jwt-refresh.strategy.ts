import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import * as bcrypt from 'bcrypt';
import type { Request } from 'express';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { REFRESH_COOKIE } from '../../../config/cookie.config';
import { UsersService } from '../../users/users.service';

@Injectable()
export class JwtRefreshStrategy extends PassportStrategy(Strategy, 'jwt-refresh') {
  constructor(
    private readonly config: ConfigService,
    private readonly usersService: UsersService,
  ) {
    super({
      jwtFromRequest: (req: Request) => {
        // Cookie takes priority, then fall back to request body field
        if (req?.cookies?.[REFRESH_COOKIE]) return req.cookies[REFRESH_COOKIE] as string;
        return ExtractJwt.fromBodyField('refreshToken')(req);
      },
      secretOrKey: config.get<string>('jwt.refreshSecret') ?? '',
      ignoreExpiration: false,
      passReqToCallback: true,
    });
  }

  async validate(
    req: { cookies?: Record<string, string>; body?: { refreshToken?: string } },
    payload: { sub: string; email: string },
  ) {
    const refreshToken = req.cookies?.[REFRESH_COOKIE] ?? req.body?.refreshToken;
    const user = await this.usersService.findById(payload.sub);
    if (!user?.refreshToken || !refreshToken) throw new UnauthorizedException();
    const valid = await bcrypt.compare(refreshToken, user.refreshToken);
    if (!valid) throw new UnauthorizedException();
    const { passwordHash, refreshToken: _rt, ...safe } = user;
    return safe;
  }
}
