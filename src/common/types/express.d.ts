// Augment Express.User so Passport's req.user is strongly typed (sans secrets)
import type { User as PrismaUser } from '@prisma/client';

declare global {
  namespace Express {
    // Passport merges this interface into Request.user automatically
    interface User extends Omit<PrismaUser, 'passwordHash' | 'refreshToken'> {}
  }
}
