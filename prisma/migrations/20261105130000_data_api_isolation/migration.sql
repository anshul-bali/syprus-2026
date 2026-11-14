-- The application reaches PostgreSQL only through Prisma as the owner role.
-- On a managed host (for example Supabase) the anonymous and authenticated Data
-- API roles must not hold table privileges: RLS without policies denies rows but
-- still leaves the relations reachable. These statements remove that surface,
-- and are skipped where the roles do not exist (plain local PostgreSQL).
DO $$
DECLARE
  role_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon', 'authenticated']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = role_name) THEN
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM %I', role_name);
      EXECUTE format('REVOKE ALL ON SCHEMA public FROM %I', role_name);
      EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM %I', role_name);
    END IF;
  END LOOP;
END $$;
