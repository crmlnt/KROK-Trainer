-- APPLIED on Supabase, confirmed by project owner on 2026-11-06. Do not rerun.
-- Requires both Tappa 1 migrations; retained for versioning and fresh environments.
begin;
create table mistake_private.practice_events (
 user_id uuid not null references auth.users(id) on delete cascade,
 event_id uuid not null,
 krok smallint not null,
 question_id text not null,
 created_at timestamptz not null default now(),
 primary key(user_id,event_id),
 foreign key(krok,question_id) references mistake_private.catalog
);
revoke all on mistake_private.practice_events from public, anon, authenticated;
create function public.mistake_training_record_practice(
 p_user_id uuid, p_event_id uuid, p_krok integer, p_question_id text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
 u uuid := auth.uid();
 previous mistake_private.practice_events%rowtype;
begin
 if u is null or p_user_id is distinct from u then raise exception 'authentication_required'; end if;
 if p_event_id is null or p_krok is null or p_krok not in (1,2) or p_question_id is null
   or not exists(select 1 from mistake_private.catalog where krok=p_krok and question_id=p_question_id)
   then raise exception 'invalid_question'; end if;
 insert into public.mistake_training_state(user_id,krok) values(u,p_krok) on conflict do nothing;
 perform 1 from public.mistake_training_state where user_id=u and krok=p_krok for update;
 insert into mistake_private.practice_events(user_id,event_id,krok,question_id)
   values(u,p_event_id,p_krok,p_question_id) on conflict do nothing;
 if not found then
   select * into previous from mistake_private.practice_events where user_id=u and event_id=p_event_id;
   if previous.krok <> p_krok or previous.question_id <> p_question_id then raise exception 'idempotency_conflict'; end if;
   return jsonb_build_object('recorded',true,'duplicate',true);
 end if;
 insert into public.mistake_training_progress(user_id,krok,question_id,valid_sessions)
   values(u,p_krok,p_question_id,0)
   on conflict(user_id,krok,question_id) do update set valid_sessions=0,updated_at=now();
 return jsonb_build_object('recorded',true,'duplicate',false);
end;
$$;
revoke all on function public.mistake_training_record_practice(uuid,uuid,integer,text) from public,anon,authenticated;
grant execute on function public.mistake_training_record_practice(uuid,uuid,integer,text) to authenticated;
commit;
