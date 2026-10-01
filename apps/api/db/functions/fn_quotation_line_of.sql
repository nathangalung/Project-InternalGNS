-- Canonical current body of fn_quotation_line_of (deployed by migration 00078).
CREATE OR REPLACE FUNCTION public.fn_quotation_line_of(p_quotation_id bigint, p_line_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM quotation_items
    WHERE id = p_line_id AND quotation_id = p_quotation_id AND item_type = 'product'
  ) THEN
    RAISE EXCEPTION 'Baris produk tidak ditemukan di quotation ini. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;
END;
$function$
