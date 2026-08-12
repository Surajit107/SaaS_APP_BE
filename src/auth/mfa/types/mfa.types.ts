/** How a second factor was satisfied. */
export type MfaVerificationMethod = 'totp' | 'backup_code';

/** What the client may present for a pending challenge. */
export type MfaChallengeMethod = 'totp' | 'backup_code' | 'email_code';

/**
 * Returned by `POST /auth/login` instead of a token pair when the account has a
 * second factor enabled. No session exists until the challenge is verified.
 */
export interface MfaRequiredPayload {
  mfaRequired: true;
  challengeToken: string;
  methods: MfaChallengeMethod[];
  expiresAt: string;
}

export interface MfaStatusPayload {
  isTotpEnabled: boolean;
  totpEnabledAt: string | null;
  hasPendingEnrollment: boolean;
  backupCodesRemaining: number;
  isEmailCodeLoginEnabled: boolean;
}

export interface TotpEnrollmentPayload {
  /** Base32 secret for manual entry when a QR code cannot be scanned. */
  secret: string;
  otpauthUri: string;
  /** PNG data URL, rendered server-side so clients need no QR dependency. */
  qrCodeDataUrl: string;
  expiresAt: string;
}

export interface BackupCodesPayload {
  /** Shown exactly once — only keyed digests are stored. */
  backupCodes: string[];
  generatedAt: string;
}
