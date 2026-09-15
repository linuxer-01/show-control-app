CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE public.presentations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 255),
  storage_path text NOT NULL UNIQUE,
  slide_count integer NOT NULL DEFAULT 1 CHECK (slide_count > 0 AND slide_count <= 500),
  status text NOT NULL DEFAULT 'ready' CHECK (status IN ('processing','ready','error')),
  access_code text NOT NULL UNIQUE CHECK (access_code ~ '^[A-Z0-9]{6}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.presentations TO authenticated;
GRANT ALL ON public.presentations TO service_role;
ALTER TABLE public.presentations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Owners read presentations" ON public.presentations FOR SELECT TO authenticated USING (owner_id = auth.uid());
CREATE POLICY "Owners create presentations" ON public.presentations FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners update presentations" ON public.presentations FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners delete presentations" ON public.presentations FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.presentation_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  presentation_id uuid NOT NULL UNIQUE REFERENCES public.presentations(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL,
  is_active boolean NOT NULL DEFAULT false,
  remote_enabled boolean NOT NULL DEFAULT false,
  current_slide integer NOT NULL DEFAULT 1 CHECK (current_slide > 0),
  controller_id uuid,
  controller_lease_until timestamptz,
  command_sequence bigint NOT NULL DEFAULT 0,
  pending_sequence bigint,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.presentation_sessions TO authenticated;
GRANT ALL ON public.presentation_sessions TO service_role;
ALTER TABLE public.presentation_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Session parties read" ON public.presentation_sessions FOR SELECT TO authenticated USING (owner_id = auth.uid() OR controller_id = auth.uid());
CREATE POLICY "Owners create sessions" ON public.presentation_sessions FOR INSERT TO authenticated WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners update sessions" ON public.presentation_sessions FOR UPDATE TO authenticated USING (owner_id = auth.uid()) WITH CHECK (owner_id = auth.uid());
CREATE POLICY "Owners delete sessions" ON public.presentation_sessions FOR DELETE TO authenticated USING (owner_id = auth.uid());

CREATE TABLE public.slide_commands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.presentation_sessions(id) ON DELETE CASCADE,
  controller_id uuid NOT NULL,
  sequence bigint NOT NULL,
  direction text NOT NULL CHECK (direction IN ('previous','next')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','acknowledged','rejected')),
  created_at timestamptz NOT NULL DEFAULT now(),
  acknowledged_at timestamptz,
  UNIQUE(session_id, sequence)
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.slide_commands TO authenticated;
GRANT ALL ON public.slide_commands TO service_role;
ALTER TABLE public.slide_commands ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Command parties read" ON public.slide_commands FOR SELECT TO authenticated USING (
  controller_id = auth.uid() OR EXISTS (SELECT 1 FROM public.presentation_sessions s WHERE s.id = session_id AND s.owner_id = auth.uid())
);

CREATE INDEX presentation_sessions_active_idx ON public.presentation_sessions (is_active) WHERE is_active;
CREATE INDEX slide_commands_session_status_idx ON public.slide_commands (session_id, status, sequence);

CREATE OR REPLACE FUNCTION public.touch_updated_at() RETURNS trigger LANGUAGE plpgsql SET search_path = public AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;
CREATE TRIGGER presentations_touch BEFORE UPDATE ON public.presentations FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER sessions_touch BEFORE UPDATE ON public.presentation_sessions FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

CREATE OR REPLACE FUNCTION public.join_presentation(_code text)
RETURNS TABLE(session_id uuid, presentation_name text, current_slide integer, slide_count integer, claimed boolean)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE v_session_id uuid; v_name text; v_current integer; v_count integer; v_controller uuid; v_lease timestamptz;
BEGIN
  SELECT ps.id, pr.name, ps.current_slide, pr.slide_count, ps.controller_id, ps.controller_lease_until
  INTO v_session_id, v_name, v_current, v_count, v_controller, v_lease
  FROM public.presentation_sessions ps JOIN public.presentations pr ON pr.id = ps.presentation_id
  WHERE pr.access_code = upper(trim(_code)) AND ps.is_active AND ps.remote_enabled FOR UPDATE OF ps;
  IF NOT FOUND THEN RAISE EXCEPTION 'Presentation code is not active'; END IF;
  IF v_controller IS NOT NULL AND v_lease > now() AND v_controller <> auth.uid() THEN
    RETURN QUERY SELECT v_session_id, v_name, v_current, v_count, false; RETURN;
  END IF;
  UPDATE public.presentation_sessions SET controller_id = auth.uid(), controller_lease_until = now() + interval '20 seconds' WHERE id = v_session_id;
  RETURN QUERY SELECT v_session_id, v_name, v_current, v_count, true;
END; $$;
GRANT EXECUTE ON FUNCTION public.join_presentation(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.renew_controller(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.presentation_sessions SET controller_lease_until = now() + interval '20 seconds'
  WHERE id = _session_id AND controller_id = auth.uid() AND is_active AND remote_enabled;
  RETURN FOUND;
END; $$;
GRANT EXECUTE ON FUNCTION public.renew_controller(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.release_controller(_session_id uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.presentation_sessions SET controller_id = null, controller_lease_until = null
  WHERE id = _session_id AND controller_id = auth.uid();
  RETURN FOUND;
END; $$;
GRANT EXECUTE ON FUNCTION public.release_controller(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.submit_slide_command(_session_id uuid, _direction text)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE s public.presentation_sessions%ROWTYPE; next_seq bigint;
BEGIN
  IF _direction NOT IN ('previous','next') THEN RAISE EXCEPTION 'Invalid direction'; END IF;
  SELECT * INTO s FROM public.presentation_sessions WHERE id = _session_id FOR UPDATE;
  IF NOT FOUND OR NOT s.is_active OR NOT s.remote_enabled OR s.controller_id <> auth.uid() OR s.controller_lease_until <= now() THEN RAISE EXCEPTION 'Controller session expired'; END IF;
  IF s.pending_sequence IS NOT NULL THEN RAISE EXCEPTION 'Previous command is still pending'; END IF;
  next_seq := s.command_sequence + 1;
  INSERT INTO public.slide_commands(session_id, controller_id, sequence, direction) VALUES (_session_id, auth.uid(), next_seq, _direction);
  UPDATE public.presentation_sessions SET command_sequence = next_seq, pending_sequence = next_seq, controller_lease_until = now() + interval '20 seconds' WHERE id = _session_id;
  RETURN next_seq;
END; $$;
GRANT EXECUTE ON FUNCTION public.submit_slide_command(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.acknowledge_slide_command(_session_id uuid, _sequence bigint, _current_slide integer)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE max_slides integer;
BEGIN
  SELECT p.slide_count INTO max_slides FROM public.presentation_sessions s JOIN public.presentations p ON p.id = s.presentation_id
  WHERE s.id = _session_id AND s.owner_id = auth.uid() FOR UPDATE OF s;
  IF NOT FOUND OR _current_slide < 1 OR _current_slide > max_slides THEN RETURN false; END IF;
  UPDATE public.slide_commands SET status = 'acknowledged', acknowledged_at = now()
  WHERE session_id = _session_id AND sequence = _sequence AND status = 'pending';
  UPDATE public.presentation_sessions SET current_slide = _current_slide, pending_sequence = null
  WHERE id = _session_id AND pending_sequence = _sequence;
  RETURN FOUND;
END; $$;
GRANT EXECUTE ON FUNCTION public.acknowledge_slide_command(uuid,bigint,integer) TO authenticated;

ALTER PUBLICATION supabase_realtime ADD TABLE public.presentation_sessions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.slide_commands;

CREATE POLICY "Owners upload presentation files" ON storage.objects FOR INSERT TO authenticated WITH CHECK (bucket_id = 'presentations' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Owners read presentation files" ON storage.objects FOR SELECT TO authenticated USING (bucket_id = 'presentations' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY "Owners delete presentation files" ON storage.objects FOR DELETE TO authenticated USING (bucket_id = 'presentations' AND (storage.foldername(name))[1] = auth.uid()::text);