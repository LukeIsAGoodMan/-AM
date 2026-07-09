-- P15 (D21): explicit cap-accrual bucket identifier so multiple rules
-- materialized from one shared cap group (applies_to fan-out or card-level)
-- can share a bucket. mapRow() falls back to rule.slug when NULL.
ALTER TABLE "reward_rules" ADD COLUMN "cap_usage_key" text;
