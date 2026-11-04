-- Facebook publishing metadata for registrar-managed blog posts.
alter table public.blog_posts
  add column if not exists facebook_post_id text,
  add column if not exists facebook_post_status text,
  add column if not exists facebook_posted_at timestamptz,
  add column if not exists facebook_post_error text;

create index if not exists blog_posts_facebook_status_idx
  on public.blog_posts (facebook_post_status);

comment on column public.blog_posts.facebook_post_id is
  'Facebook Page post ID returned by Meta; prevents duplicate automatic publishing.';
comment on column public.blog_posts.facebook_post_status is
  'Facebook publishing state: publishing, posted, or failed.';
