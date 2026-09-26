// Build-time and runtime site config. PUBLIC_* values come from the Vercel env (§16.1).

export const API_URL: string = (import.meta.env.PUBLIC_API_URL || 'http://localhost:8787').replace(/\/$/, '');
export const SITE_URL: string = (import.meta.env.PUBLIC_SITE_URL || 'https://dropzy.app').replace(/\/$/, '');

export type NavKey = 'wifi' | 'private' | 'room' | 'join' | null;

// Droplet in a rounded olive square, as an inline data URI (no extra request).
export const FAVICON_SVG =
  "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='8' fill='%23545333'/><path d='M16 26a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5S16.5 9.5 16 7c-.5 2.5-2 4.9-4 6.5S9 17 9 19a7 7 0 0 0 7 7z' fill='%23FDFBD4'/></svg>";
export const FAVICON = `data:image/svg+xml,${FAVICON_SVG}`;
