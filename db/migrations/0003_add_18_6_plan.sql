ALTER TABLE fast_plans DROP CONSTRAINT IF EXISTS fast_plans_plan_check;
ALTER TABLE fast_plans ADD CONSTRAINT fast_plans_plan_check
  CHECK (plan IN ('18:6', '16:8', '14:10', '12:12'));
