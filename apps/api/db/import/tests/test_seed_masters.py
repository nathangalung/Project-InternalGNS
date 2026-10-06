"""Synthetic tests for clients, contacts and vendors in the seed rules."""

from __future__ import annotations

import json
from collections import Counter
from pathlib import Path

from helpers import Doc, inputs, invoice_doc, line, po_doc, staged
from seed_model import build, clean_email, second_parties
from vendors import (
    Decisions,
    channel_details,
    display_name,
    load_decisions,
    merge_key,
    review_pairs,
    split_cell,
    write_review,
)


def _ordered(
    client: str, number: str, day: str, address: str, buyer: str | None = None
) -> tuple[Doc, Doc, Doc]:
    rec = staged(f"{number}.xlsx#S", f"Q-{number}/GNS/I/2026", day, [line(1, 1000)], client)
    po = po_doc(rec, [{"no": 1, "qty": 1, "unit_price": 1000, "quote_row": 15}])
    po["id"] = f"po:{number}"
    inv = invoice_doc(po, f"{number}/INV", day)
    inv["buyer"] = {"name": buyer or client.upper(), "address": address, "npwp": None}
    return rec, po, inv


def test_clients_take_the_address_their_latest_invoice_prints() -> None:
    a = _ordered("PT. Contoh Laut", "1", "2026-01-05", "Jl. Lama 1")
    b = _ordered("PT. Contoh Laut", "2", "2026-02-05", "Jl. Baru 2")
    c = _ordered("PT. Contoh Kapal", "3", "2026-02-06", "Gedung Lain", "PT LAIN SEKALI")
    model = build(inputs(*(list(x) for x in zip(a, b, c, strict=True))))
    by_name = {cl.name: cl for cl in model.clients}
    assert by_name["PT. Contoh Laut"].address == "Jl. Baru 2"
    assert by_name["PT. Contoh Kapal"].address is None
    other = next(i for i in model.invoices if i.original == "3/INV")
    assert (other.buyer_name, other.buyer_address) == ("PT LAIN SEKALI", "Gedung Lain")


def test_two_people_in_one_attn_become_two_contacts() -> None:
    contact = {
        "name": "Bp. Satu Contoh / Ibu Dua Contoh",
        "email": "satu@contoh.invalid,",
        "phone": "dua@contoh.invalid",
    }
    short = {"name": "Bp. Satu", "email": None, "phone": None}
    model = build(
        inputs(
            [
                staged("a.xlsx#S", "Q-1/GNS/I/2026", "2026-10-01", [line(1, 10)], contact=contact),
                staged("b.xlsx#S", "Q-2/GNS/I/2026", "2026-10-02", [line(1, 10)], contact=short),
            ]
        )
    )
    got = sorted((c.name, c.email) for c in model.contacts)
    assert got == [
        ("Bp. Satu Contoh", "satu@contoh.invalid"),
        ("Ibu Dua Contoh", "dua@contoh.invalid"),
    ]
    assert {q.contact.name for q in model.quotations if q.contact} == {"Bp. Satu Contoh"}


def test_only_a_plain_client_mailbox_is_kept() -> None:
    assert clean_email(" Satu@Contoh.invalid; ") == "satu@contoh.invalid"
    assert clean_email("satu,dua@contoh.invalid") is None
    assert clean_email("sales@globalsakti.com") is None


def test_a_vendor_cell_names_its_shop_alternatives_phone_and_place() -> None:
    cell = split_cell("Toko Satu - 7pcs 750rb\nToko Dua (stok sedikit)\nLTC Glodok Lt 2\nToped")
    assert (cell.name, cell.alternatives, cell.location) == (
        "Toko Satu",
        ["Toko Dua"],
        "LTC Glodok Lt 2",
    )
    wide = split_cell("CV TOKO SATU        TOKO DUA / glodok")
    assert (wide.name, wide.alternatives, wide.location) == ("CV TOKO SATU", ["TOKO DUA"], "Glodok")
    assert split_cell("toko baut 081234567890").phones == ["081234567890"]
    assert channel_details("Lucky\n0812-3456-7890\nLTC Glodok") == (
        ["0812-3456-7890"],
        "LTC Glodok",
    )
    assert display_name("Toko Tiga - JakBar") == ("Toko Tiga", "Jakbar")


