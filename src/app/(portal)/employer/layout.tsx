import { requireRole } from '@/lib/authz'

export default async function EmployerLayout({ children }: { children: React.ReactNode }) {
  await requireRole('EMPLOYER')
  return children
}
