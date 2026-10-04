"""Historical seed model: owner rules over the staged inputs.

Reads out/staged.json, out/products.json, impa_enrichment.json (when
present), pos.json and invoices.json, and turns them into the rows the
seed loads: clients, contacts, vendors, products, vendor links,
quotations with their lines and status history, purchase orders and
invoices. Everything here is pure Python, so the rules are unit-tested
without a database; seed_sql.py writes the result as SQL.

The rules are the owner decisions in docs/data_reimport_plan.md.
"""

from __future__ import annotations

import json
import re
from collections import Counter, defaultdict
from collections.abc import Iterable
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path
from typing import Any

from clean_products import clean_text_block, comparison_key, is_credit, item_kind
from paths import (
    ENRICHMENT_FILE,
    INVOICES_FILE,
    POS_FILE,
    PRODUCTS_FILE,
    STAGED_FILE,
    VENDOR_OVERRIDES_FILE,
)
from unit_map import canonical_unit
from vendors import Decisions, channel_details, display_name, load_decisions, split_cell

# The reimport's reference day (WIB) for the expiry rule.
AS_OF = date(2026, 10, 4)
WIB = timezone(timedelta(hours=7))
DAY_START = time(9, 0)

CENT = Decimal("0.01")
ZERO = Decimal(0)
HUNDRED = Decimal(100)
# profit_pct is NUMERIC(7,4): (sell - cost) / cost must stay below this.
PROFIT_PCT_MAX = Decimal("999.9999")
# quotation_items.ship_destination is VARCHAR(255).
SHIP_DESTINATION_MAX = 255
# vendors.location is VARCHAR(255).
VENDOR_LOCATION_MAX = 255
# invoices.ppn_rate is fixed at 12 (DPP Nilai Lain 11/12).
APP_PPN_RATE = Decimal("12.00")

ROMAN = ("I", "II", "III", "IV", "V", "VI", "VII", "VIII", "IX", "X", "XI", "XII")
UNPRICED_REASON = "Tidak pernah diberi harga jual"
EXPIRY_NOTE = "Kedaluwarsa otomatis: masa berlaku {days} hari sejak {sent} telah lewat."

Doc = dict[str, Any]


class SeedError(Exception):
    """An input the rules cannot place."""


def dec(value: object) -> Decimal:
    if value is None:
        return ZERO
    return Decimal(str(value))


def sen(value: Decimal) -> Decimal:
    """Round half away from zero, as Postgres ROUND."""
    return value.quantize(CENT, ROUND_HALF_UP)


def at(day: date, minutes: int = 0) -> datetime:
    """The WIB moment `minutes` after 09:00 on `day`."""
    return datetime.combine(day, DAY_START, WIB) + timedelta(minutes=minutes)


def rupiah(value: Decimal) -> str:
    """Indonesian money text: Rp 1.234.567 or Rp 1.234.567,50."""
    v = sen(value)
    sign = "-" if v < 0 else ""
    whole, frac = f"{abs(v):.2f}".split(".")
    grouped = f"{int(whole):,}".replace(",", ".")
    return f"Rp {sign}{grouped}" + (f",{frac}" if frac != "00" else "")


def natural_key(text: str | None) -> tuple[tuple[int, int | str], ...]:
    """Sort key that orders embedded numbers by value."""
    parts = re.split(r"(\d+)", text or "")
    return tuple((0, int(p)) if p.isdigit() else (1, p.casefold()) for p in parts if p)


def doc_number(prefix: str, seq: int, day: date) -> str:
    """TYPE-NNNNN/GNS/<Roman month>/<YYYY>, as fn_next_doc_no."""
    return f"{prefix}-{seq:05d}/GNS/{ROMAN[day.month - 1]}/{day.year}"


def revision_number(base: str, n: int) -> str:
    """Base number plus ' Rev.n', as fn_revise_quotation."""
    return f"{base} Rev.{n}"


def vendor_key(name: str) -> str:
    """Normalised vendor name: letters and digits only, casefolded."""
    return re.sub(r"[\W_]+", "", name.casefold())


def company_key(name: str) -> str:
    """A company name without its legal form, letters and digits only."""
    bare = re.sub(r"^\s*(pt|cv)(\.|\s)\s*", "", name, flags=re.IGNORECASE)
    return vendor_key(re.sub(r"[\s,]+tbk\.?\s*$", "", bare, flags=re.IGNORECASE))


VESSEL_PREFIX = {"mv", "mt", "tb", "fc", "km", "tcp", "sv", "lct"}
NOT_VESSELS = {"officestock"}


def vessel_words(name: str | None) -> set[str]:
    """A vessel name's words, without its type prefix or a place in brackets."""
    bare = re.sub(r"\([^)]*\)", " ", name or "").casefold()
    return {w for w in re.findall(r"[a-z0-9]+", bare) if w not in VESSEL_PREFIX}


def same_vessel(a: str | None, b: str | None) -> bool:
    """Two printings of one vessel: one's words all sit in the other's."""
    wa, wb = vessel_words(a), vessel_words(b)
    return bool(wa and wb) and (wa <= wb or wb <= wa)


def second_parties(printed: str | None) -> list[str]:
    """Companies a document prints after its client's own name."""
    names = [n.strip() for n in re.split(r"\n|\s/\s*(?=(?:PT|CV)\b)", printed or "")]
    return [n for n in names[1:] if re.match(r"(PT|CV)\b", n)]


# validate.StoredNPWP: an Indonesian NPWP is 16 digits.
NPWP_DIGITS = 16


def npwp_digits(raw: str | None) -> str | None:
    """A printed NPWP as digits only, else None."""
    digits = re.sub(r"\D", "", raw or "")
    return digits or None


HONORIFICS = {"bapak", "bpk", "bp", "pak", "ibu", "bu", "mr", "mrs", "ms", "miss", "sdr", "sdri"}


def contact_key(name: str) -> str:
    """Normalised contact name without honorifics."""
    words = re.findall(r"[\w']+", name.casefold())
    return " ".join(w for w in words if w not in HONORIFICS)


# validate.Email's pattern, so every seeded contact can be saved as is.
_ATEXT = r"[A-Za-z0-9!#$%&'*+/=?^_`{|}~-]"
EMAIL_RE = re.compile(
    rf"^{_ATEXT}+(\.{_ATEXT}+)*@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{{2,}}$"
)
# The seller's own mailbox, typed where the client's belongs.
OWN_DOMAIN = "@globalsakti.com"


def clean_email(raw: str | None) -> str | None:
    """A single well-formed client address, else None."""
    if not raw:
        return None
    value = raw.strip().rstrip(",;").strip()
    if not EMAIL_RE.match(value) or value.lower().endswith(OWN_DOMAIN):
        return None
    return value.lower()


def split_people(name: str) -> list[str]:
    """An ATTN naming two people ('Bp. A / Ibu B') as one name each."""
    return [p.strip() for p in re.split(r"\s*/\s*|\s+&\s+", name) if p.strip()]


def mailboxes(*fields: str | None) -> list[str]:
    """Every well-formed address in the given fields, in order."""
    found: list[str] = []
    for f in fields:
        for token in re.split(r",\s+|[\s;/]+", f or ""):
            email = clean_email(token)
            if email and email not in found:
                found.append(email)
    return found


def clean_phone(raw: str | None) -> str | None:
    """Local digits after the dial code when there are 9 to 12, else None."""
    if not raw:
        return None
    digits = re.sub(r"\D", "", raw)
    if digits.startswith("62"):
        digits = digits[2:]
    digits = digits.lstrip("0")
    return digits if 9 <= len(digits) <= 12 else None


DAYS_RE = re.compile(r"^\s*(\d{1,3})\s*(?:working\s*)?(?:days?|workdays?)\b", re.IGNORECASE)


