-- Initial rollout (requested 2 Nov 2026): Bauchi, Jigawa and Zamfara active; all other states off.
-- Change it later on the Org units page (Rollout panel); this runs only once.
UPDATE org_units SET inactive = CASE WHEN id IN ('ziJ3yxfgb3m', 'MJVVi73YayJ', 'FmH4buccgqx') THEN 0 ELSE 1 END WHERE level = 2;
INSERT INTO audit (id, user_id, action, ref_type, ref_id, detail, ip, created_at)
  SELECT 'au_rollout_initial', NULL, 'rollout_changed', NULL, NULL, '{"active":["Bauchi","Jigawa","Zamfara"],"note":"initial rollout"}', NULL, CAST(strftime('%s','now') AS INTEGER) * 1000
  WHERE EXISTS (SELECT 1 FROM org_units WHERE level = 2);
