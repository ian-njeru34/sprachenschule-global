-- Registrar-managed public blog posts for Sprachenschule.
create table if not exists public.blog_posts (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  title text not null,
  excerpt text not null default '',
  content text not null default '',
  category text not null default 'Language learning',
  image_url text,
  read_time integer not null default 4 check (read_time between 1 and 60),
  published boolean not null default false,
  author_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists blog_posts_publication_idx on public.blog_posts(published, created_at desc);
alter table public.blog_posts enable row level security;
drop policy if exists "Public can read published blog posts" on public.blog_posts;
create policy "Public can read published blog posts" on public.blog_posts
  for select to anon, authenticated using (published = true);
drop policy if exists "Registrars manage blog posts" on public.blog_posts;
create policy "Registrars manage blog posts" on public.blog_posts
  for all to authenticated
  using (exists (select 1 from public.registrars r where r.user_id = auth.uid())
         or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'))
  with check (exists (select 1 from public.registrars r where r.user_id = auth.uid())
         or exists (select 1 from public.profiles p where p.id = auth.uid() and p.role = 'admin'));
grant select on public.blog_posts to anon, authenticated;
grant insert, update, delete on public.blog_posts to authenticated;

-- Seed the five articles previously displayed as static cards so they remain editable.
insert into public.blog_posts (slug,title,excerpt,content,category,image_url,read_time,published)
values
('how-to-start-learning-german','How to start learning German: a beginner’s guide','Build a strong foundation with realistic goals, useful daily practice and a clear understanding of the A1 level.','Start with a clear goal. If you are new to German, A1 is a useful starting point: you learn greetings, introductions, everyday phrases and simple questions.

Practise a little every day. Ten to twenty minutes of focused listening, vocabulary review and speaking aloud is more useful than one long session that is hard to repeat.

Build the four skills together: listening, reading, writing and speaking. Keep a small notebook of phrases you can use in real situations, and revisit them regularly.

Choose materials that match your level and ask for guidance when you are ready to move forward.','German','https://images.unsplash.com/photo-1456513080510-7bf3a84b82f8?auto=format&fit=crop&w=1200&q=85',6,true),
('five-ways-to-remember-vocabulary','Five simple ways to remember new vocabulary','Use short review sessions, meaningful examples and active recall to make new words easier to remember.','Learn words in phrases, not only as isolated translations. A short example sentence helps you remember how a word is used.

Use spaced repetition: review new vocabulary after a short interval, then again over the following days.

Test yourself before looking at the answer. Active recall strengthens memory more than simply rereading a list.

Group related words by topic, such as shopping, travel or study, and say each phrase aloud.

Finally, use new words in a message, short paragraph or conversation as soon as you can.','Study tips','https://images.unsplash.com/photo-1434030216411-0b793f4b4173?auto=format&fit=crop&w=900&q=85',4,true),
('preparing-for-a-german-exam','Preparing for a German exam: practise all four skills','Learn how listening, reading, writing and speaking fit together in a balanced preparation routine.','A balanced study plan includes Hören (listening), Lesen (reading), Schreiben (writing) and Sprechen (speaking). Give each skill regular attention instead of practising only the parts you enjoy most.

Use level-appropriate sample tasks and practise with a timer once you understand the format. After each attempt, note the mistakes you can learn from.

For speaking, practise introductions, everyday questions and short responses aloud. For writing, focus on clear sentences and the task instructions.

In the final days, review familiar material, sleep well and prepare what you need for the exam.','Exam preparation','https://images.unsplash.com/photo-1516321318423-f06f85e504b3?auto=format&fit=crop&w=900&q=85',5,true),
('build-speaking-confidence','How to feel more confident when speaking a new language','Small, repeatable conversations can help you get comfortable speaking before you feel completely ready.','Confidence grows through manageable practice. Begin with short exchanges such as greeting someone, introducing yourself or asking a simple question.

Prepare a few useful sentence starters, but avoid memorising every response. Listening carefully and asking for repetition are valuable communication skills.

Treat mistakes as information, not failure. Notice one thing to improve after each conversation and try it next time.

Practise with a partner or tutor regularly so speaking becomes a normal part of learning.','Culture','https://images.unsplash.com/photo-1521737711867-e3b97375f902?auto=format&fit=crop&w=900&q=85',4,true),
('language-learning-through-culture','Language is more than words: learning through culture','Explore how everyday expressions, listening and cultural context can deepen your understanding.','Culture helps explain why people choose particular words, greetings and levels of formality. Paying attention to context makes communication more natural.

Notice how people greet each other, take turns in conversation and make polite requests. These patterns can differ between languages and situations.

Use songs, short videos, stories and everyday examples to connect language with real life. When something is unfamiliar, ask questions rather than assuming every culture follows the same rules.

Language and culture support each other: each new expression can also teach you something about how people connect.','Culture','https://images.unsplash.com/photo-1467269204594-9661b134dd2b?auto=format&fit=crop&w=900&q=85',5,true)
on conflict (slug) do nothing;