def shipping_days(text: str | None) -> int | None:
    """Days from 'N working days after PO received', else None."""
    if not text:
        return None
    m = DAYS_RE.match(text)
    if not m:
        return None
    n = int(m.group(1))
    return n if 1 <= n <= 365 else None


def most_common(votes: Counter[str]) -> str | None:
    """Most frequent value; ties take the smallest."""
    if not votes:
        return None
    return sorted(votes.items(), key=lambda kv: (-kv[1], kv[0]))[0][0]


LEGACY_RE = re.compile(r"^(.*?/GNS/[IVX]+/\d{4})\b")


def legacy_number(printed: str | None) -> str | None:
    """A printed number without the text a header cell adds after its year."""
    text = text_or_none(printed)
    if text is None:
        return None
    m = LEGACY_RE.match(text)
    return m.group(1) if m else text


def file_number(original: str | None) -> int | None:
    """The running digits of an original number (Q-546 -> 546)."""
    m = re.match(r"\s*Q\s*-?\s*(\d+)", original or "", re.IGNORECASE)
    return int(m.group(1)) if m else None


# Rows
@dataclass
class Client:
    id: int
    name: str
    number: str = ""
    first_date: date = date.max
    address: str | None = None
    npwp: str | None = None


@dataclass
class Contact:
    id: int
    client: Client
    key: str
    first_date: date
    names: Counter[str] = field(default_factory=Counter)
    emails: Counter[str] = field(default_factory=Counter)
    phones: Counter[str] = field(default_factory=Counter)
    email: str | None = None

    @property
    def name(self) -> str:
        return most_common(self.names) or self.key

    @property
    def phone(self) -> str | None:
        return most_common(self.phones)


@dataclass
class Vendor:
    id: int
    key: str
    first_date: date
    names: Counter[str] = field(default_factory=Counter)
    decided: str | None = None
    phones: Counter[str] = field(default_factory=Counter)
    places: Counter[str] = field(default_factory=Counter)

    @property
    def name(self) -> str:
        return self.decided or most_common(self.names) or self.key

    @property
    def phone(self) -> str | None:
        return most_common(self.phones)

    @property
    def location(self) -> str | None:
        place = most_common(self.places)
        return place[:VENDOR_LOCATION_MAX] if place else None


@dataclass
class Product:
    id: int
    pid: str
    name: str
    description: str | None
    impa: str | None
    unit: str | None
    kind: str
    first_date: date
    impa_source: str = "products"
    used: bool = False


@dataclass
class VendorLink:
    id: int
    vendor: Vendor
    product: Product
    first_date: date
    last_date: date
    cost: Decimal = ZERO
    # (date, quotation order, line) of every priced line.
    priced: list[tuple[date, tuple[int, int], int, Decimal]] = field(default_factory=list)


@dataclass
class History:
    from_status: str | None
    to_status: str
    at: datetime
    note: str | None
    system: bool = False


@dataclass
class QLine:
    id: int
    line_number: int
    item_type: str
    requested_name: str
    requested_impa: str | None
    product: Product | None
    link: VendorLink | None
    qty: Decimal
    unit: str | None
    sell: Decimal
    cost: Decimal | None
    available: bool
    ship_destination: str | None = None
    shipping_days: int | None = None
    source_row: int | None = None
    in_total: bool = True


@dataclass
class Totals:
    total_produk: Decimal
    total: Decimal
    total_discount: Decimal
    dpp: Decimal
    ppn: Decimal
    grand: Decimal


@dataclass
class Quotation:
    key: str
    source: str
    original: str
    date: date
    client: Client
    contact: Contact | None
    contact_name: str | None
    client_ref: str | None
    vessel: str | None
    payment_terms: str | None
    validity_days: int | None
    discount_pct: Decimal
    lines: list[QLine] = field(default_factory=list)
    notes: list[str] = field(default_factory=list)
    status: str = "sent"
    history: list[History] = field(default_factory=list)
    id: int = 0
    number: str = ""
    seq: int = 0
    version: int = 1
    parent: Quotation | None = None
    successor: Quotation | None = None
    printed_grand: Decimal | None = None
    causes: list[str] = field(default_factory=list)
    totals: Totals | None = None
    staged: Doc | None = None
    year: int = 0
    origin: str = "staged"
    legacy: str | None = None


@dataclass
class POLine:
    id: int
    line_number: int
    item_type: str
    item_name: str
    item_code: str | None
    product: Product | None
    link: VendorLink | None
    quotation_item_id: int | None
    qty: Decimal
    unit: str | None
    sell: Decimal
    cost: Decimal | None
    ship_destination: str | None = None
    shipping_days: int | None = None


@dataclass
class PurchaseOrder:
    key: str
    quotation: Quotation
    client: Client
    number: str | None
    missing_reason: str | None
    po_date: date
    discount_pct: Decimal
    lines: list[POLine]
    source: str
    id: int = 0
    notes: list[str] = field(default_factory=list)
    dn_number: str = ""
    dn_seq: int = 0
    dn_date: date = date.min
    dn_original: str | None = None
    history: list[History] = field(default_factory=list)


@dataclass
class InvLine:
    id: int
    line_number: int
    line_type: str
    item_name: str
    item_code: str | None
    goods_or_service: str
    unit: str | None
    qty: Decimal
    unit_price: Decimal
    gross_unit_price: Decimal
    dpp: Decimal
    dpp_nilai_lain: Decimal
    ppn_rate: Decimal
    ppn: Decimal
    po_line: POLine


@dataclass
class Invoice:
    original: str
    po: PurchaseOrder
    invoice_date: date
    due_date: date | None
    subtotal: Decimal
    total_discount: Decimal
    dpp: Decimal
    dpp_nilai_lain: Decimal
    ppn: Decimal
    total: Decimal
    lines: list[InvLine]
    source: str
    buyer_name: str
    buyer_address: str | None
    buyer_npwp: str | None
    id: int = 0
    number: str = ""
    seq: int = 0
    history: list[History] = field(default_factory=list)


@dataclass
class Model:
    clients: list[Client]
    contacts: list[Contact]
    vendors: list[Vendor]
    products: list[Product]
    links: list[VendorLink]
    quotations: list[Quotation]
    pos: list[PurchaseOrder]
    invoices: list[Invoice]
    skipped: list[tuple[str, str]]
    flagged: list[tuple[str, str]]
    as_of: date


# App arithmetic
def line_dpp(subtotal: Decimal) -> Decimal:
    """fn_line_dpp."""
    return sen(subtotal * 11 / 12)


def line_ppn(subtotal: Decimal) -> Decimal:
    """fn_line_ppn."""
    return sen(line_dpp(subtotal) * Decimal("0.12"))


def quotation_totals(lines: Iterable[QLine], pct: Decimal) -> Totals:
    """fn_recompute_quotation_totals: per-line DPP and PPN, summed."""
    total_produk = total = disc = dpp = ppn = ZERO
    for ln in sorted(lines, key=lambda x: x.line_number):
        gross = ln.qty * ln.sell
        if ln.item_type == "product":
            net = sen(gross * (1 - pct / HUNDRED))
            total = sen(total + gross)
            total_produk = sen(total_produk + gross)
            disc = sen(disc + sen(gross) - net)
        elif ln.sell > 0:
            net = ln.sell
            total = sen(total + net)
        else:
            net = ZERO
        dpp += line_dpp(net)
        ppn += line_ppn(net)
    return Totals(total_produk, total, disc, dpp, ppn, total - disc + ppn)


def monotonic(events: list[tuple[date, str | None, str, str | None, bool]]) -> list[History]:
    """Status moves at 09:00 of their day, each at least a minute apart."""
    out: list[History] = []
    last: datetime | None = None
    for day, frm, to, note, system in events:
        when = at(day)
        if last is not None and when <= last:
            when = last + timedelta(minutes=1)
        out.append(History(frm, to, when, note, system))
        last = when
    return out