def test_vendor_spellings_share_a_key_and_decisions_join_the_rest() -> None:
    assert merge_key("PT Mega Tehnik") == merge_key("Mega Teknik - Toped") == "megateknik"
    assert merge_key("Pak Budi") == merge_key("Budi")
    assert merge_key("BP Online Shop") != merge_key("Online Shop")
    d = Decisions(into={"tokosatuu": "tokosatu"}, names={"tokosatu": "Toko Satu"})
    assert d.key("Toko Satuu") == "tokosatu"
    rec = staged(
        "a.xlsx#S",
        "Q-1/GNS/I/2026",
        "2026-10-01",
        [line(1, 10, 5, vendor="Toko Satuu\nToko Lain", channel="0812-3456-7890")],
    )
    data = inputs([rec])
    data.vendor_decisions = d
    model = build(data)
    (v,) = model.vendors
    assert (v.name, v.phone) == ("Toko Satu", "0812-3456-7890")
    assert "Baris 1: vendor alternatif Toko Lain" in model.quotations[0].notes


def test_a_broker_is_noted_once_and_a_second_printed_party_too() -> None:
    assert second_parties("PT SATU\nPT DUA") == ["PT DUA"]
    assert second_parties("PT SATU / PT DUA") == ["PT DUA"]
    assert second_parties("PT SATU\nAttn: Bp. Tiga") == []
    rec = staged("a.xlsx#S", "Q-1/GNS/I/2026", "2026-10-01", [line(1, 10)], notes=["Dua Maritim"])
    rec["client"]["broker_note"] = "PT Dua Maritim"
    (q,) = build(inputs([rec])).quotations
    assert [n for n in q.notes if "Dua" in n] == ["Pihak kedua: PT Dua Maritim"]


def test_an_enrichment_for_a_vanished_product_is_flagged() -> None:
    data = inputs([staged("a.xlsx#S", "Q-1/GNS/I/2026", "2026-10-01", [line(1, 10)])])
    data.enrichment = {"P9999": {"impa_code": "123456"}}
    assert ("P9999", "impa_enrichment.json names a product the catalogue no longer has") in (
        build(data).flagged
    )


def test_owner_decisions_load_and_lookalikes_go_to_review(tmp_path: Path) -> None:
    path = tmp_path / "vendor_overrides.json"
    assert load_decisions(path).into == {}
    path.write_text(
        json.dumps(
            {
                "merge": [
                    {"into": "Toko Satu", "names": ["Toko Satuu", "Toko Satu"], "reason": "typo"}
                ]
            }
        )
    )
    d = load_decisions(path)
    assert (d.into, d.names, d.reasons) == (
        {"tokosatuu": "tokosatu"},
        {"tokosatu": "Toko Satu"},
        {"tokosatuu": "typo"},
    )
    names = {
        "sinarabadi": Counter({"Sinar Abadi": 2}),
        "sinarabadii": Counter({"Sinar Abadii": 1}),
        "tokolain": Counter({"Toko Lain": 1}),
    }
    rows = review_pairs(names)
    assert [(r["vendor_a"], r["vendor_b"], r["reason"]) for r in rows] == [
        ("Sinar Abadi", "Sinar Abadii", "contained")
    ]
    out = tmp_path / "review.csv"
    write_review(rows, out)
    assert out.read_text().splitlines()[0] == "vendor_a,vendor_b,score,reason"


def test_a_contact_of_two_clients_keeps_its_email_at_both() -> None:
    contact = {"name": "Ibu Satu Contoh", "email": "satu@contoh.invalid", "phone": None}
    model = build(
        inputs(
            [
                staged(
                    "a.xlsx#S",
                    "Q-1/GNS/I/2026",
                    "2026-10-01",
                    [line(1, 10)],
                    "PT. Contoh Laut",
                    contact=contact,
                ),
                staged(
                    "b.xlsx#S",
                    "Q-2/GNS/I/2026",
                    "2026-10-02",
                    [line(1, 10)],
                    "PT. Contoh Kapal",
                    contact=contact,
                ),
            ]
        )
    )
    got = sorted((c.client.name, c.email) for c in model.contacts)
    assert got == [
        ("PT. Contoh Kapal", "satu@contoh.invalid"),
        ("PT. Contoh Laut", "satu@contoh.invalid"),
    ]
