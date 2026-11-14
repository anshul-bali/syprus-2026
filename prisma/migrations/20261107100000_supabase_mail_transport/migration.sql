-- Mail leaves through a Supabase Edge Function now, not through SendGrid.
--
-- The transport column records how a code actually left the server, and the
-- entry screen reads it to decide whether a code may be shown on screen: a value
-- that was mailed must never be printed for anyone to see. A label that names a
-- provider nobody uses would make that reading wrong, so the label follows the
-- code. Rename only — no column, no row and no index changes, and no value is
-- added or dropped, so nothing can be lost.
--
-- Measured before writing this: in both clusters, zero rows carried this label
-- with an unexpired code, an unredeemed code, or a code that was ever shown on
-- screen, so no in-flight sign-in is affected by the relabelling.

ALTER TYPE "VerificationTransport" RENAME VALUE 'SENDGRID' TO 'SUPABASE';