def quotation_status(
    *,
    has_po: bool,
    superseded: bool,
    unpriced: bool,
    priced_cost: bool,
    year: int,
    day: date,
    validity: int | None,
    as_of: date,
) -> str | None:
    """The owner's status rule; None means the quotation is skipped."""
    if superseded:
        return "revision"
    if has_po:
        return "accepted"
    if unpriced:
        if year >= 2026:
            return "draft"
        return "cancelled" if priced_cost else None
    if validity is not None and day + timedelta(days=validity) < as_of:
        return "expired"
    return "sent"


def split_discount(amounts: list[Decimal], discount: Decimal) -> list[Decimal]:
    """Net amounts after a discount spread pro rata; they sum exactly."""
    base = sum(amounts, ZERO)
    if not amounts or discount == 0 or base == 0:
        return list(amounts)
    nets = [sen(a - a * discount / base) for a in amounts]
    nets[-1] += base - discount - sum(nets, ZERO)
    return nets


def split_total(bases: list[Decimal], total: Decimal, rate: Decimal) -> list[Decimal]:
    """Per-line tax at `rate`, the last line taking the rounding rest."""
    if not bases:
        return []
    parts = [sen(b * rate / HUNDRED) for b in bases]
    parts[-1] += total - sum(parts, ZERO)
    return parts


# Loading
def load_json(path: Path) -> Doc:
    return json.loads(path.read_text(encoding="utf-8"))


@dataclass
class Inputs:
    staged: list[Doc]
    products: list[Doc]
    enrichment: dict[str, Doc]
    pos: list[Doc]
    invoices: list[Doc]
    vendor_decisions: Decisions = field(default_factory=Decisions)


def load_inputs(
    staged: Path = STAGED_FILE,
    products: Path = PRODUCTS_FILE,
    enrichment: Path = ENRICHMENT_FILE,
    pos: Path = POS_FILE,
    invoices: Path = INVOICES_FILE,
    vendor_overrides: Path = VENDOR_OVERRIDES_FILE,
) -> Inputs:
    """Read every input; the enrichment and vendor decisions are optional."""
    codes: dict[str, Doc] = {}
    if enrichment.is_file():
        codes = load_json(enrichment).get("codes") or {}
    return Inputs(
        staged=load_json(staged)["quotations"],
        products=load_json(products)["products"],
        enrichment=codes,
        pos=load_json(pos)["pos"],
        invoices=load_json(invoices)["invoices"],
        vendor_decisions=load_decisions(vendor_overrides),
    )


def printed_grand(rec: Doc) -> Decimal | None:
    """The PRINT sheet's grand total, else the PDF's.

    A record whose lines were read from its PDF takes the PDF's: the PRINT
    sheet is the workbook's later edit.
    """
    pdf = rec.get("pdf") or {}
    if {"lines_from_pdf", "pdf_only_version"} & set(rec.get("flags") or []):
        return dec(pdf["grand"]) if pdf.get("grand") is not None else None
    pt = rec.get("print_totals") or {}
    if pt.get("grand") is not None:
        return dec(pt["grand"])
    if pdf.get("grand") is not None:
        return dec(pdf["grand"])
    return None


def is_unpriced(rec: Doc) -> bool:
    return not any(dec(ln["sell"]) > 0 for ln in rec["lines"])


def has_cost(rec: Doc) -> bool:
    return any(dec(ln["cost"]) > 0 for ln in rec["lines"])


def text_or_none(value: object) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


