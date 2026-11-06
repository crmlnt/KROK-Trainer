-- REVIEW ONLY: not applied to Supabase. Apply catalog seed after this migration.
begin;
create schema mistake_private;
revoke all on schema mistake_private from public, anon, authenticated;
create table mistake_private.catalog (
  krok smallint not null check (krok in (1,2)),
  question_id text not null check (question_id ~ '^main:([1-9][0-9]*|krok2-[0-9]{4,})$'),
  revision integer not null check (revision > 0),
  answer_count integer not null check (answer_count > 0),
  correct_index integer not null check (correct_index >= 0 and correct_index < answer_count),
  primary key (krok, question_id)
);
create table public.mistake_training_state (
  user_id uuid not null references auth.users(id) on delete cascade,
  krok smallint not null check (krok in (1,2)),
  primary key(user_id,krok)
);
create table public.mistake_training_sessions (
  user_id uuid not null,
  krok smallint not null,
  id uuid not null,
  question_ids text[] not null check (cardinality(question_ids) between 5 and 50),
  status text not null default 'active' check (status in ('active','completed')),
  started_at timestamptz not null default now(),
  finalized_at timestamptz,
  primary key(user_id,krok,id),
  foreign key(user_id,krok) references public.mistake_training_state on delete cascade
);
create unique index mistake_training_one_active on public.mistake_training_sessions(user_id,krok) where status='active';
create table public.mistake_training_progress (
  user_id uuid not null,
  krok smallint not null,
  question_id text not null,
  valid_sessions integer not null default 0 check (valid_sessions between 0 and 3),
  updated_at timestamptz not null default now(),
  primary key(user_id,krok,question_id),
  foreign key(user_id,krok) references public.mistake_training_state on delete cascade,
  foreign key(krok,question_id) references mistake_private.catalog
);
create table public.mistake_training_answers (
  user_id uuid not null,
  krok smallint not null,
  session_id uuid not null,
  question_id text not null,
  revision integer not null,
  answer_count integer not null,
  correct_index integer not null,
  selected_index integer,
  is_correct boolean,
  answered_at timestamptz,
  primary key(user_id,krok,session_id,question_id),
  foreign key(user_id,krok,session_id) references public.mistake_training_sessions(user_id,krok,id) on delete cascade,
  foreign key(krok,question_id) references mistake_private.catalog,
  check(selected_index is null or selected_index >= 0 and selected_index < answer_count)
);
-- Only RPCs write; answer keys and catalog are never readable by API roles.
alter table public.mistake_training_state enable row level security;
alter table public.mistake_training_sessions enable row level security;
alter table public.mistake_training_progress enable row level security;
alter table public.mistake_training_answers enable row level security;
revoke all on public.mistake_training_state, public.mistake_training_sessions,
 public.mistake_training_progress, public.mistake_training_answers from public, anon, authenticated;
create policy own_sessions on public.mistake_training_sessions for select to authenticated using(user_id = (select auth.uid()));
create policy own_progress on public.mistake_training_progress for select to authenticated using(user_id = (select auth.uid()));
grant select on public.mistake_training_sessions, public.mistake_training_progress to authenticated;

