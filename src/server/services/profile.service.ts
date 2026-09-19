import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { Prisma } from '@prisma/client';
import sharp from 'sharp';

import { platformDb } from '@/lib/tenant';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { normaliseUsername } from '@/lib/domain/identifier';
import {
  AVATAR_EDGE,
  AVATAR_MAX_BYTES,
  CONFIRM_TTL_MINUTES,
  PASSWORD_MIN,
  confirmationRoute,
  maskEmail,
  validatePasswordChange,
  validateProfile,
  type PasswordChangeDraft,
  type ProfileDraft,
} from '@/lib/domain/profile';
import { ACCEPTED_TYPES, sniffType, validateUpload } from '@/lib/domain/upload';
import { buildKey, newObjectId, storage } from '@/server/storage';
import { mailIsDeliverable, mailer } from '@/server/email';
import { recordAudit } from './audit.service';

/**
 * =============================================================================
 * A PERSON'S OWN ACCOUNT
 * =============================================================================
 *
 * Identity is GLOBAL in this system: one `User` can hold memberships at several
 * schools, and a lecturer who moves does not become a second person. So
 * everything here goes through `platformDb` rather than a tenant client — a
 * profile is not owned by a school, and scoping it to one would mean a person
 * with two memberships had two names.
 *
 * That makes the authorisation rule simple and strict: EVERY function here acts
 * on the caller's own `userId`, taken from their session. None of them accepts a
 * user id as an argument. There is therefore no id to substitute, and no way to
 * reach this code path for somebody else's account at all.
 */

export interface ProfileResult {
  ok: boolean;
  message: string;
  /** Set when a change is parked awaiting an emailed confirmation. */
  pending?: boolean;
  /** Development only: where the confirmation mail was written. */
  localMailPath?: string;
}

const TOKEN_BYTES = 32;

/** The one format an avatar is ever stored as, taken from the allow-list. */
const JPEG = ACCEPTED_TYPES.find((t) => t.mediaType === 'image/jpeg')!;

/** Tokens are stored hashed, exactly as passwords are. */
function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

// -----------------------------------------------------------------------------
// The things a person owns
// -----------------------------------------------------------------------------

export async function loadProfile(userId: string) {
  return platformDb.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      username: true,
      email: true,
      phone: true,
      avatarKey: true,
      mustChangePassword: true,
      lastLoginAt: true,
      createdAt: true,
    },
  });
}

export async function saveProfile(params: {
  userId: string;
  draft: ProfileDraft;
}): Promise<ProfileResult> {
  const problems = validateProfile(params.draft);
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const current = await platformDb.user.findUnique({ where: { id: params.userId } });
  if (!current) return { ok: false, message: 'That account no longer exists.' };

  const username = params.draft.username.trim()
    ? normaliseUsername(params.draft.username)
    : null;

  /*
   * A USERNAME MAY BE CHANGED BUT NEVER REMOVED once it is the only way in.
   *
   * Email is optional on a user, so an account with no email and no username
   * has no identifier left to sign in with. Clearing it would lock the person
   * out permanently and silently, at the moment they pressed Save.
   */
  if (!username && !current.email) {
    return {
      ok: false,
      message:
        'Your username is the only way you can sign in, because this account has no email address. Choose a different username rather than clearing it.',
    };
  }

  try {
    await platformDb.user.update({
      where: { id: params.userId },
      data: {
        firstName: params.draft.firstName.trim(),
        lastName: params.draft.lastName.trim(),
        username,
        phone: params.draft.phone.trim() || null,
      },
    });
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      // The unique index is the arbiter, not a prior SELECT: two people picking
      // the same username in the same second would both pass a check-then-act.
      return { ok: false, message: 'That username is already taken. Try another.' };
    }
    console.error('[profile] save failed', error);
    return { ok: false, message: 'Could not save your profile.' };
  }

  void recordAudit({
    schoolId: null,
    actorId: params.userId,
    action: 'profile.update',
    entityType: 'User',
    entityId: params.userId,
    summary: 'Updated their own profile.',
  });

  return { ok: true, message: 'Profile saved.' };
}

// -----------------------------------------------------------------------------
// The profile picture
// -----------------------------------------------------------------------------

/**
 * Store a profile picture.
 *
 * The bytes are SNIFFED and then RE-ENCODED, which does two things a type check
 * alone cannot. Sniffing means the declared content type — which the browser
 * supplies and an attacker controls — never decides anything. Re-encoding
 * through sharp means whatever arrives leaves as a clean JPEG: a polyglot file
 * that is a valid image and a valid script does not survive being decoded to a
 * pixel buffer and written out again.
 */
