'use server'

import { redirect } from 'next/navigation'
import { AuthError } from 'next-auth'
import { signIn, signOut } from '@/lib/auth'
import { prisma } from '@/lib/db'
import {
  candidateSignupSchema,
  employerSignupSchema,
  loginSchema,
  parseFormData,
  restorableValues,
  verificationCodeSchema,
} from '@/lib/validation'
import { registerCandidate, registerEmployer } from '@/server/accounts'
import { verifyCredentials, type CheckedAccount } from '@/server/credentials'
import { waivedFor } from '@/lib/demo-waiver'
import { getPrincipal } from '@/lib/authz'
import { recordAudit } from '@/server/audit'
import { MailError } from '@/lib/mail/supabase'
import {
  clearVerificationTicket,
  currentVerificationTicket,
  issueVerificationCode,
  redeemVerificationCode,
  redeemVerificationLink,
  setVerificationTicket,
  type VerificationPurpose,
} from '@/server/verification'
import { createVerificationTicket } from '@/lib/verification-ticket'
import { errorState, type ActionState } from '@/lib/action-state'

const HOME_BY_ROLE = { CANDIDATE: '/candidate', EMPLOYER: '/employer', ADMIN: '/admin' } as const

/** Where a freshly verified account lands, by why it was verified. */
const FIRST_STOP_BY_ROLE = {
  CANDIDATE: '/candidate/onboarding',
  EMPLOYER: '/employer/profile',
  ADMIN: '/admin',
} as const

/**
 * A `next` parameter is only honoured when it points at the signed-in role's own
 * portal, which blocks open-redirect abuse through the login form.
 */
function safeTarget(next: FormDataEntryValue | null, role: keyof typeof HOME_BY_ROLE) {
  const base = HOME_BY_ROLE[role]
  const value = typeof next === 'string' ? next : ''
  if (!value.startsWith('/') || value.startsWith('//')) return base
  return value.startsWith(base) ? value : base
}

function minutesFromSeconds(seconds: number) {
  const whole = Math.max(1, Math.ceil(seconds / 60))
  return whole === 1 ? '1 minute' : `${whole} minutes`
}

/** The address is never repeated back: on a shared screen it would be exposed. */
function deliveryProblem(error: MailError) {
  if (error.reason === 'not-configured') {
    return 'Email verification is unavailable because the server’s Supabase connection is not configured. Your account has not been signed in.'
  }
  if (error.reason === 'function-not-deployed') {
    return 'Email verification is unavailable because the Supabase send-email function is not deployed. No code was sent and you have not been signed in.'
  }
  if (error.reason === 'provider-not-configured') {
    return 'The Supabase email function needs a verified sender and a mail provider before it can send your code. You have not been signed in.'
  }
  if (error.reason === 'rejected-credential') {
    return 'The email service refused this server’s credentials. Please contact support; no code was sent.'
  }
  if (error.reason === 'unverified-sender') {
    return 'The sender address this server mails from is not approved by the mail provider, so no code can be sent. An administrator needs to fix that.'
  }
  if (error.reason === 'rate-limited') {
    return 'The mail service is throttling this server. Try again shortly.'
  }
  return 'The email service could not send your code. Please try again shortly; you have not been signed in.'
}

/**
 * The step both flows share once an account is known-good: issue a code and send
 * the browser to the one screen that can turn it into a session. Nothing here
 * opens a session — `src/lib/auth.ts` does, and only for a redeemed code paired
 * with the ticket written here.
 */
async function sendCodeAndContinue(
  user: CheckedAccount,
  purpose: VerificationPurpose,
  next?: FormDataEntryValue | null,
): Promise<ActionState> {
  let issued: Awaited<ReturnType<typeof issueVerificationCode>>
  try {
    issued = await issueVerificationCode({
      userId: user.id,
      email: user.email,
      name: user.name,
      purpose,
      actor: null,
    })
  } catch (error) {
    if (error instanceof MailError) {
      return errorState(deliveryProblem(error), {}, { name: user.name, email: user.email })
    }
    throw error
  }

  // A refused resend can still name a code that is live, so the wait is only
  // worth reporting when there is nothing to take the person onward with.
  const busy =
    issued.status === 'limited'
      ? `Too many codes have been requested for this account recently. Another can go out in ${minutesFromSeconds(issued.retryAfterSeconds)}.`
      : issued.status === 'cooldown'
        ? `A code was sent moments ago. Use it, or ask for another in ${issued.retryAfterSeconds} seconds.`
        : null
  if (!issued.verificationId) {
    return errorState(busy ?? 'No code could be sent right now. Try again shortly.', {}, { name: user.name, email: user.email })
  }

  await setVerificationTicket({ userId: user.id, purpose, verificationId: issued.verificationId })

  const query =
    typeof next === 'string' && next.startsWith('/') && !next.startsWith('//')
      ? `?next=${encodeURIComponent(next)}`
      : ''
  redirect(`/verify-email${query}`)
}