-- One lock per user/KROK serializes starts, answers and finalization in the same transaction.
create function public.mistake_training(p_action text, p_krok integer, p_session_id uuid,
 p_question_ids text[] default null, p_question_id text default null, p_selected_index integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 u uuid := auth.uid();
 s public.mistake_training_sessions%rowtype;
 answer_record public.mistake_training_answers%rowtype;
 result jsonb;
begin
 if u is null then raise exception 'authentication_required'; end if;
 if p_krok is null or p_krok not in (1,2) or p_session_id is null then raise exception 'invalid_context'; end if;
 if p_action is null or p_action not in ('start','resume','answer','finalize') then raise exception 'invalid_action'; end if;
 insert into public.mistake_training_state(user_id,krok) values(u,p_krok) on conflict do nothing;
 perform 1 from public.mistake_training_state where user_id=u and krok=p_krok for update;
 select * into s from public.mistake_training_sessions where user_id=u and krok=p_krok and id=p_session_id;
 if p_action='start' then
   if p_question_ids is null or cardinality(p_question_ids) not between 5 and 50
     or cardinality(p_question_ids) <> (select count(distinct x) from unnest(p_question_ids) x)
     or exists(select 1 from unnest(p_question_ids) x where not exists
       (select 1 from mistake_private.catalog c where c.krok=p_krok and c.question_id=x))
     then raise exception 'invalid_questions'; end if;
   if s.id is not null then
     if s.question_ids <> p_question_ids then raise exception 'idempotency_conflict'; end if;
   else
     if exists(select 1 from public.mistake_training_sessions where user_id=u and krok=p_krok and status='active') then
       raise exception 'active_session_exists'; end if;
     insert into public.mistake_training_sessions(user_id,krok,id,question_ids)
       values(u,p_krok,p_session_id,p_question_ids) returning * into s;
     insert into public.mistake_training_answers(user_id,krok,session_id,question_id,revision,answer_count,correct_index)
       select u,p_krok,p_session_id,c.question_id,c.revision,c.answer_count,c.correct_index
       from mistake_private.catalog c where c.krok=p_krok and c.question_id=any(p_question_ids);
     insert into public.mistake_training_progress(user_id,krok,question_id)
       select u,p_krok,unnest(p_question_ids) on conflict do nothing;
   end if;
 elsif s.id is null then raise exception 'session_not_found';
 end if;
 if p_action='answer' then
   select * into answer_record from public.mistake_training_answers
     where user_id=u and krok=p_krok and session_id=p_session_id and question_id=p_question_id;
   if answer_record.question_id is null or p_selected_index is null or p_selected_index < 0 or p_selected_index >= answer_record.answer_count then
     raise exception 'invalid_answer'; end if;
   if answer_record.selected_index is not null then
     if answer_record.selected_index <> p_selected_index then raise exception 'idempotency_conflict'; end if;
   else
     if s.status <> 'active' then raise exception 'session_closed'; end if;
     update public.mistake_training_answers set selected_index=p_selected_index,
       is_correct=(p_selected_index=correct_index), answered_at=now()
       where user_id=u and krok=p_krok and session_id=p_session_id and question_id=p_question_id;
     if p_selected_index <> answer_record.correct_index then
       update public.mistake_training_progress set valid_sessions=0, updated_at=now()
         where user_id=u and krok=p_krok and question_id=p_question_id;
     end if;
   end if;
 end if;
 if p_action='finalize' and s.status='active' then
   if exists(select 1 from public.mistake_training_answers where user_id=u and krok=p_krok and session_id=p_session_id and selected_index is null) then
     raise exception 'session_incomplete'; end if;
   update public.mistake_training_progress p set valid_sessions=least(3,p.valid_sessions+1), updated_at=now()
     from public.mistake_training_answers a
     where a.user_id=u and a.krok=p_krok and a.session_id=p_session_id and a.is_correct
       and p.user_id=a.user_id and p.krok=a.krok and p.question_id=a.question_id;
   update public.mistake_training_sessions set status='completed', finalized_at=now()
     where user_id=u and krok=p_krok and id=p_session_id returning * into s;
 end if;
 select coalesce(jsonb_agg(jsonb_build_object('questionId',a.question_id,'revision',a.revision,
   'selectedIndex',a.selected_index,'isCorrect',a.is_correct) order by array_position(s.question_ids,a.question_id)), '[]'::jsonb)
 into result from public.mistake_training_answers a where user_id=u and krok=p_krok and session_id=p_session_id;
 return jsonb_build_object('sessionId',s.id,'krok',s.krok,'status',s.status,'questionIds',s.question_ids,'answers',result);
end;
$$;
revoke all on function public.mistake_training(text,integer,uuid,text[],text,integer) from public, anon, authenticated;
grant execute on function public.mistake_training(text,integer,uuid,text[],text,integer) to authenticated;
commit;
