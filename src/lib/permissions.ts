/**
 * Authority catalogue for SYPRUS.
 *
 * Every guarded screen and server action names a permission key from this file.
 * The same catalogue is written into the `roles` / `role_permissions` tables by
 * the seed script, so the database and the code describe one set of rules.
 */

export type RoleName = 'CANDIDATE' | 'EMPLOYER' | 'ADMIN'

export type PermissionId =
  // Candidate
  | 'candidate.profile.read'
  | 'candidate.profile.update'
  | 'candidate.experience.manage'
  | 'candidate.skills.manage'
  | 'candidate.skills.read'
  | 'candidate.graph.read'
  | 'candidate.gap.read'
  | 'candidate.gap.generate'
  | 'candidate.plan.read'
  | 'candidate.plan.update'
  | 'candidate.match.read'
  | 'candidate.application.create'
  | 'candidate.application.read'
  | 'candidate.application.withdraw'
  | 'candidate.consent.manage'
  | 'candidate.conversation.manage'
  | 'candidate.notification.read'
  | 'candidate.notification.update'
  // Employer
  | 'employer.org.read'
  | 'employer.org.update'
  | 'employer.job.create'
  | 'employer.job.read'
  | 'employer.job.update'
  | 'employer.job.close'
  | 'employer.candidate.anonymous.read'
  | 'employer.candidate.identity.read'
  | 'employer.match.read'
  | 'employer.shortlist.manage'
  | 'employer.application.read'
  | 'employer.application.update'
  | 'employer.invitation.send'
  // Admin
  | 'admin.dashboard.read'
  | 'admin.user.read'
  | 'admin.user.update'
  | 'admin.org.read'
  | 'admin.org.verify'
  | 'admin.job.read'
  | 'admin.job.moderate'
  | 'admin.engine.read'
  | 'admin.fairness.read'
  | 'admin.audit.read'
  | 'admin.reporting.read'

export type PermissionDefinition = {
  id: PermissionId
  label: string
  description: string
}

const define = (id: PermissionId, label: string, description: string): PermissionDefinition => ({
  id,
  label,
  description,
})

export const CANDIDATE_PERMISSIONS: PermissionDefinition[] = [
  define('candidate.profile.read', 'Read own profile', 'View the candidate profile and dashboard.'),
  define('candidate.profile.update', 'Edit own profile', 'Change personal, location and preference fields.'),
  define('candidate.experience.manage', 'Manage experience', 'Add or remove work, caregiving and other experience entries.'),
  define('candidate.skills.read', 'Read own skills', 'View the skills inventory and capability graph.'),
  define('candidate.skills.manage', 'Edit own skills', 'Add, adjust or remove skills and evidence.'),
  define('candidate.graph.read', 'Read capability graph', 'View the interactive capability graph.'),
  define('candidate.gap.read', 'Read gap reports', 'View stored skill gap reports.'),
  define('candidate.gap.generate', 'Generate gap report', 'Run the gap analysis engine against a target role.'),
  define('candidate.plan.read', 'Read learning plans', 'View personalised learning pathways.'),
  define('candidate.plan.update', 'Update learning plan', 'Mark plan items in progress or complete.'),
  define('candidate.match.read', 'Read own matches', 'View match scores explaining job recommendations.'),
  define('candidate.application.create', 'Apply to jobs', 'Submit an application to a published role.'),
  define('candidate.application.read', 'Read own applications', 'Track the applications pipeline.'),
  define('candidate.application.withdraw', 'Withdraw application', 'Withdraw a submitted application.'),
  define('candidate.consent.manage', 'Manage consent', 'Grant or withdraw privacy consents.'),
  define('candidate.conversation.manage', 'Run onboarding chat', 'Create and answer onboarding conversations.'),
  define('candidate.notification.read', 'Read notifications', 'View own notifications.'),
  define('candidate.notification.update', 'Dismiss notifications', 'Mark own notifications as read.'),
]

export const EMPLOYER_PERMISSIONS: PermissionDefinition[] = [
  define('employer.org.read', 'Read organisation', 'View own organisation profile.'),
  define('employer.org.update', 'Edit organisation', 'Change own organisation profile.'),
  define('employer.job.create', 'Create job', 'Draft a new role for the own organisation.'),
  define('employer.job.read', 'Read own jobs', 'View all roles belonging to the own organisation.'),
  define('employer.job.update', 'Edit own job', 'Change role details and required skills.'),
  define('employer.job.close', 'Close or reopen job', 'Move a role to closed or published.'),
  define('employer.candidate.anonymous.read', 'Read anonymised profiles', 'Review capability profiles without identity fields.'),
  define('employer.candidate.identity.read', 'Read identified applicants', 'View identity of candidates who applied to own roles.'),
  define('employer.match.read', 'Read match scores', 'View explainable match breakdowns for own roles.'),
  define('employer.shortlist.manage', 'Manage shortlist', 'Add or remove candidates from the shortlist.'),
  define('employer.application.read', 'Read own applications', 'View applications to own roles.'),
  define('employer.application.update', 'Update application status', 'Advance pipeline stage for own roles.'),
  define('employer.invitation.send', 'Send interview invitation', 'Invite a shortlisted candidate to interview.'),
]

export const ADMIN_PERMISSIONS: PermissionDefinition[] = [
  define('admin.dashboard.read', 'Read admin dashboard', 'View platform overview metrics.'),
  define('admin.user.read', 'Read users', 'Search and inspect platform accounts.'),
  define('admin.user.update', 'Manage users', 'Suspend, reactivate or deactivate accounts.'),
  define('admin.org.read', 'Read organisations', 'Inspect employer accounts.'),
  define('admin.org.verify', 'Verify organisation', 'Approve or reject employer verification.'),
  define('admin.job.read', 'Read jobs', 'Inspect all roles on the platform.'),
  define('admin.job.moderate', 'Moderate job', 'Publish, reject or close any role listing.'),
  define('admin.engine.read', 'Read engine health', 'Inspect rule engine run history and failures.'),
  define('admin.fairness.read', 'Read fairness monitoring', 'View match distribution and screening-fairness indicators.'),
  define('admin.audit.read', 'Read audit history', 'Inspect the audit log.'),
  define('admin.reporting.read', 'Read reporting dashboard', 'View aggregate platform reporting.'),
]

export const ROLE_PERMISSIONS: Record<RoleName, PermissionDefinition[]> = {
  CANDIDATE: CANDIDATE_PERMISSIONS,
  EMPLOYER: EMPLOYER_PERMISSIONS,
  ADMIN: ADMIN_PERMISSIONS,
}

export const ALL_PERMISSIONS: PermissionDefinition[] = [
  ...CANDIDATE_PERMISSIONS,
  ...EMPLOYER_PERMISSIONS,
  ...ADMIN_PERMISSIONS,
]

const PERMISSION_LABELS = new Map<string, string>(ALL_PERMISSIONS.map((p) => [p.id, p.label]))

export function permissionLabel(id: string) {
  return PERMISSION_LABELS.get(id) ?? id.replace(/[._-]/g, ' ')
}

export function permissionsFor(role: RoleName): PermissionId[] {
  return (ROLE_PERMISSIONS[role] ?? []).map((permission) => permission.id)
}
