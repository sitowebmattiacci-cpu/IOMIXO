-- IOMIXO — Seed Data
-- Run after schema.sql for a working local dev environment

-- Demo user: password is "Password123!" (bcrypt cost 12)
INSERT INTO users (id, email, password_hash, full_name, plan, credits_remaining)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'demo@iomixo.ai',
  '$2b$12$LQv3c1yqBWVHxkd0LHAkCOYz6TtxMlJbekRBw0BWNNtHNqrHxLBUu',
  'Demo User',
  'pro',
  20
) ON CONFLICT DO NOTHING;

-- Demo project
INSERT INTO projects (id, user_id, title)
VALUES (
  '00000000-0000-0000-0000-000000000010',
  '00000000-0000-0000-0000-000000000001',
  'My First Mashup'
) ON CONFLICT DO NOTHING;