/**
 * The demonstration shortcut, available only where `waivedFor` says so. It goes
 * through a provider that re-reads the password and re-applies the same rule, so
 * this call is a request, not an entitlement.
 */
async function signInWithPasswordOnly(email: string, password: string) {
  try {
    await signIn('demo-password', { email, password, redirect: false })
    return true
  } catch (error) {
    if (error instanceof AuthError) return false
    throw error
  }
}

/**
 * A brand-new account either confirms its address or, on a server that waived
 * codes for demonstration addresses, opens straight away. The waiver is decided
 * by the same rule as at sign-in, and the audit entry says which path was taken.
 */
async function openNewAccount(user: CheckedAccount, password: string): Promise<ActionState> {
  if (!waivedFor(user.email)) return sendCodeAndContinue(user, 'SIGNUP')

  if (!(await signInWithPasswordOnly(user.email, password))) {
    return errorState('Account created, but it could not be opened. Sign in now.', {}, { name: user.name, email: user.email })
  }
  await recordAudit({
    actor: null,
    action: 'auth.login',
    entityType: 'users',
    entityId: user.id,
    targetUserId: user.id,
    metadata: { role: user.role, via: 'signup', codeStep: 'waived-for-demonstration' },
  })
  redirect(FIRST_STOP_BY_ROLE[user.role])
}

export async function loginAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseFormData(formData, loginSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  const outcome = await verifyCredentials(parsed.data.email, parsed.data.password)

  // One message for an unknown address and a wrong password: no account enumeration.
  if (outcome.status === 'invalid') {
    return errorState('Email or password is incorrect. Five failed attempts lock the account for 15 minutes.', {}, restorableValues(formData))
  }
  if (outcome.status === 'locked') {
    return errorState(
      `This account is temporarily locked after repeated failed sign-ins. Try again in ${minutesFromSeconds(outcome.retryAfterMinutes * 60)}.`,
      {},
      restorableValues(formData),
    )
  }
  if (outcome.status === 'inactive') {
    return errorState(
      `This account is ${outcome.accountStatus.toLowerCase().replace('_', ' ')}. Contact an administrator.`,
      {},
      restorableValues(formData),
    )
  }

  if (waivedFor(outcome.user.email)) {
    if (!(await signInWithPasswordOnly(outcome.user.email, parsed.data.password))) {
      return errorState('Sign-in did not complete. Try again.', {}, restorableValues(formData))
    }
    await recordAudit({
      actor: null,
      action: 'auth.login',
      entityType: 'users',
      entityId: outcome.user.id,
      targetUserId: outcome.user.id,
      metadata: { role: outcome.user.role, codeStep: 'waived-for-demonstration' },
    })
    redirect(safeTarget(formData.get('next'), outcome.user.role))
  }

  await recordAudit({
    actor: null,
    action: 'auth.login_password_ok',
    entityType: 'users',
    entityId: outcome.user.id,
    targetUserId: outcome.user.id,
    metadata: { role: outcome.user.role, continuesWith: 'email_code' },
  })

  return sendCodeAndContinue(outcome.user, 'LOGIN', formData.get('next'))
}

export async function registerCandidateAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseFormData(formData, candidateSignupSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  let user: CheckedAccount
  try {
    const created = await registerCandidate(parsed.data)
    user = { id: created.id, email: created.email, name: created.name, role: created.role }
  } catch (error) {
    return errorState(error instanceof Error ? error.message : 'Registration failed.', {}, restorableValues(formData))
  }

  return openNewAccount(user, parsed.data.password)
}

