-- Canonical current body of fn_recompute_quotation_totals (deployed by migration 00086).
CREATE OR REPLACE FUNCTION public.fn_recompute_quotation_totals(p_quotation_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_pct          NUMERIC(5,2);
  v_line         RECORD;
  v_net          NUMERIC(15,2);
  v_total_produk NUMERIC(15,2) := 0;
  v_total        NUMERIC(15,2) := 0;
  v_total_disc   NUMERIC(15,2) := 0;
  v_dpp          NUMERIC(15,2) := 0;
  v_ppn          NUMERIC(15,2) := 0;
BEGIN
  SELECT discount_pct INTO v_pct FROM quotations WHERE id = p_quotation_id;
  -- Same accumulation as fn_create_quotation, so the header matches it.
  FOR v_line IN
    SELECT item_type, qty, selling_price FROM quotation_items
    WHERE quotation_id = p_quotation_id ORDER BY line_number
  LOOP
    IF v_line.item_type = 'product' THEN
      v_net          := ROUND(v_line.qty * v_line.selling_price * (1 - v_pct / 100), 2);
      v_total        := v_total + (v_line.qty * v_line.selling_price);
      v_total_produk := v_total_produk + (v_line.qty * v_line.selling_price);
      v_total_disc   := v_total_disc
                        + ROUND(v_line.qty * v_line.selling_price, 2)
                        - v_net;
    ELSIF v_line.selling_price > 0 THEN
      v_net   := v_line.selling_price;
      v_total := v_total + v_net;
    ELSE
      v_net := 0;
    END IF;
    v_dpp := v_dpp + fn_line_dpp(v_net);
    v_ppn := v_ppn + fn_line_ppn(v_net);
  END LOOP;

  UPDATE quotations
  SET total_produk   = v_total_produk,
      total          = v_total,
      total_discount = v_total_disc,
      dpp_nilai_lain = v_dpp,
      ppn_amount     = v_ppn,
      grand_total    = v_total - v_total_disc + v_ppn
  WHERE id = p_quotation_id;
END;
$function$