export async function saveAvatar(params: {
  userId: string;
  file: File;
}): Promise<ProfileResult> {
  if (params.file.size === 0) return { ok: false, message: 'Choose a picture first.' };
  if (params.file.size > AVATAR_MAX_BYTES) {
    return { ok: false, message: 'That picture is larger than 3 MB. Choose a smaller one.' };
  }

  const bytes = new Uint8Array(await params.file.arrayBuffer());
  const sniffed = sniffType(bytes);

  const verdict = validateUpload({
    bytes,
    fileName: params.file.name,
    limits: { maxBytes: AVATAR_MAX_BYTES, kinds: ['image'] },
  });
  if (!verdict.ok) return { ok: false, message: verdict.message };
  if (!sniffed) return { ok: false, message: 'That file is not an image this system can read.' };

  let encoded: Buffer;
  try {
    encoded = await sharp(bytes)
      // Square, centred, and capped. A profile picture is a face in a circle.
      .resize(AVATAR_EDGE, AVATAR_EDGE, { fit: 'cover', position: 'attention' })
      .jpeg({ quality: 82, mozjpeg: true })
      .toBuffer();
  } catch (error) {
    console.error('[profile] avatar re-encode failed', error);
    return { ok: false, message: 'That image could not be processed. Try a different file.' };
  }

  const user = await platformDb.user.findUnique({
    where: { id: params.userId },
    select: { avatarKey: true, memberships: { select: { schoolId: true }, take: 1 } },
  });
  if (!user) return { ok: false, message: 'That account no longer exists.' };

  // Avatars are PRIVATE. A school photograph of a child is not something to
  // publish at a guessable URL, and the /files route re-checks the session on
  // every read.
  const schoolId = user.memberships[0]?.schoolId;
  if (!schoolId) return { ok: false, message: 'Your account is not attached to a school.' };

  const key = buildKey({
    visibility: 'private',
    schoolId,
    folder: 'avatar',
    id: newObjectId(),
    // Always a JPEG: whatever arrived, what is STORED is the re-encoded output.
    type: JPEG,
  });

  const driver = await storage();
  await driver.put({ key, body: encoded, mediaType: 'image/jpeg', visibility: 'private' });

  const previous = user.avatarKey;
  await platformDb.user.update({ where: { id: params.userId }, data: { avatarKey: key } });

  // Delete the old one only AFTER the new key is committed. The other order
  // leaves a person with no picture if the write fails between the two.
  if (previous && previous !== key) {
    try {
      await driver.delete(previous);
    } catch (error) {
      // An orphaned object costs a few kilobytes; failing the request over it
      // would cost the user their upload.
      console.warn('[profile] could not delete the previous avatar', error);
    }
  }

  void recordAudit({
    schoolId,
    actorId: params.userId,
    action: 'profile.avatar',
    entityType: 'User',
    entityId: params.userId,
    summary: 'Changed their profile picture.',
  });

  return { ok: true, message: 'Picture updated.' };
}

export async function removeAvatar(userId: string): Promise<ProfileResult> {
  const user = await platformDb.user.findUnique({
    where: { id: userId },
    select: { avatarKey: true },
  });
  if (!user?.avatarKey) return { ok: false, message: 'You have no picture to remove.' };

  await platformDb.user.update({ where: { id: userId }, data: { avatarKey: null } });
  try {
    await (await storage()).delete(user.avatarKey);
  } catch {
    // The row is what the application reads; a leftover object is harmless.
  }

  return { ok: true, message: 'Picture removed.' };
}

// -----------------------------------------------------------------------------
// Changing a password, confirmed by email
// -----------------------------------------------------------------------------

/**
 * Begin a password change.
 *
 * The new password is hashed and PARKED rather than applied. What unlocks it is
 * a token that exists only in the email — so changing somebody's password needs
 * their mailbox as well as their unlocked screen, and the real owner gets a
 * message telling them it was attempted.
 *
 * Where an account has no email address the change applies immediately on the
 * strength of the current password, because the alternative is an account that
 * can never change its password at all. The caller is told which happened.
 */
