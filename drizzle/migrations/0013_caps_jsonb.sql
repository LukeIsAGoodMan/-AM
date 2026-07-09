-- P17 (D23): collapse the 5 flat cap_* columns into a single jsonb array
-- so a rule can carry multiple concurrent caps (category-specific +
-- card-level, per real HK T&C shapes like Amex Explorer / HSBC Premier).
-- Migration is atomic: add caps → backfill existing single-cap rules into
-- caps[0] → drop the old flat columns.

ALTER TABLE "reward_rules" ADD COLUMN "caps" jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE "reward_rules"
SET "caps" = jsonb_build_array(
  jsonb_strip_nulls(jsonb_build_object(
    'usageKey', COALESCE("cap_usage_key", "slug"),
    'basis', "cap_basis",
    'period', COALESCE("cap_period", 'transaction'),
    'amountHkd', "cap_amount_hkd",
    'rewardAmount', "cap_reward_amount"
  ))
)
WHERE "cap_basis" IS NOT NULL;

ALTER TABLE "reward_rules" DROP COLUMN "cap_amount_hkd";
ALTER TABLE "reward_rules" DROP COLUMN "cap_reward_amount";
ALTER TABLE "reward_rules" DROP COLUMN "cap_period";
ALTER TABLE "reward_rules" DROP COLUMN "cap_basis";
ALTER TABLE "reward_rules" DROP COLUMN "cap_usage_key";
