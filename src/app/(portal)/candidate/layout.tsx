import { requireRole } from '@/lib/authz'

export default async function CandidateLayout({ children }: { children: React.ReactNode }) {
  await requireRole('CANDIDATE')
  return children
}