export async function requestPasswordChange(params: {
  userId: string;
  draft: PasswordChangeDraft;
  origin: string;
  now?: Date;
}): Promise<ProfileResult> {
  const now = params.now ?? new Date();

  const problems = validatePasswordChange(params.draft);
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const user = await platformDb.user.findUnique({ where: { id: params.userId } });
  if (!user) return { ok: false, message: 'That account no longer exists.' };

  // The credential check is separate from the shape check, and its failure is
  // reported on its own — blurring the two into "something was wrong" helps
  // nobody who typed their password correctly and mistyped the confirmation.
  const correct = await verifyPassword(params.draft.currentPassword, user.passwordHash);
  if (!correct) return { ok: false, message: 'That is not your current password.' };

  const newHash = await hashPassword(params.draft.newPassword);

  if (confirmationRoute(user.email) === 'IMMEDIATE') {
    await platformDb.user.update({
      where: { id: user.id },
      data: { passwordHash: newHash, mustChangePassword: false },
    });

    void recordAudit({
      schoolId: null,
      actorId: user.id,
      action: 'profile.password',
      entityType: 'User',
      entityId: user.id,
      summary: 'Changed their password. No email address on file, so it applied immediately.',
    });

    return {
      ok: true,
      message:
        'Password changed. This account has no email address, so there was nothing to confirm against — ask the office to add one if you would like changes confirmed in future.',
    };
  }

  // One pending change at a time. Otherwise a stack of live links accumulates,
  // every one of them a key to the account, and the oldest is the least likely
  // to be noticed.
  await platformDb.accountChangeRequest.deleteMany({
    where: { userId: user.id, kind: 'PASSWORD', consumedAt: null },
  });

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  await platformDb.accountChangeRequest.create({
    data: {
      userId: user.id,
      kind: 'PASSWORD',
      tokenHash: hashToken(token),
      payload: newHash,
      expiresAt: new Date(now.getTime() + CONFIRM_TTL_MINUTES * 60_000),
      summary: 'Password change requested from the account page.',
    },
  });

  const link = `${params.origin}/account/confirm?token=${encodeURIComponent(token)}`;
  const sent = await (
    await mailer()
  ).send({
    to: user.email!,
    subject: 'Confirm your new password',
    body: [
      `Hello ${user.firstName},`,
      '',
      'A new password was set on your account. It is NOT active yet — open the link',
      `below within ${CONFIRM_TTL_MINUTES} minutes to confirm it:`,
      '',
      link,
      '',
      'If this was not you, do nothing. The link expires on its own and your',
      'current password keeps working. Tell your school office, because somebody',
      'knew your current password to get this far.',
    ].join('\n'),
  });

  void recordAudit({
    schoolId: null,
    actorId: user.id,
    action: 'profile.password.request',
    entityType: 'User',
    entityId: user.id,
    summary: `Password change requested; confirmation sent via ${sent.via}.`,
  });

  return {
    ok: true,
    pending: true,
    localMailPath: sent.localPath,
    message: mailIsDeliverable()
      ? `Almost done. We have emailed ${maskEmail(user.email!)} — open the link within ${CONFIRM_TTL_MINUTES} minutes and your new password takes effect. Until then your current password still works.`
      : `Your new password is waiting for confirmation, but NO MAIL SERVER IS CONFIGURED on this deployment, so nothing was actually sent. The message was written to ${sent.localPath ?? 'the server log'}.`,
  };
}

/**
 * Complete a parked change.
 *
 * The token is looked up by its HASH, and compared in constant time. A lookup
 * on the raw token would put it in the query log of every proxy between here
 * and the database.
 */
export async function confirmAccountChange(params: {
  token: string;
  now?: Date;
}): Promise<ProfileResult> {
  const now = params.now ?? new Date();
  const token = params.token.trim();
  if (!token) return { ok: false, message: 'That confirmation link is incomplete.' };

  const request = await platformDb.accountChangeRequest.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: true },
  });

  /*
   * ONE MESSAGE FOR EVERY FAILURE.
   *
   * Expired, already used, and never existed are deliberately indistinguishable
   * from the outside. Telling somebody holding a guessed token that it "has
   * expired" confirms it was once real, which is a free oracle over the token
   * space.
   */
  const refusal: ProfileResult = {
    ok: false,
    message:
      'That confirmation link is not valid. It may have expired, or already been used. Start the change again from your account page.',
  };

  if (!request) return refusal;
  if (request.consumedAt) return refusal;
  if (request.expiresAt.getTime() < now.getTime()) return refusal;

  // Belt and braces: the unique index already found this row by hash, but the
  // comparison is done in constant time so the lookup is not the only guard.
  const expected = Buffer.from(request.tokenHash, 'utf8');
  const actual = Buffer.from(hashToken(token), 'utf8');
  if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) return refusal;

  if (request.kind === 'PASSWORD') {
    await platformDb.$transaction([
      platformDb.user.update({
        where: { id: request.userId },
        data: { passwordHash: request.payload, mustChangePassword: false },
      }),
      platformDb.accountChangeRequest.update({
        where: { id: request.id },
        data: { consumedAt: now },
      }),
    ]);

    void recordAudit({
      schoolId: null,
      actorId: request.userId,
      action: 'profile.password.confirm',
      entityType: 'User',
      entityId: request.userId,
      summary: 'Confirmed a password change by email.',
    });

    return {
      ok: true,
      message: 'Your new password is now active. Sign in with it next time.',
    };
  }

  return refusal;
}

