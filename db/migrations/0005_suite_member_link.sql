-- Suite identity (Home Base Feature-10): the household member each Fast to Eat member is, in tailnet mode.
-- A parent links them once on the link page. Unique: one household member is one Fast to Eat member.

ALTER TABLE family_members ADD COLUMN IF NOT EXISTS suite_member_id TEXT UNIQUE;
