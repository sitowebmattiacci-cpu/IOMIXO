/** Single entry point for authentication used by pages: Firebase Auth is the only provider. Standalone on purpose: the AuthProvider on every page imports it without pulling lib/auth/index.ts (Firestore). */
export const authProvider = () => 'firebase' as const
