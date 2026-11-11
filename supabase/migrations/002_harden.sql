-- Trigger functions must not be callable through the REST API.
revoke execute on function public.mac_profile_guard(), public.mac_tutor_guard(), public.mac_payment_guard(),
  public.mac_refresh_rating() from public, anon, authenticated;
