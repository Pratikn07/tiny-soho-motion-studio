-- Media preparation occurs before any provider submission and can safely retry.
CREATE INDEX IF NOT EXISTS jobs_status_created_at ON jobs(status, created_at);
