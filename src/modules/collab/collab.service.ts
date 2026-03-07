import { Injectable } from '@nestjs/common';

interface ActiveUser {
  userId: string;
  displayName: string;
  socketId: string;
  color: string;
  cursor?: { row: number; col: number };
}

@Injectable()
export class CollabService {
  // sheetId → Set of active users
  private readonly rooms = new Map<string, Map<string, ActiveUser>>();

  private readonly USER_COLORS = [
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#06b6d4',
    '#3b82f6',
    '#8b5cf6',
    '#ec4899',
  ];

  join(sheetId: string, user: Omit<ActiveUser, 'color'>) {
    if (!this.rooms.has(sheetId)) this.rooms.set(sheetId, new Map());
    // biome-ignore lint/style/noNonNullAssertion: map is guaranteed by the line above
    const room = this.rooms.get(sheetId)!;
    const color = this.USER_COLORS[room.size % this.USER_COLORS.length];
    room.set(user.socketId, { ...user, color });
    return this.getRoom(sheetId);
  }

  leave(sheetId: string, socketId: string) {
    this.rooms.get(sheetId)?.delete(socketId);
    if (this.rooms.get(sheetId)?.size === 0) this.rooms.delete(sheetId);
  }

  updateCursor(sheetId: string, socketId: string, cursor: { row: number; col: number }) {
    const user = this.rooms.get(sheetId)?.get(socketId);
    if (user) user.cursor = cursor;
  }

  getRoom(sheetId: string): ActiveUser[] {
    return Array.from(this.rooms.get(sheetId)?.values() ?? []);
  }
}
