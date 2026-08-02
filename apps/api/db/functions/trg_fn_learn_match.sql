-- Canonical current body of trg_fn_learn_match (deployed by migration 00003).
CREATE OR REPLACE FUNCTION public.trg_fn_learn_match()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.requested_item_id IS NOT NULL
     AND NEW.requested_name IS NOT NULL
     AND TRIM(NEW.requested_name) != '' THEN

    INSERT INTO item_request_matches
      (request_text, matched_item_id, match_count, last_used_at)
    VALUES
      (NEW.requested_name, NEW.requested_item_id, 1, NOW())
    ON CONFLICT (LOWER(TRIM(request_text)))
    DO UPDATE SET
      match_count     = item_request_matches.match_count + 1,
      last_used_at    = NOW(),
      matched_item_id = EXCLUDED.matched_item_id;

  END IF;
  RETURN NEW;
END;
$function$
