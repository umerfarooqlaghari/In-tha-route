/**
 * Base URL of the In Tha Route API.
 * Override per build with EXPO_PUBLIC_API_URL (e.g. http://localhost:5000 for a local backend).
 */
export const API_URL = (
  process.env.EXPO_PUBLIC_API_URL ?? 'https://in-the-route-app.onrender.com'
).replace(/\/+$/, '');