class Builder:
    """Applies the owner rules to the inputs."""

    def __init__(self, inputs: Inputs, as_of: date = AS_OF) -> None:
        self.inp = inputs
        self.as_of = as_of
        self.skipped: list[tuple[str, str]] = []
        self.flagged: list[tuple[str, str]] = []
        self.clients: dict[str, Client] = {}
        self.contacts: dict[tuple[str, str], Contact] = {}
        self.vendors: dict[str, Vendor] = {}
        self.products: dict[str, Product] = {}
        self.product_of: dict[tuple[str, int], Product] = {}
        self.links: dict[tuple[str, str], VendorLink] = {}
        self.dates: dict[str, date] = {}
        self.staged = {r["id"]: r for r in inputs.staged}
        self.by_file: dict[str, list[Doc]] = defaultdict(list)
        for rec in inputs.staged:
            for f in rec["source"]["files"]:
                self.by_file["Quotation/" + f].append(rec)
        self.quotations: list[Quotation] = []
        self.instance: dict[str, Quotation] = {}
        self.pos: list[PurchaseOrder] = []
        self.invoices: list[Invoice] = []

    def flag(self, label: str, reason: str) -> None:
        self.flagged.append((label, reason))

    # Masters
    def client(self, name: str) -> Client:
        if name not in self.clients:
            self.clients[name] = Client(id=0, name=name)
        return self.clients[name]

    def fill_dates(self) -> None:
        """Each record's date; a missing one takes the nearest earlier number's.

        A date whose year differs from both its folder and its printed
        number, which agree, is a year typo and takes their year.
        """
        staged = self.inp.staged
        for rec in staged:
            if rec["date"]:
                day = date.fromisoformat(rec["date"])
                folder = re.search(r"Quotation (\d{4})", rec["source"]["files"][0])
                printed = re.search(r"/(\d{4})\b", rec["number"]["original"] or "")
                if folder and printed and folder[1] == printed[1] and int(folder[1]) != day.year:
                    fixed = day.replace(year=int(folder[1]))
                    self.flag(
                        rec["number"]["original"],
                        f"date {day} is a year typo (folder and number say {folder[1]}); "
                        f"took {fixed}",
                    )
                    day = fixed
                self.dates[rec["id"]] = day
        for rec in staged:
            if rec["date"]:
                continue
            own = file_number(rec["number"]["original"])
            best: tuple[int, Doc] | None = None
            for other in staged:
                n = file_number(other["number"]["original"])
                if other["year"] != rec["year"] or not other["date"] or n is None:
                    continue
                if own is not None and n < own and (best is None or n > best[0]):
                    best = (n, other)
            if best is None:
                raise SeedError(f"{rec['id']}: no date and no earlier quotation in {rec['year']}")
            self.dates[rec["id"]] = self.dates[best[1]["id"]]
            self.flag(
                rec["number"]["original"],
                f"no date printed; took {self.dates[rec['id']]} from "
                f"{best[1]['number']['original']}, the nearest earlier number",
            )

    def build_products(self) -> None:
        taken = {p["impa_code"].upper(): p["id"] for p in self.inp.products if p["impa_code"]}
        for p in sorted(self.inp.products, key=lambda x: x["id"]):
            impa, source = p["impa_code"], "products"
            extra = self.inp.enrichment.get(p["id"])
            if extra and not impa:
                code = str(extra["impa_code"])
                owner = taken.get(code.upper())
                if owner and owner != p["id"]:
                    self.flag(p["id"], f"enrichment IMPA {code} skipped: already on {owner}")
                else:
                    impa, source = code, "enrichment"
                    taken[code.upper()] = p["id"]
            desc = "\n".join(s for s in (p["description"], p["pack_note"]) if s) or None
            first = min(self.dates[s["quotation"]] for s in p["source_lines"])
            prod = Product(0, p["id"], p["name"], desc, impa, p["default_unit"], p["kind"], first)
            prod.impa_source = source
            self.products[p["id"]] = prod
            for s in p["source_lines"]:
                key = (s["quotation"], s["line_no"])
                if key in self.product_of:
                    raise SeedError(f"line {key} belongs to two products")
                self.product_of[key] = prod
        for pid in sorted(set(self.inp.enrichment) - set(self.products)):
            self.flag(pid, "impa_enrichment.json names a product the catalogue no longer has")
        for rec in self.inp.staged:
            for ln in rec["lines"]:
                if not is_credit(ln) and (rec["id"], ln["line_no"]) not in self.product_of:
                    raise SeedError(f"{rec['id']} line {ln['line_no']} has no product")

    def vendor(self, name: str, day: date) -> Vendor | None:
        decisions = self.inp.vendor_decisions
        key = decisions.key(name)
        if not key:
            return None
        v = self.vendors.get(key)
        if v is None:
            v = self.vendors[key] = Vendor(0, key, day, decided=decisions.names.get(key))
        v.first_date = min(v.first_date, day)
        shown, place = display_name(name)
        v.names[shown] += 1
        if place:
            v.places[place] += 1
        return v

    def link(self, vendor: Vendor, prod: Product, day: date) -> VendorLink:
        k = (vendor.key, prod.pid)
        ln = self.links.get(k)
        if ln is None:
            ln = self.links[k] = VendorLink(0, vendor, prod, day, day)
        ln.first_date = min(ln.first_date, day)
        ln.last_date = max(ln.last_date, day)
        return ln

    def contact(self, client: Client, raw: Doc | None, day: date) -> Contact | None:
        """The ATTN's contact; a second person named with it is a contact too.

        Two people take the addresses in the order printed; an address
        typed in the phone field counts as one.
        """
        name = text_or_none((raw or {}).get("name"))
        if not raw or not name:
            return None
        people = [(p, contact_key(p)) for p in split_people(name)]
        people = [(p, k) for p, k in people if k]
        emails = mailboxes(raw.get("email"), raw.get("phone"))
        phone = None if "@" in (raw.get("phone") or "") else clean_phone(raw.get("phone"))
        found: list[Contact] = []
        for i, (person, key) in enumerate(people):
            c = self.contacts.get((client.name, key))
            if c is None:
                c = self.contacts[(client.name, key)] = Contact(0, client, key, day)
            c.first_date = min(c.first_date, day)
            c.names[person] += 1
            email = emails[i] if len(emails) == len(people) else (emails[:1] or [None])[0]
            if email and (i == 0 or len(emails) == len(people)):
                c.emails[email] += 1
            if phone and i == 0:
                c.phones[phone] += 1
            found.append(c)
        return found[0] if found else None

    def merge_contacts(self) -> None:
        """One contact per person within a client.

        Two share a person when they share an address, or when one's name
        words all sit in exactly one other's ('Bp. Adi Putra' in 'Bp. Adi
        Putra Wijaya'). The fuller name stays.
        """
        by_client: dict[str, list[Contact]] = defaultdict(list)
        for c in self.contacts.values():
            by_client[c.client.name].append(c)
        into: dict[int, Contact] = {}
        for group in by_client.values():
            group.sort(key=lambda c: (-len(c.key.split()), c.key))
            for c in group:
                words = set(c.key.split())
                mail = set(c.emails)
                fuller = [
                    o
                    for o in group
                    if o is not c
                    and id(o) not in into
                    and ((mail & set(o.emails)) or (words < set(o.key.split())))
                ]
                if len(fuller) != 1 or len(fuller[0].key.split()) < len(words):
                    continue
                keep = fuller[0]
                into[id(c)] = keep
                keep.first_date = min(keep.first_date, c.first_date)
                keep.emails.update(c.emails)
                keep.phones.update(c.phones)
                self.flag(f"{c.name} ({c.client.name})", f"merged into contact {keep.name}")
        if not into:
            return
        self.contacts = {k: c for k, c in self.contacts.items() if id(c) not in into}
        for q in self.quotations:
            while q.contact is not None and id(q.contact) in into:
                q.contact = into[id(q.contact)]

    # Quotations
    def staged_lines(self, rec: Doc, label: str) -> tuple[list[QLine], list[str]]:
        """The record's lines, and a note per line naming alternative shops."""
        out: list[QLine] = []
        notes: list[str] = []
        day = self.dates[rec["id"]]
        for ln in sorted(rec["lines"], key=lambda x: x["line_no"]):
            if is_credit(ln):
                continue
            prod = self.product_of[(rec["id"], ln["line_no"])]
            prod.used = True
            available = bool(ln["available"])
            sell = sen(dec(ln["sell"])) if available and ln["sell"] is not None else ZERO
            cost = sen(dec(ln["cost"])) if available and ln["cost"] is not None else None
            if cost is not None and cost > 0 and (sell - cost) / cost > PROFIT_PCT_MAX:
                self.flag(
                    label, f"line {ln['line_no']}: harga beli {cost} dropped (profit overflow)"
                )
                cost = None
            link = None
            cell = split_cell(ln["vendor"] if available else None)
            vendor = self.vendor(cell.name, day) if cell.name else None
            if vendor is not None:
                link = self.link(vendor, prod, day)
                phones, place = channel_details(ln.get("channel"))
                for phone in cell.phones + phones:
                    vendor.phones[phone] += 1
                if cell.location or place:
                    vendor.places[cell.location or place or ""] += 1
                if cell.alternatives:
                    notes.append(
                        f"Baris {len(out) + 1}: vendor alternatif " + ", ".join(cell.alternatives)
                    )
            out.append(
                QLine(
                    id=0,
                    line_number=len(out) + 1,
                    item_type="product",
                    requested_name=(ln["request"] or "").strip(),
                    requested_impa=ln["impa"],
                    product=prod,
                    link=link,
                    qty=self.qty(ln, label),
                    unit=ln["unit"],
                    sell=sell,
                    cost=cost,
                    available=available,
                    source_row=ln["row"],
                    in_total=bool(ln["in_total"]),
                )
            )
        return out, notes

    def qty(self, ln: Doc, label: str) -> Decimal:
        """The line quantity, above 0 as quotation_items requires.

        A missing one follows the printed amount; one that stays 0 is
        stored as 1.
        """
        qty = sen(dec(ln["qty"]))
        if ln["qty"] is None:
            sell, amount = dec(ln["sell"]), dec(ln["line_total"])
            if sell > 0 and amount > 0 and sen(amount / sell) == amount / sell:
                qty = amount / sell
        if qty <= 0:
            qty = Decimal(1)
        if ln["qty"] is None or dec(ln["qty"]) <= 0:
            printed = "no quantity printed" if ln["qty"] is None else f"quantity {ln['qty']}"
            self.flag(label, f"line {ln['line_no']}: {printed}; stored {qty}")
        return qty

    def from_staged(self, rec: Doc, client: Client, primary: bool) -> Quotation:
        label = rec["number"]["original"]
        day = self.dates[rec["id"]]
        terms = rec["terms"] or {}
        q = Quotation(
            key=rec["id"],
            source=rec["source"]["files"][0],
            original=label,
            date=day,
            client=client,
            contact=self.contact(client, rec["contact"], day) if primary else None,
            contact_name=text_or_none((rec["contact"] or {}).get("name")) if primary else None,
            client_ref=text_or_none(rec["client_ref"]),
            vessel=text_or_none(rec["vessel"]),
            payment_terms=text_or_none(terms.get("payment")),
            validity_days=terms.get("validity_days"),
            discount_pct=ZERO,
            staged=rec,
            year=day.year,
        )
        q.lines, alternatives = self.staged_lines(rec, label)
        q.notes.extend(alternatives)
        q.printed_grand = printed_grand(rec)
        self.apply_legacy(q, rec)
        broker = text_or_none(rec["client"].get("broker_note"))
        if broker:
            q.notes.append(f"Pihak kedua: {broker}")
        q.notes.extend(
            n
            for n in rec["notes"]
            if text_or_none(n)
            and n.strip() != "Note:"
            and not (broker and company_key(n) == company_key(broker))
        )
        self.apply_discount(q, rec)
        self.apply_shipping(q, rec)
        out = [ln.line_number for ln in q.lines if not ln.in_total]
        if out:
            q.notes.append("Baris tidak termasuk total tercetak: " + ", ".join(map(str, out)))
            q.causes.append("lines kept out of the printed total imported as ordinary lines")
        for ln in rec["lines"]:
            if is_credit(ln):
                amount = dec(ln["line_total"] if ln["line_total"] is not None else ln["sell"])
                name = " ".join((ln["offer"] or ln["request"] or "").split())
                q.notes.append(
                    f"Baris tercetak '{name}' {rupiah(amount)} tidak disimpan (nilai negatif)"
                )
                q.causes.append("negative line not stored")
        return q

    def apply_legacy(self, q: Quotation, rec: Doc) -> None:
        """The issued PDF's number, else the workbook's; other numbers go to notes."""
        n = rec["number"]
        q.legacy = legacy_number(n.get("pdf")) or legacy_number(n["original"])
        others = [n["original"]] + [
            a["number"] for a in rec.get("aliases") or [] if "number" in a.get("differs", [])
        ]
        seen = {q.legacy}
        extra = []
        for other in map(legacy_number, others):
            if other and other not in seen:
                seen.add(other)
                extra.append(other)
        if extra:
            q.notes.append("Juga tercatat dengan No. " + ", ".join(extra))

    def apply_discount(self, q: Quotation, rec: Doc) -> None:
        disc = rec["discount"]
        if disc["kind"] == "pct":
            q.discount_pct = dec(disc["pct"])
        elif disc["kind"] == "amount":
            gross = sum((ln.qty * ln.sell for ln in q.lines), ZERO)
            amount = dec(disc["amount"])
            q.discount_pct = sen(amount * HUNDRED / gross) if gross else ZERO
            q.notes.append(f"Diskon tercetak {rupiah(amount)} disimpan sebagai {q.discount_pct}%")
            q.causes.append("fixed-amount discount stored as a percentage")

    def apply_shipping(self, q: Quotation, rec: Doc) -> None:
        extras = rec["extras"] or []
        if len(extras) > 1:
            raise SeedError(f"{q.original}: more than one extra charge")
        terms = rec["terms"] or {}
        days = shipping_days(terms.get("delivery_time"))
        delivery = text_or_none(terms.get("delivery_time"))
        if delivery and days is None and delivery != "-":
            q.notes.append(f"Delivery time tercetak: {delivery}")
        destination = text_or_none(terms.get("delivery_place"))
        if destination and len(destination) > SHIP_DESTINATION_MAX:
            self.flag(q.original, f"delivery place cut to {SHIP_DESTINATION_MAX} characters")
            q.notes.append(f"Delivery place tercetak: {destination}")
            destination = destination[:SHIP_DESTINATION_MAX].rstrip()
        cost, label = ZERO, None
        for ex in extras:
            amount = dec(ex["amount"])
            if amount > 0:
                cost, label = amount, text_or_none(ex["label"])
                if not ex.get("taxed"):
                    q.causes.append("untaxed extra charge taxed as the shipping line")
            else:
                q.notes.append(
                    f"Baris tercetak '{ex['label']}' {rupiah(amount)} tidak disimpan "
                    "(nilai negatif)"
                )
                q.causes.append("negative extra charge not stored")
        if cost > 0 or days is not None or destination:
            q.lines.append(
                QLine(
                    id=0,
                    line_number=len(q.lines) + 1,
                    item_type="shipping",
                    requested_name="SHIPPING" + (f" — {label}" if label else ""),
                    requested_impa=None,
                    product=None,
                    link=None,
                    qty=Decimal(1),
                    unit="UNIT",
                    sell=cost,
                    cost=None,
                    available=True,
                    ship_destination=destination,
                    shipping_days=days,
                )
            )

    def synthetic(self, po: Doc, client: Client) -> Quotation:
        syn = po["synthetic_quotation"]
        day = date.fromisoformat(syn["date"])
        original = syn.get("original_number") or ""
        q = Quotation(
            key=f"synthetic:{po['id']}",
            source=po["source_files"][0]["path"],
            original=original,
            date=day,
            client=client,
            contact=None,
            contact_name=None,
            client_ref=text_or_none(po.get("client_reference")),
            vessel=text_or_none(po.get("user_end")),
            payment_terms=text_or_none(po.get("payment_terms")),
            validity_days=None,
            discount_pct=ZERO,
            year=day.year,
            origin="synthetic",
            legacy=legacy_number(original),
        )
        q.notes.append(
            "Dibuat ulang dari baris PO klien: tidak ada quotation di arsip yang menjadi "
            f"sumbernya ({syn['reason']})"
        )
        gone = syn.get("overwritten_file")
        if gone:
            q.notes.append(f"Berkas aslinya kini memuat quotation lain ({gone['prints_number']})")
        for pl in po["lines"]:
            prod = self.po_product(pl, day, po["id"])
            q.lines.append(
                QLine(
                    id=0,
                    line_number=len(q.lines) + 1,
                    item_type="product",
                    requested_name=pl["description"].strip(),
                    requested_impa=None,
                    product=prod,
                    link=None,
                    qty=sen(dec(pl["qty"])),
                    unit=canonical_unit(pl.get("unit")) or prod.unit,
                    sell=sen(dec(pl["unit_price"])),
                    cost=None,
                    available=True,
                    source_row=pl["no"],
                )
            )
        q.notes.append("Harga beli dan vendor tidak tercatat di berkas")
        goods = sum((ln.qty * ln.sell for ln in q.lines), ZERO)
        discount = dec(po["discount"])
        if goods and discount:
            q.discount_pct = sen(discount * HUNDRED / goods)
            if sen(goods * q.discount_pct / HUNDRED) != discount:
                q.notes.append(
                    f"Diskon tercetak di PO {rupiah(discount)} disimpan sebagai {q.discount_pct}%"
                )
        return q

    def po_product(self, pl: Doc, day: date, label: str) -> Product:
        """The catalogue product a PO line names, or a new one for it.

        A line no quotation priced still needs a product, as every offered
        line of an accepted quotation has one; the catalogue's is used when
        its name matches.
        """
        text = clean_text_block(pl["description"])
        key = comparison_key(text.name)
        found = next((p for p in self.products.values() if comparison_key(p.name) == key), None)
        if found is not None:
            found.used = True
            return found
        kind = item_kind(pl["description"])
        unit = canonical_unit(pl.get("unit")) or ("UNIT" if kind == "service" else "PCS")
        if canonical_unit(pl.get("unit")) is None:
            self.flag(label, f"line {pl['no']}: no unit printed; product stored as {unit}")
        pid = f"S-{re.sub(r'[^0-9A-Za-z]+', '-', label)}-{pl['no']}"
        prod = Product(0, pid, text.name, text.description, None, unit, kind, day, used=True)
        self.products[pid] = prod
        return prod

    def build_quotations(self) -> dict[str, list[tuple[Quotation, Doc | None]]]:
        """Quotation instances; returns the POs by their quotation key."""
        po_targets: dict[str, list[Doc]] = defaultdict(list)
        for po in self.inp.pos:
            if po["synthetic_quotation"]:
                continue
            qd = po["quotation"]
            if not qd:
                raise SeedError(f"{po['id']}: neither a quotation nor a synthetic one")
            rec = self.resolve(qd["file"], qd["printed_number"], po["id"])
            po_targets[rec["id"]].append(po)

        chains: dict[str, list[Doc]] = defaultdict(list)
        for rec in self.inp.staged:
            if rec["revision"]:
                chains[rec["revision"]["group"]].append(rec)
        superseded: set[str] = set()
        for members in chains.values():
            members.sort(key=lambda r: r["revision"]["index"])
            superseded.update(r["id"] for r in members[:-1])

        by_po: dict[str, list[tuple[Quotation, Doc | None]]] = {}
        for rec in sorted(self.inp.staged, key=lambda r: r["id"]):
            label = rec["number"]["original"]
            targets = po_targets.get(rec["id"], [])
            if rec["id"] in superseded and targets:
                raise SeedError(f"{label}: a PO names a quotation that a revision supersedes")
            unpriced = is_unpriced(rec)
            status = quotation_status(
                has_po=bool(targets),
                superseded=rec["id"] in superseded,
                unpriced=unpriced,
                priced_cost=has_cost(rec),
                year=self.dates[rec["id"]].year,
                day=self.dates[rec["id"]],
                validity=(rec["terms"] or {}).get("validity_days"),
                as_of=self.as_of,
            )
            if status is None:
                self.skipped.append((label, "older than 2026 with no harga jual and no harga beli"))
                continue
            if unpriced and rec["id"] in superseded:
                self.flag(label, "no harga jual, but a revision supersedes it: kept as Revisi")
            if len(targets) > 1:
                kinds = {t["link"]["kind"] for t in targets}
                if kinds != {"split"}:
                    raise SeedError(f"{label}: several POs that are not a split")
                instances = []
                for po in sorted(targets, key=lambda t: t["client"]):
                    client = self.client(po["client"])
                    q = self.from_staged(rec, client, po["client"] == rec["client"]["name"])
                    self.apply_split(q, po)
                    q.key = f"{rec['id']}@{po['client']}"
                    q.status = status
                    instances.append((q, po))
                by_po[rec["id"]] = instances
                self.quotations.extend(q for q, _ in instances)
                continue
            q = self.from_staged(rec, self.client(rec["client"]["name"]), True)
            q.status = status
            self.quotations.append(q)
            self.instance[rec["id"]] = q
            by_po[rec["id"]] = [(q, targets[0] if targets else None)]

        for members in chains.values():
            kept = [self.instance[r["id"]] for r in members if r["id"] in self.instance]
            if len(kept) != len(members):
                raise SeedError(f"chain {members[0]['revision']['group']} lost a member")
            for i, q in enumerate(kept):
                q.version = i + 1
                if i:
                    q.parent = kept[i - 1]
                    kept[i - 1].successor = q

        for po in self.inp.pos:
            if po["synthetic_quotation"]:
                q = self.synthetic(po, self.client(po["client"]))
                q.status = "accepted"
                self.quotations.append(q)
                by_po[q.key] = [(q, po)]
        return by_po

    def resolve(self, path: str, printed: str, label: str) -> Doc:
        """The staged record a PO's quotation file names."""
        recs = self.by_file.get(path, [])
        hits = [r for r in recs if printed in (r["number"]["original"], r["number"].get("print"))]
        if len(hits) != 1:
            raise SeedError(f"{label}: {path} ({printed}) resolves to {len(hits)} quotations")
        return hits[0]

    def apply_split(self, q: Quotation, po: Doc) -> None:
        """One client's share of a quotation two clients ordered."""
        share = {pl["quote_row"]: pl for pl in po["quotation"]["lines"] if "quote_row" in pl}
        lines = {ln["no"]: ln for ln in po["lines"]}
        for ln in q.lines:
            pl = share.get(ln.source_row) if ln.source_row else None
            if pl:
                ln.qty = sen(dec(lines[pl["po_line"]]["qty"]))
        q.notes.append(f"Dipecah per klien: bagian {q.client.name} ({po['link'].get('share', '')})")
        q.causes.append("quotation split between two clients by their PO shares")

    # Numbering
    def number_quotations(self) -> None:
        """Q numbers by date; revisions keep their base number."""
        bases = [q for q in self.quotations if q.version == 1]
        bases.sort(key=lambda q: (q.date, natural_key(q.original), q.source, q.client.name))
        for seq, base in enumerate(bases, 1):
            base.seq, base.number = seq, doc_number("Q", seq, base.date)
            rev = base.successor
            while rev is not None:
                rev.seq = seq
                rev.number = revision_number(base.number, rev.version - 1)
                rev = rev.successor
        self.quotations.sort(key=lambda q: (q.seq, q.version))
        line_id = 0
        for qid, q in enumerate(self.quotations, 1):
            q.id = qid
            for ln in q.lines:
                line_id += 1
                ln.id = line_id

    # Purchase orders
    def build_pos(self, by_po: dict[str, list[tuple[Quotation, Doc | None]]]) -> None:
        for instances in by_po.values():
            for q, po in instances:
                if po is not None:
                    self.pos.append(self.purchase_order(po, q))
        self.pos.sort(key=lambda p: (p.po_date, natural_key(p.number or p.key), p.key))
        line_id = 0
        for pid, po in enumerate(self.pos, 1):
            po.id = pid
            for ln in po.lines:
                line_id += 1
                ln.id = line_id

    def purchase_order(self, po: Doc, q: Quotation) -> PurchaseOrder:
        client = self.client(po["client"])
        if client is not q.client:
            raise SeedError(f"{po['id']}: PO client {client.name} != quotation {q.client.name}")
        qd = po["quotation"] or {"lines": [], "charges": [], "other_files": []}
        mapping = {pl["po_line"]: pl for pl in qd["lines"]}
        own = {ln.source_row: ln for ln in q.lines if ln.item_type == "product"}
        others = {o["file"]: o["printed_number"] for o in qd.get("other_files") or []}
        untaxed = dec(po["untaxed"])
        lines: list[POLine] = []
        unpriced: list[str] = []
        for pl in po["lines"]:
            if not dec(pl["unit_price"]):
                unpriced.append(str(pl["no"]))
                continue
            qline: QLine | None = None
            same = True
            if q.origin == "synthetic":
                qline = own.get(pl["no"])
            else:
                m = mapping.get(pl["no"]) or {}
                if m.get("quote_file"):
                    rec = self.resolve(m["quote_file"], others[m["quote_file"]], po["id"])
                    other = self.instance[rec["id"]]
                    qline = next(x for x in other.lines if x.source_row == m["quote_row"])
                    same = False
                elif "quote_row" in m:
                    qline = own[m["quote_row"]]
            amount = sen(dec(pl["qty"]) * dec(pl["unit_price"]))
            lines.append(self.po_line(pl, qline, same, untaxed > 0 and amount == untaxed))
        for ch in po["charges"]:
            row = next(
                (c["quote_row"] for c in qd.get("charges") or [] if c["charge"] == ch["label"]),
                None,
            )
            pl = {"no": 0, "description": ch["label"], "qty": 1, "unit_price": ch["amount"]}
            lines.append(self.po_line(pl, own.get(row) if row else None, True, False))
        if untaxed > 0 and sum(1 for ln in lines if ln.item_type == "shipping") != 1:
            raise SeedError(f"{po['id']}: untaxed {untaxed} matches no single line")
        self.po_shipping(po, q, lines)
        for i, ln in enumerate(lines, 1):
            ln.line_number = i

        goods = sum((ln.qty * ln.sell for ln in lines if ln.item_type == "product"), ZERO)
        discount = dec(po["discount"])
        pct = sen(discount * HUNDRED / goods) if goods else ZERO
        if goods and sen(goods * pct / HUNDRED) != discount:
            self.flag(
                po["id"],
                f"PO discount {discount} is not a whole percentage; stored {pct}%",
            )
        order = PurchaseOrder(
            key=po["id"],
            quotation=q,
            client=client,
            number=text_or_none(po["client_po_number"]),
            missing_reason=text_or_none(po["client_po_number_missing_reason"]),
            po_date=date.fromisoformat(po["po_date"]),
            discount_pct=pct,
            lines=lines,
            source=po["source_files"][0]["path"],
        )
        if order.number is None:
            if not order.missing_reason:
                raise SeedError(f"{po['id']}: no PO number and no reason")
            order.notes.append(f"Tanpa No. PO klien: {order.missing_reason}")
        if unpriced:
            order.notes.append(
                f"Posisi {', '.join(unpriced)} di PO klien bernilai Rp 0 (tidak ditawarkan), "
                "tidak disimpan"
            )
        self.po_vessel(po, q)
        for party in second_parties(po.get("client_printed")):
            order.notes.append(f"Pihak kedua: {party}")
            if q.origin == "synthetic":
                q.notes.append(f"Pihak kedua: {party}")
        link = po["link"]
        if link["kind"] == "merge":
            for other in link["others"]:
                rec = next(
                    self.resolve(f, n, po["id"])
                    for f, n in others.items()
                    if n.startswith(other["quotation"] + "/")
                )
                oq = self.instance[rec["id"]]
                rows = ", ".join(map(str, other["po_lines"]))
                order.notes.append(f"Baris {rows} berasal dari {oq.number} ({oq.original})")
                oq.notes.append(f"Dipesan bersama {q.number} melalui PO {order.number}")
        return order

    def po_shipping(self, po: Doc, q: Quotation, lines: list[POLine]) -> None:
        """The PO's delivery place on its shipping line, one at Rp 0 if none was charged.

        The place is what the client PO prints, else the quotation's.
        """
        qship = next((ln for ln in q.lines if ln.item_type == "shipping"), None)
        place = text_or_none(po.get("delivery_place"))
        if place is None and qship is not None:
            place = qship.ship_destination
        days = qship.shipping_days if qship else None
        if place is None and days is None:
            return
        ship = next((ln for ln in lines if ln.item_type == "shipping"), None)
        if ship is None:
            ship = POLine(
                id=0,
                line_number=0,
                item_type="shipping",
                item_name=qship.requested_name if qship else "SHIPPING",
                item_code=None,
                product=None,
                link=None,
                quotation_item_id=qship.id if qship else None,
                qty=Decimal(1),
                unit="UNIT",
                sell=ZERO,
                cost=None,
            )
            lines.append(ship)
        ship.ship_destination = place[:SHIP_DESTINATION_MAX] if place else None
        ship.shipping_days = days

    def po_vessel(self, po: Doc, q: Quotation) -> None:
        """The vessel the client PO names, which the DN and invoice print."""
        vessel = text_or_none(po.get("user_end"))
        if vessel is None or vendor_key(vessel) in NOT_VESSELS:
            return
        if q.vessel is None:
            q.vessel = vessel
        elif not same_vessel(q.vessel, vessel):
            q.notes.append(f"Kapal tercetak di quotation: {q.vessel}; PO klien: {vessel}")
            q.vessel = vessel

    def po_line(self, pl: Doc, qline: QLine | None, same: bool, untaxed: bool) -> POLine:
        prod = qline.product if qline else None
        unit = canonical_unit(pl.get("unit")) or (qline.unit if qline else None)
        return POLine(
            id=0,
            line_number=0,
            item_type="shipping" if untaxed else "product",
            item_name=pl["description"].strip(),
            item_code=prod.impa if prod else None,
            product=prod,
            link=qline.link if qline else None,
            quotation_item_id=qline.id if qline and same else None,
            qty=sen(dec(pl["qty"])),
            unit=unit,
            sell=sen(dec(pl["unit_price"])),
            cost=qline.cost if qline else None,
        )

    # Invoices
    def build_invoices(self) -> None:
        by_key = {po.key: po for po in self.pos}
        for doc in self.inp.invoices:
            po = by_key.get(doc["po_id"])
            if po is None:
                raise SeedError(f"{doc['invoice_number']}: unknown PO {doc['po_id']}")
            self.invoices.append(self.invoice(doc, po))
            do_date = text_or_none(doc["do_date"])
            if do_date:
                po.dn_date = date.fromisoformat(do_date)
            else:
                po.dn_date = date.fromisoformat(doc["invoice_date"])
                self.flag(doc["invoice_number"], "no delivery order printed; DN dated the invoice")
            po.dn_original = text_or_none(doc["do_number"])
            for extra in doc["extra_dos"]:
                po.notes.append(f"DO susulan: {extra['number']} ({extra['date']})")
        if len({inv.po.key for inv in self.invoices}) != len(self.invoices):
            raise SeedError("a PO has two invoices")
        self.invoices.sort(key=lambda i: (i.invoice_date, natural_key(i.original), i.source))
        line_id = 0
        for seq, inv in enumerate(self.invoices, 1):
            inv.id, inv.seq = seq, seq
            inv.number = doc_number("INV", seq, inv.invoice_date)
            for ln in inv.lines:
                line_id += 1
                ln.id = line_id
        delivered = sorted(
            (po for po in self.pos if po.dn_date != date.min),
            key=lambda p: (p.dn_date, natural_key(p.dn_original), p.source),
        )
        for seq, po in enumerate(delivered, 1):
            po.dn_seq, po.dn_number = seq, doc_number("DN", seq, po.dn_date)

    def match_lines(self, doc: Doc, po: PurchaseOrder) -> list[POLine]:
        """Each printed invoice line's PO line, in order; zero PO lines may be skipped."""
        out: list[POLine] = []
        pending = list(po.lines)
        for il in doc["lines"]:
            amount = sen(dec(il["amount"]))
            while pending and sen(pending[0].qty * pending[0].sell) != amount:
                skipped = pending.pop(0)
                if skipped.qty * skipped.sell != 0:
                    raise SeedError(
                        f"{doc['invoice_number']}: line {il['no']} ({amount}) skips priced "
                        f"PO line {skipped.line_number}"
                    )
            if not pending:
                raise SeedError(f"{doc['invoice_number']}: line {il['no']} matches no PO line")
            out.append(pending.pop(0))
        return out

    def invoice(self, doc: Doc, po: PurchaseOrder) -> Invoice:
        label = doc["invoice_number"]
        po_lines = self.match_lines(doc, po)
        untaxed = dec(doc["untaxed"])
        amounts = [sen(dec(il["amount"])) for il in doc["lines"]]
        free = [pl.item_type == "shipping" for pl in po_lines]
        if untaxed and sum((a for a, f in zip(amounts, free, strict=True) if f), ZERO) != untaxed:
            raise SeedError(f"{label}: untaxed {untaxed} is not the shipping lines")
        discount, ppn = dec(doc["discount"]), dec(doc["ppn"])
        goods = [a for a, f in zip(amounts, free, strict=True) if not f]
        nets_goods = iter(split_discount(goods, discount))
        nets = [a if f else next(nets_goods) for a, f in zip(amounts, free, strict=True)]
        taxed = [not f and ppn > 0 for f in free]
        dpp = dec(doc["dpp"])
        if sum((n for n, t in zip(nets, taxed, strict=True) if t), ZERO) != (dpp if ppn else 0):
            self.flag(label, "printed DPP is not the taxed lines after discount")
        rate = dec(doc["ppn_rate"])
        ppns = iter(split_total([n for n, t in zip(nets, taxed, strict=True) if t], ppn, rate))
        goods_total = sum(goods, ZERO)
        lines: list[InvLine] = []
        for i, (il, pl) in enumerate(zip(doc["lines"], po_lines, strict=True)):
            gross = sen(dec(il["unit_price"]))
            net_price = gross
            if not free[i] and discount and goods_total:
                net_price = sen(gross * (1 - discount / goods_total))
            service = (
                pl.item_type == "shipping"
                or (pl.product is not None and pl.product.kind == "service")
                or item_kind(il["description"]) == "service"
            )
            lines.append(
                InvLine(
                    id=0,
                    line_number=i + 1,
                    line_type=pl.item_type,
                    item_name=il["description"].strip(),
                    item_code=pl.item_code,
                    goods_or_service="J" if service else "B",
                    unit=canonical_unit(il.get("unit")) or pl.unit,
                    qty=sen(dec(il["qty"])),
                    unit_price=net_price,
                    gross_unit_price=gross,
                    dpp=nets[i],
                    dpp_nilai_lain=line_dpp(nets[i]) if taxed[i] else ZERO,
                    ppn_rate=APP_PPN_RATE if taxed[i] else ZERO,
                    ppn=next(ppns) if taxed[i] else ZERO,
                    po_line=pl,
                )
            )
        subtotal = sum(nets, ZERO)
        total = dec(doc["total"])
        if subtotal + ppn != total:
            self.flag(label, f"printed total {total} != lines after discount + PPN")
        due = text_or_none(doc["due_date"])
        buyer = doc.get("buyer") or {}
        name = text_or_none(buyer.get("name"))
        if name is None:
            raise SeedError(f"{label}: no buyer printed")
        return Invoice(
            original=label,
            po=po,
            invoice_date=date.fromisoformat(doc["invoice_date"]),
            due_date=date.fromisoformat(due) if due else None,
            subtotal=subtotal,
            total_discount=discount,
            dpp=dpp,
            dpp_nilai_lain=sum((ln.dpp_nilai_lain for ln in lines), ZERO),
            ppn=ppn,
            total=total,
            lines=lines,
            source=doc["source_file"],
            buyer_name=name,
            buyer_address=text_or_none(buyer.get("address")),
            buyer_npwp=npwp_digits(buyer.get("npwp")),
        )

    def client_details(self) -> None:
        """Each client's address and NPWP as its latest invoice prints them.

        Only an invoice billed to the client itself counts; one billed to
        another company keeps that buyer and says nothing of the client.
        """
        seen: dict[str, set[str]] = defaultdict(set)
        for inv in sorted(self.invoices, key=lambda i: (i.invoice_date, i.id)):
            client = inv.po.client
            if company_key(inv.buyer_name) != company_key(client.name):
                self.flag(inv.original, f"billed to {inv.buyer_name}, not {client.name}")
                continue
            if inv.buyer_address:
                client.address = inv.buyer_address
                seen[client.name].add(inv.buyer_address)
            if inv.buyer_npwp:
                if len(inv.buyer_npwp) == NPWP_DIGITS:
                    client.npwp = inv.buyer_npwp
                else:
                    self.flag(inv.original, f"NPWP {inv.buyer_npwp} is not {NPWP_DIGITS} digits")
        for name, addresses in sorted(seen.items()):
            if len(addresses) > 1:
                self.flag(name, f"{len(addresses)} printed addresses; kept the latest invoice's")

    # History
    def histories(self) -> None:
        po_of = {po.quotation.key: po for po in self.pos}
        for q in self.quotations:
            first = f"Revisi dari {q.parent.number}" if q.parent else "Quotation dibuat"
            ev: list[tuple[date, str | None, str, str | None, bool]] = [
                (q.date, None, "draft", first, False)
            ]
            if q.status == "cancelled":
                ev.append((q.date, "draft", "cancelled", UNPRICED_REASON, False))
            elif q.status != "draft":
                ev.append((q.date, "draft", "sent", None, False))
            if q.status == "revision":
                nxt = q.successor
                assert nxt is not None
                ev.append((nxt.date, "sent", "revision", f"Direvisi menjadi {nxt.number}", False))
            elif q.status == "accepted":
                ev.append((po_of[q.key].po_date, "sent", "accepted", None, False))
            elif q.status == "expired":
                days = q.validity_days or 0
                note = EXPIRY_NOTE.format(days=days, sent=q.date.strftime("%d-%m-%Y"))
                ev.append((q.date + timedelta(days=days), "sent", "expired", note, True))
            q.history = monotonic(ev)
        for po in self.pos:
            po.history = monotonic(
                [
                    (po.po_date, None, "PENDING", "PO dibuat", False),
                    (po.po_date, "PENDING", "UPLOADED", None, False),
                    (po.po_date, "UPLOADED", "ON_PROGRESS", None, False),
                    (po.dn_date, "ON_PROGRESS", "DELIVERED", None, False),
                ]
            )
        for inv in self.invoices:
            inv.history = monotonic([(inv.invoice_date, "draft", "sent", None, False)])
            inv.history[0].at += timedelta(minutes=1)

    # Masters, last
    def finish_masters(self) -> None:
        self.merge_contacts()
        for q in self.quotations:
            q.client.first_date = min(q.client.first_date, q.date)
        clients = sorted(
            (c for c in self.clients.values() if c.first_date != date.max),
            key=lambda c: (c.first_date, c.name),
        )
        for i, c in enumerate(clients, 1):
            c.id, c.number = i, f"{i:04d}"
        used: dict[str, Contact] = {}
        # An address shared across clients goes where it was used most.
        order = sorted(
            self.contacts.values(),
            key=lambda c: (-max(c.emails.values(), default=0), c.first_date, c.client.id, c.key),
        )
        for c in order:
            email = most_common(c.emails)
            if email and email in used:
                owner = used[email]
                self.flag(
                    f"{c.name} ({c.client.name})",
                    f"email {email} already on {owner.name} ({owner.client.name}); left blank",
                )
            elif email:
                c.email = email
                used[email] = c
        contacts = sorted(self.contacts.values(), key=lambda c: (c.client.id, c.first_date, c.key))
        for i, c in enumerate(contacts, 1):
            c.id = i
        for i, v in enumerate(
            sorted(self.vendors.values(), key=lambda v: (v.name.casefold(), v.key)), 1
        ):
            v.id = i
        for i, p in enumerate(sorted(self.products.values(), key=lambda p: p.pid), 1):
            p.id = i
        for q in self.quotations:
            for ln in q.lines:
                if ln.link is not None and ln.cost is not None and ln.cost > 0:
                    ln.link.priced.append((q.date, (q.seq, q.version), ln.line_number, ln.cost))
        links = sorted(self.links.values(), key=lambda lk: (lk.vendor.id, lk.product.id))
        for i, lk in enumerate(links, 1):
            lk.id = i
            if lk.priced:
                lk.cost = max(lk.priced)[3]

    def finish_totals(self) -> None:
        for q in self.quotations:
            q.totals = quotation_totals(q.lines, q.discount_pct)
            rec = q.staged or {}
            pdf = (rec.get("pdf") or {}).get("grand")
            unread = "pdf_lines_unread" in (rec.get("flags") or []) and pdf is not None
            if unread and abs(q.totals.grand - dec(pdf)) > 1:
                q.notes.append(f"Grand total tercetak (PDF): {rupiah(dec(pdf))}")
                q.causes.append("workbook edited after its PDF; the PDF table is unreadable")
            if q.printed_grand is None or abs(q.totals.grand - q.printed_grand) <= 1:
                continue
            q.notes.append(f"Grand total tercetak: {rupiah(q.printed_grand)}")
            if (rec.get("computed_totals") or {}).get("ppn_rate") == 0:
                q.causes.append("printed without PPN; the app always adds PPN")
            for r in rec.get("reconciliation") or []:
                cause = f"parser: {r['cause']}"
                if r.get("cause") and cause not in q.causes:
                    q.causes.append(cause)
            if not q.causes:
                q.causes.append("app arithmetic (per-line DPP Nilai Lain and PPN) vs printed")

    def build(self) -> Model:
        self.fill_dates()
        self.build_products()
        by_po = self.build_quotations()
        self.number_quotations()
        self.build_pos(by_po)
        self.build_invoices()
        self.client_details()
        self.histories()
        self.finish_masters()
        self.finish_totals()
        contacts = sorted(self.contacts.values(), key=lambda c: c.id)
        return Model(
            clients=sorted((c for c in self.clients.values() if c.id), key=lambda c: c.id),
            contacts=contacts,
            vendors=sorted(self.vendors.values(), key=lambda v: v.id),
            products=sorted(self.products.values(), key=lambda p: p.id),
            links=sorted(self.links.values(), key=lambda lk: lk.id),
            quotations=self.quotations,
            pos=self.pos,
            invoices=self.invoices,
            skipped=self.skipped,
            flagged=self.flagged,
            as_of=self.as_of,
        )


def build(inputs: Inputs | None = None, as_of: date = AS_OF) -> Model:
    """The seed model from the inputs on disk, or the given ones."""
    return Builder(inputs or load_inputs(), as_of).build()
