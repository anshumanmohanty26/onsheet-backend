export const ACCESS_COOKIE = "accessToken";
export const REFRESH_COOKIE = "refreshToken";

/** 15 minutes in milliseconds */
export const ACCESS_TTL_MS = 15 * 60 * 1_000;

/** 7 days in milliseconds */
export const REFRESH_TTL_MS = 7 * 24 * 60 * 60 * 1_000;

export const cookieBase = (secure: boolean) =>
	({
		httpOnly: true,
		// sameSite:"none" is required for cross-origin requests (frontend and
		// backend are on different domains in production). Requires secure:true.
		sameSite: (secure ? "none" : "lax") as "none" | "lax",
		secure,
	}) as const;