export async function registerEmployerAction(prevState: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = parseFormData(formData, employerSignupSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  let user: CheckedAccount
  try {
    const created = await registerEmployer(parsed.data)
    user = { id: created.user.id, email: created.user.email, name: created.user.name, role: created.user.role }
  } catch (error) {
    return errorState(error instanceof Error ? error.message : 'Registration failed.', {}, restorableValues(formData))
  }

  return openNewAccount(user, parsed.data.password)
}

export async function submitVerificationCodeAction(
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = parseFormData(formData, verificationCodeSchema)
  if (!parsed.ok) return errorState(parsed.error, parsed.fieldErrors, parsed.values)

  const ticket = await currentVerificationTicket()
  if (!ticket) return errorState('This code request has expired. Sign in again to start a new one.')

  const result = await redeemVerificationCode({
    userId: ticket.userId,
    purpose: ticket.purpose,
    verificationId: ticket.verificationId,
    code: parsed.data.code,
  })

  if (result.status !== 'verified') {
    const message =
      result.status === 'invalid'
        ? `That code is not right. ${result.remainingAttempts} attempt${result.remainingAttempts === 1 ? '' : 's'} left before it stops working.`
        : result.status === 'expired'
          ? 'That code has expired. Ask for a new one to continue.'
          : result.status === 'exhausted'
            ? 'Too many attempts with that code. Ask for a new one to continue.'
            : 'That code is no longer valid. Ask for a new one to continue.'
    return errorState(message)
  }

  const account = await prisma.user.findUnique({
    where: { id: ticket.userId },
    select: { id: true, email: true, name: true, role: true, status: true },
  })
  if (!account || account.status !== 'ACTIVE') {
    await clearVerificationTicket()
    return errorState('This account is not active. Contact an administrator.')
  }

  try {
    // The provider re-reads the redeemed row behind this ticket, so a ticket that
    // was never paired with a correct code opens nothing.
    await signIn('email-code', { ticket: ticket.raw, redirect: false })
  } catch (error) {
    await clearVerificationTicket()
    if (error instanceof AuthError) {
      return errorState('The code was correct, but the session could not be opened. Sign in again.')
    }
    throw error
  }
  await clearVerificationTicket()

  redirect(
    ticket.purpose === 'SIGNUP'
      ? FIRST_STOP_BY_ROLE[account.role]
      : safeTarget(formData.get('next'), account.role),
  )
}

/** Ask for another code. The cooldown and the hourly cap are enforced where they live. */
export async function resendVerificationCodeAction(): Promise<ActionState> {
  const ticket = await currentVerificationTicket()
  if (!ticket) return errorState('This code request has expired. Sign in again to start a new one.')

  const account = await prisma.user.findUnique({
    where: { id: ticket.userId },
    select: { id: true, email: true, name: true, role: true, status: true },
  })
  if (!account || account.status !== 'ACTIVE') return errorState('This account is not active.')

  return sendCodeAndContinue(
    { id: account.id, email: account.email, name: account.name, role: account.role },
    ticket.purpose,
  )
}

/**
 * The clickable link in the verification mail, spent here. The link opens a
 * screen that posts this action, so a GET never changes anything, and the grant
 * it carries is redeemed through the same door the typed code uses: a ticket
 * naming the row that was just stamped, exchanged for one session.
 */
export async function confirmVerificationLinkAction(
  prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const token = typeof formData.get('token') === 'string' ? (formData.get('token') as string) : ''
  if (!token) return errorState('That link is incomplete. Sign in again to get a new one.')

  const result = await redeemVerificationLink({ token })
  if (result.status !== 'verified') {
    return errorState(
      result.reason === 'expired'
        ? 'That link has expired — they last ten minutes. Sign in again for a new one.'
        : result.reason === 'spent'
          ? 'That link has already been used. Sign in again for a new one.'
          : 'That link is not one this server issued. Sign in again to start over.',
    )
  }

  const account = await prisma.user.findUnique({
    where: { id: result.userId },
    select: { id: true, email: true, name: true, role: true, status: true },
  })
  if (!account || account.status !== 'ACTIVE') {
    return errorState('This account is not active. Contact an administrator.')
  }

  try {
    await signIn('email-code', {
      ticket: createVerificationTicket({
        userId: account.id,
        purpose: result.purpose,
        verificationId: result.verificationId,
      }),
      redirect: false,
    })
  } catch (error) {
    if (error instanceof AuthError) {
      return errorState('The link was correct, but the session could not be opened. Sign in again.')
    }
    throw error
  }

  redirect(
    result.purpose === 'SIGNUP'
      ? FIRST_STOP_BY_ROLE[account.role]
      : safeTarget(formData.get('next'), account.role),
  )
}

/** Abandon a code request: drops the ticket and any partial session. */
export async function cancelVerificationAction(): Promise<void> {
  await clearVerificationTicket()
  await signOut({ redirect: false })
  redirect('/login')
}

export async function logoutAction() {
  // Resolved before sign-out clears the session, so the audit entry keeps its actor.
  const principal = await getPrincipal()
  await signOut({ redirect: false })
  await recordAudit({
    actor: principal,
    action: 'auth.logout',
    entityType: 'users',
    entityId: principal?.userId ?? null,
    targetUserId: principal?.userId ?? null,
  })
  redirect('/')
}
