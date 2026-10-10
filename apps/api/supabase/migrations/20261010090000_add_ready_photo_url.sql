-- Client request: a container can't be marked "Ready to move" without a
-- completion photo, even once every task is done. The photo URL (uploaded
-- the same way Gate-In/Gate-Out photos are, via the existing Drive upload
-- endpoint) and ready_at are now set together in one PATCH.
alter table public.containers add column ready_photo_url text;
