-- .claude/specs/generic/claimant-more-info-resubmission.md — mirrors
-- denial_reason's shape for the moreInfo branch, which had no equivalent
-- column until now. Written by capture-review-decision's moreInfo branch;
-- never cleared on a later status change, same as denial_reason isn't.
ALTER TABLE claims ADD COLUMN info_requested_reason text;
