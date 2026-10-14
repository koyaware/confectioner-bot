-- Job claim status for multi-worker safety (tech.md v1.39).
-- SQLite materializes text enums without CHECK constraints, so widening
-- jobs.status ('pending' -> + 'running') needs no DDL; the contract lives
-- in src/db/schema.ts and src/jobs/scheduler.ts (atomic claim + lease).
SELECT 1;