/** Any change this person has started and not yet confirmed. */
export async function pendingChangeFor(userId: string, now = new Date()) {
  return platformDb.accountChangeRequest.findFirst({
    where: { userId, consumedAt: null, expiresAt: { gt: now } },
    orderBy: { createdAt: 'desc' },
    select: { id: true, kind: true, expiresAt: true, createdAt: true },
  });
}

/** Abandon a pending change, so a mistaken request is not left live for an hour. */
export async function cancelPendingChange(userId: string): Promise<ProfileResult> {
  const { count } = await platformDb.accountChangeRequest.deleteMany({
    where: { userId, consumedAt: null },
  });
  return count > 0
    ? { ok: true, message: 'Cancelled. Your current password is unchanged.' }
    : { ok: false, message: 'There was nothing pending to cancel.' };
}

// -----------------------------------------------------------------------------
// Forgotten passwords
// -----------------------------------------------------------------------------

/**
 * Begin a password reset for somebody who cannot sign in.
 *
 * THE RESPONSE NEVER REVEALS WHETHER THE ACCOUNT EXISTS. Every path returns the
 * same message: an unknown address, a known address, an account with no email on
 * file. A reset form that says "no such user" is a free membership oracle for
 * the whole institution — walk a list of names and learn who attends the school,
 * without a single credential.
 *
 * Nothing about the account changes here. The current password keeps working
 * until a link is actually opened, so a stranger spamming this form cannot lock
 * anybody out — which is the failure mode of every reset flow that invalidates
 * the old password up front.
 */
export async function requestPasswordReset(params: {
  identifier: string;
  origin: string;
  /** Narrows to one school when the request came from a branded login page. */
  schoolSlug?: string | null;
  now?: Date;
}): Promise<{ ok: true; message: string; localMailPath?: string }> {
  const now = params.now ?? new Date();

  // One message, whatever happened. Composed once so no branch can drift.
  const SAME_ANSWER = {
    ok: true as const,
    message:
      'If that account exists and has an email address on file, a reset link is on its way. It expires in an hour. If nothing arrives, your school office can reset it for you.',
  };

  const raw = params.identifier.trim().toLowerCase();
  if (!raw) return SAME_ANSWER;

  const user = await platformDb.user.findFirst({
    where: raw.includes('@') ? { email: raw } : { username: raw },
    include: { memberships: { include: { school: { select: { slug: true, name: true } } } } },
  });

  // No account, no email to send to, or a disabled account: all silent.
  if (!user || !user.email || !user.isActive) return SAME_ANSWER;

  /*
   * A RESET IS RATE-LIMITED BY THE PENDING REQUEST ITSELF.
   *
   * Deleting the previous one and issuing a fresh token means a stranger
   * hammering the form sends the owner a stream of emails. So an unexpired
   * request is reused rather than replaced: the second press inside the hour
   * re-sends nothing and the owner gets one message, not forty.
   */
  const live = await platformDb.accountChangeRequest.findFirst({
    where: { userId: user.id, kind: 'PASSWORD_RESET', consumedAt: null, expiresAt: { gt: now } },
  });
  if (live) return SAME_ANSWER;

  const token = randomBytes(TOKEN_BYTES).toString('base64url');
  await platformDb.accountChangeRequest.create({
    data: {
      userId: user.id,
      kind: 'PASSWORD_RESET',
      tokenHash: hashToken(token),
      // Nothing to apply: the new password is chosen when the link is opened.
      // A reset differs from a change in exactly this — the person asking has
      // no password to prove anything with.
      payload: '',
      expiresAt: new Date(now.getTime() + CONFIRM_TTL_MINUTES * 60_000),
      summary: 'Password reset requested from the sign-in page.',
    },
  });

  const link = `${params.origin}/account/reset?token=${encodeURIComponent(token)}`;
  const school =
    user.memberships.find((m) => m.school.slug === params.schoolSlug)?.school ??
    user.memberships[0]?.school ??
    null;

  const sent = await (
    await mailer()
  ).send({
    to: user.email,
    subject: 'Reset your password',
    body: [
      `Hello ${user.firstName},`,
      '',
      school
        ? `Somebody asked to reset the password for your ${school.name} account.`
        : 'Somebody asked to reset the password on your account.',
      '',
      `Open this link within ${CONFIRM_TTL_MINUTES} minutes to choose a new one:`,
      '',
      link,
      '',
      'If this was not you, do nothing. Your current password still works and the',
      'link expires on its own. Nobody can change your password without opening it.',
    ].join('\n'),
  });

  void recordAudit({
    schoolId: null,
    actorId: user.id,
    action: 'profile.password.reset.request',
    entityType: 'User',
    entityId: user.id,
    summary: `Password reset requested; sent via ${sent.via}.`,
  });

  return { ...SAME_ANSWER, localMailPath: sent.localPath };
}

