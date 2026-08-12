import { Injectable } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { randomInt } from 'node:crypto';

const BCRYPT_ROUNDS = 12;
const CODE_DIGITS = 6;

export interface GeneratedEmailCode {
  /** Sent to the mailbox; never stored. */
  code: string;
  codeHash: string;
}

/**
 * One-time codes emailed for passwordless sign-in.
 *
 * Six digits is only ~20 bits, so the protection comes from the challenge that
 * carries it: short expiry, a hard per-challenge attempt cap, and single use.
 */
@Injectable()
export class EmailCodeService {
  async generate(): Promise<GeneratedEmailCode> {
    const code = String(randomInt(0, 10 ** CODE_DIGITS)).padStart(
      CODE_DIGITS,
      '0',
    );
    return { code, codeHash: await bcrypt.hash(code, BCRYPT_ROUNDS) };
  }

  /** Constant-time-ish compare via bcrypt; a missing hash always fails. */
  async verify(code: string, codeHash: string | undefined): Promise<boolean> {
    const candidate = code.replace(/\D/g, '');
    if (
      codeHash === undefined ||
      codeHash.length === 0 ||
      candidate.length !== CODE_DIGITS
    ) {
      return false;
    }
    return bcrypt.compare(candidate, codeHash);
  }
}
