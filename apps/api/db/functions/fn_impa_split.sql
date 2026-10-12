-- Canonical current body of fn_impa_split (deployed by migration 00113).
CREATE OR REPLACE FUNCTION public.fn_impa_split(p_name text, p_code text, p_move boolean DEFAULT true, OUT name text, OUT code text)
 RETURNS record
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_mark  constant text := chr(1);
  v_after constant text := '(?![0-9A-Za-z])(?![-/.][0-9A-Za-z])';
  v_found text[];
  v_text  text;
  v_line  text;
  v_lines text[] := '{}';
BEGIN
  name := p_name;
  code := fn_impa_code(p_code);
  IF p_name IS NULL THEN
    RETURN;
  END IF;
  -- Only a code marked IMPA moves: bare digits may be a model number.
  IF code IS NULL AND p_move THEN
    SELECT array_agg(DISTINCT m[1]) INTO v_found
      FROM regexp_matches(p_name, '\mIMPA\s*[:.#]?\s*([0-9]{6})' || v_after, 'gi') m;
    IF cardinality(v_found) = 1 THEN
      code := v_found[1];
    END IF;
  END IF;
  IF code IS NULL OR code !~ '^[0-9]{6}$' THEN
    RETURN;
  END IF;

  -- The own code, bracketed, marked or bare, never inside a longer token.
  v_text := regexp_replace(p_name, '\(\s*(IMPA\s*[:.#]?\s*)?' || code || '\s*\)', v_mark, 'gi');
  v_text := regexp_replace(v_text, '\mIMPA\s*[:.#]?\s*' || code || v_after, v_mark, 'gi');
  v_text := regexp_replace(v_text,
    '(?<![0-9A-Za-z])(?<![0-9A-Za-z][-/.])' || code || v_after, v_mark, 'g');
  IF strpos(v_text, v_mark) = 0 THEN
    RETURN;
  END IF;

  -- Only the lines that held the code are tidied.
  FOREACH v_line IN ARRAY string_to_array(v_text, E'\n') LOOP
    IF strpos(v_line, v_mark) > 0 THEN
      v_line := regexp_replace(v_line, '[ \t]*-[ \t]*' || v_mark || '[ \t]*-[ \t]*', ' - ', 'g');
      v_line := regexp_replace(v_line, '[ \t]*,[ \t]*' || v_mark || '[ \t]*,[ \t]*', ', ', 'g');
      v_line := regexp_replace(v_line, '[ \t]+-[ \t]+' || v_mark, v_mark, 'g');
      v_line := regexp_replace(v_line, v_mark || '[ \t]+-[ \t]+', v_mark, 'g');
      v_line := regexp_replace(v_line, '[ \t]*' || v_mark || '[ \t]*', ' ', 'g');
      v_line := regexp_replace(v_line, '[ \t]{2,}', ' ', 'g');
      v_line := regexp_replace(v_line, '^[ \t\r,:]+|[ \t\r,:]+$', '', 'g');
      CONTINUE WHEN v_line = '';
    END IF;
    v_lines := v_lines || v_line;
  END LOOP;
  v_text := array_to_string(v_lines, E'\n');
  -- A text that was only the code keeps it.
  IF btrim(v_text, E' \t\r\n') <> '' THEN
    name := v_text;
  END IF;
END;
$function$
