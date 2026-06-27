create or replace function public.reset_competition_entry(
    target_slug text,
    target_participant_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
    competition_record competitions%rowtype;
    participant_record competition_participants%rowtype;
begin
    select *
    into competition_record
    from competitions
    where slug = target_slug
    limit 1;

    if not found then
        raise exception 'Competition not found.' using errcode = 'P0001';
    end if;

    select *
    into participant_record
    from competition_participants
    where id = target_participant_id
      and competition_id = competition_record.id
    limit 1;

    if not found then
        raise exception 'Participant not found.' using errcode = 'P0001';
    end if;

    delete from competition_participants
    where id = target_participant_id
      and competition_id = competition_record.id;

    return jsonb_build_object(
        'success', true,
        'participant_id', target_participant_id
    );
end;
$$;

grant execute on function public.reset_competition_entry(text, uuid) to service_role;
