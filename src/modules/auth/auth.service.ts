import { ConflictException, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import type { Response } from 'express';
import {
  ACCESS_COOKIE,
  ACCESS_TTL_MS,
  REFRESH_COOKIE,
  REFRESH_TTL_MS,
  cookieBase,
} from '../../config/cookie.config';
import { UsersService } from '../users/users.service';
import { RegisterDto } from './dto/register.dto';

@Injectable()
export class AuthService {
  constructor(
    private readonly usersService: UsersService,
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  async register(dto: RegisterDto) {
    const existing = await this.usersService.findByEmail(dto.email);
    if (existing) throw new ConflictException('Email already in use');

    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.usersService.create({
      email: dto.email,
      displayName: dto.name,
      passwordHash,
    });

    const tokens = await this.generateTokens(user.id, user.email);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async validateUser(email: string, password: string) {
    const user = await this.usersService.findByEmail(email);
    if (!user) throw new UnauthorizedException('Invalid credentials');
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) throw new UnauthorizedException('Invalid credentials');
    const { passwordHash, refreshToken, ...safe } = user;
    return safe;
  }

  async login(user: Express.User) {
    const tokens = await this.generateTokens(user.id, user.email);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async refreshTokens(user: Express.User) {
    const dbUser = await this.usersService.findById(user.id);
    if (!dbUser?.refreshToken) throw new UnauthorizedException();
    const tokens = await this.generateTokens(user.id, user.email);
    await this.storeRefreshToken(user.id, tokens.refreshToken);
    return tokens;
  }

  async logout(userId: string) {
    await this.usersService.clearRefreshToken(userId);
  }

  // ── Cookie helpers ───────────────────────────────────────────────────────────

  attachCookies(res: Response, tokens: { accessToken: string; refreshToken: string }): void {
    const secure = this.config.get<string>('app.nodeEnv') === 'production';
    res.cookie(ACCESS_COOKIE, tokens.accessToken, {
      ...cookieBase(secure),
      maxAge: ACCESS_TTL_MS,
    });
    res.cookie(REFRESH_COOKIE, tokens.refreshToken, {
      ...cookieBase(secure),
      maxAge: REFRESH_TTL_MS,
      path: '/api/v1/auth',
    });
  }

  clearCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE);
    res.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth' });
  }

  // ── Private helpers ──────────────────────────────────────────────────────────

  private async generateTokens(userId: string, email: string) {
    const payload = { sub: userId, email };
    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>('jwt.accessSecret'),
        expiresIn: this.config.get<string>('jwt.accessExpiresIn'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.config.get<string>('jwt.refreshSecret'),
        expiresIn: this.config.get<string>('jwt.refreshExpiresIn'),
      }),
    ]);
    return { accessToken, refreshToken };
  }

  private async storeRefreshToken(userId: string, token: string) {
    const hash = await bcrypt.hash(token, 10);
    await this.usersService.updateRefreshToken(userId, hash);
  }
}
