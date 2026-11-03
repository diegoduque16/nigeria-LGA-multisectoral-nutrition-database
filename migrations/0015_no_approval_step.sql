-- No approval step: a sent report counts straight away. Reports sent and still waiting are counted now.
UPDATE reports SET status = 'accepted', reviewed_by = submitted_by, reviewed_at = submitted_at WHERE status = 'submitted';
