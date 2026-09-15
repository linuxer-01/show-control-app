REVOKE EXECUTE ON FUNCTION public.join_presentation(text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.renew_controller(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.release_controller(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.submit_slide_command(uuid,text) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.acknowledge_slide_command(uuid,bigint,integer) FROM PUBLIC, anon;