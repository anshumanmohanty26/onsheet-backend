import { Inject, Injectable } from "@nestjs/common";
import type Redis from "ioredis";
import { REDIS_PRESENCE_CLIENT } from "./redis-presence.provider";

export interface ActiveUser {
	userId: string;
	displayName: string;
	socketId: string;
	color: string;
	cursor?: { row: number; col: number };
}

/** TTL for a presence room key — auto-expires stale rooms after 24 h of no activity. */
const PRESENCE_TTL_SECONDS = 86_400;

const USER_COLORS = [
	"#ef4444",
	"#f97316",
	"#eab308",
	"#22c55e",
	"#06b6d4",
	"#3b82f6",
	"#8b5cf6",
	"#ec4899",
];

/**
 * Deterministic color derived from the userId string.
 * Consistent across reconnects and server instances — same user always
 * gets the same highlight color regardless of join order.
 */
function pickColor(userId: string): string {
	let h = 0;
	for (let i = 0; i < userId.length; i++) h = (h * 31 + userId.charCodeAt(i)) | 0;
	return USER_COLORS[Math.abs(h) % USER_COLORS.length];
}

/** Redis key for a sheet's presence hash: field = socketId, value = JSON(ActiveUser). */
function roomKey(sheetId: string): string {
	return `presence:room:${sheetId}`;
}

@Injectable()
export class CollabService {
	constructor(@Inject(REDIS_PRESENCE_CLIENT) private readonly redis: Redis) {}

	/**
	 * Add a user to a room and return the updated full user list.
	 * Stores presence in a Redis Hash keyed by socketId with a rolling 24 h TTL.
	 */
	async join(sheetId: string, user: Omit<ActiveUser, "color">): Promise<ActiveUser[]> {
		const active: ActiveUser = { ...user, color: pickColor(user.userId) };
		const key = roomKey(sheetId);
		await this.redis.hset(key, user.socketId, JSON.stringify(active));
		await this.redis.expire(key, PRESENCE_TTL_SECONDS);
		return this.getRoom(sheetId);
	}

	/** Remove a user from a room; deletes the key entirely when the room empties. */
	async leave(sheetId: string, socketId: string): Promise<void> {
		const key = roomKey(sheetId);
		await this.redis.hdel(key, socketId);
		const remaining = await this.redis.hlen(key);
		if (remaining === 0) await this.redis.del(key);
	}

	/** Persist the latest cursor position for a user and refresh the room TTL. */
	async updateCursor(
		sheetId: string,
		socketId: string,
		cursor: { row: number; col: number },
	): Promise<void> {
		const key = roomKey(sheetId);
		const raw = await this.redis.hget(key, socketId);
		if (!raw) return;
		const user: ActiveUser = JSON.parse(raw) as ActiveUser;
		user.cursor = cursor;
		await this.redis.hset(key, socketId, JSON.stringify(user));
		await this.redis.expire(key, PRESENCE_TTL_SECONDS);
	}

	/** Return all active users in a room (empty array if none). */
	async getRoom(sheetId: string): Promise<ActiveUser[]> {
		const all = await this.redis.hgetall(roomKey(sheetId));
		if (!all) return [];
		return Object.values(all).map((v) => JSON.parse(v) as ActiveUser);
	}
}