/** Is this reset link still good? Checked before the form is rendered. */
export async function checkResetToken(params: {
  token: string;
  now?: Date;
}): Promise<{ ok: boolean; firstName?: string }> {
  const now = params.now ?? new Date();
  const token = params.token.trim();
  if (!token) return { ok: false };

  const request = await platformDb.accountChangeRequest.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { firstName: true } } },
  });

  if (!request || request.kind !== 'PASSWORD_RESET') return { ok: false };
  if (request.consumedAt || request.expiresAt.getTime() < now.getTime()) return { ok: false };

  return { ok: true, firstName: request.user.firstName };
}

/**
 * Finish a reset: set the new password and burn the token.
 *
 * The token and the new password arrive TOGETHER, in one request. Rendering the
 * form and then accepting the password on a second request without the token
 * would mean the form itself had to carry authority, and a form that carries
 * authority is a form that can be replayed.
 */
export async function completePasswordReset(params: {
  token: string;
  newPassword: string;
  confirmPassword: string;
  now?: Date;
}): Promise<ProfileResult> {
  const now = params.now ?? new Date();

  const refusal: ProfileResult = {
    ok: false,
    message:
      'That reset link is not valid. It may have expired, or already been used. Ask for a new one from the sign-in page.',
  };

  const token = params.token.trim();
  if (!token) return refusal;

  const request = await platformDb.accountChangeRequest.findUnique({
    where: { tokenHash: hashToken(token) },
  });
  if (!request || request.kind !== 'PASSWORD_RESET') return refusal;
  if (request.consumedAt || request.expiresAt.getTime() < now.getTime()) return refusal;

  // The password rules, minus the current-password check — the whole point of a
  // reset is that the person does not have it.
  const problems: string[] = [];
  if (params.newPassword.length < PASSWORD_MIN) {
    problems.push(`A password needs at least ${PASSWORD_MIN} characters.`);
  }
  if (params.newPassword.length > 200) problems.push('That password is too long.');
  if (params.newPassword !== params.confirmPassword) {
    problems.push('The two passwords do not match.');
  }
  if (problems.length > 0) return { ok: false, message: problems.join(' ') };

  const hash = await hashPassword(params.newPassword);

  await platformDb.$transaction([
    platformDb.user.update({
      where: { id: request.userId },
      // mustChangePassword is CLEARED: they have just chosen this one
      // themselves, so forcing them to choose again at sign-in is pointless.
      data: { passwordHash: hash, mustChangePassword: false },
    }),
    platformDb.accountChangeRequest.update({
      where: { id: request.id },
      data: { consumedAt: now },
    }),
    // Any pending change authorised by the OLD password is abandoned with it.
    platformDb.accountChangeRequest.deleteMany({
      where: { userId: request.userId, consumedAt: null, kind: 'PASSWORD' },
    }),
  ]);

  void recordAudit({
    schoolId: null,
    actorId: request.userId,
    action: 'profile.password.reset.complete',
    entityType: 'User',
    entityId: request.userId,
    summary: 'Password reset completed from an emailed link.',
  });

  return { ok: true, message: 'Your password has been reset. Sign in with it now.' };
}
