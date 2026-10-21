-- Client request: multiple completion photos per container, not just one.
-- ready_photo_url (a single text column, added in 20261010090000) becomes
-- ready_photo_urls (text[]) -- a container already marked ready keeps its
-- one existing photo, now as a one-item array, nothing lost.
alter table public.containers add column ready_photo_urls text[] not null default '{}';
update public.containers set ready_photo_urls = array[ready_photo_url] where ready_photo_url is not null;
alter table public.containers drop column ready_photo_url;
