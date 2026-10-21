---
name: gst-india
description: Indian GST know-how for the AZAD EV ERP — how a senior CA reads a dealer's GST data: tax invoices (Rule 46), value of supply (discount, exchange, pure-agent RTO/insurance), place of supply, CGST/SGST vs IGST, B2B vs B2C, credit notes (s.34), GSTR-1 tables (B2B, B2CL, B2CS, CDNR/CDNUR, HSN, documents issued) and their GST Offline Tool sheet layout, GSTR-3B tables (3.1, 3.2, 4 ITC, 5), ITC conditions (s.16/17(5)), due dates and period locking. Use before building or changing anything that computes, stores, reports or exports GST (the GST module, invoices, credit notes, purchases/ITC).
---

# GST for an EV two-wheeler dealer — what the software must get right

This is the reference a senior Chartered Accountant would apply when reviewing the app's GST data. It is a
working summary, not legal advice: **rates, thresholds and return layouts change by notification — when a
number below drives code, keep it configurable or confirm it with the company's CA, and say so in the UI.**

## 1. The business
- A showroom in one state (registered GSTIN, state code = first 2 digits of the GSTIN, e.g. 24 = Gujarat) selling
  electric scooters (HSN 8711 60, 5%), accessories (rates by HSN — mostly 18%; some 5%/12%-era items changed in the
  2025 rate rationalisation: always read the rate from the product's classification, never hard-code), spare
  parts and service labour (SAC 9987, 18%), and earning RTO / insurance amounts collected on the customer's behalf.
- Customers are mostly unregistered individuals (B2C). Occasionally a business buys with its GSTIN (B2B).
- Purchases: scooters and accessories from manufacturers/distributors (input tax credit, ITC), expenses with GST bills.

## 2. Tax invoice (CGST Rules, Rule 46) — what must be on it and never change
- Consecutive serial number, unique for the **financial year (April–March)**, max 16 characters (letters, digits,
  `-` `/`). Never reuse or renumber; a cancelled invoice keeps its number and is reported as cancelled.
- Date; supplier name, address, GSTIN; recipient name/address; **recipient GSTIN if registered (B2B)**; for an
  unregistered recipient with taxable value ≥ ₹50,000: name, address and delivery address with state name & code.
- HSN/SAC per line (digits per turnover — see §6), description, quantity + unit (UQC: scooters `NOS`), taxable
  value, rate, CGST + SGST (intra-state) or IGST (inter-state), place of supply (state name + code) for inter-state.
- Once issued an invoice is a legal document: correct it only with a **credit/debit note (s.34)** or, if it was never
  valid, by cancelling it (same month, before it is reported) and issuing a new one. Software must keep the original
  figures immutable (this app: `Sale` + `TaxSnapshot`/`TaxSnapshotLine` are immutable) and record every reissue.
- E-invoicing (IRN + QR) is compulsory once aggregate turnover in any FY since 2017-18 exceeds ₹5 crore. E-way bill
  for movement of goods > ₹50,000 (state rules vary). Flag these as not handled unless built.

## 3. Value of supply (s.15) — the dealer's tricky lines
- **Discount shown on the invoice at the time of supply reduces the taxable value** (s.15(3)(a)). A later discount
  reduces it only via a credit note, if agreed beforehand and ITC reversed by the buyer.
- **Exchange of the old vehicle is consideration in kind, not a discount**: the taxable value is the full price;
  the exchange value only reduces what the customer pays. (Some dealers wrongly net it — keep it a configurable
  treatment and default to "does not reduce taxable value".)
- **Pure agent (Rule 33)**: RTO registration fees, road tax and insurance premium paid in the customer's name and
  shown separately are not part of the value of supply — no GST, not reported as outward supply. Handling charges
  the dealer keeps are taxable (18%).
- Extended warranty sold by the dealer is a service (18%); if sold as the manufacturer's agent, treat per contract.
- Prices are usually **GST-inclusive** in a showroom: taxable = gross × 100 / (100 + rate); round each tax to paise,
  then the invoice total to the rupee with a separate round-off line.

## 4. Place of supply and CGST/SGST vs IGST
- Goods sold over the counter / delivered at the showroom: place of supply = showroom's state → **intra-state:
  CGST + SGST** (half rate each), even if the buyer lives elsewhere (s.10(1)(a)/(c) IGST Act).
- Goods delivered to another state on the dealer's account, or a B2B buyer billed with another state's GSTIN where
  goods move there → **inter-state: IGST**.
- Services (labour): generally the recipient's location for B2B, the supplier's location for B2C.
- State is always a 2-digit code + name in returns (`24-Gujarat`); `97` = Other Territory.

## 5. Credit notes and debit notes (s.34)
- Issue for a sales return, a post-sale price reduction, or an excess charge. Reference the original invoice.
- Last date to declare: the earlier of **30 November after the end of the FY** of the invoice, or the annual return
  filing date. After that the output tax cannot be reduced.
- Reporting: to a registered buyer → GSTR-1 **CDNR**; to an unregistered buyer against a B2CL invoice → **CDNUR**;
  against B2C small invoices → net off in **B2CS** of the month the note is issued.

## 6. GSTR-1 (outward supplies) — monthly by the 11th (QRMP: quarterly by the 13th, optional IFF for B2B)
Tables and the matching **GST Offline Tool** sheet (export these columns, in this order):

| Table | Sheet | Rows | Columns |
|---|---|---|---|
| 4A B2B | `b2b` | one row per invoice × rate | GSTIN/UIN of Recipient · Receiver Name · Invoice Number · Invoice date (dd-mmm-yyyy) · Invoice Value · Place Of Supply · Reverse Charge (N) · Applicable % of Tax Rate · Invoice Type (Regular B2B) · E-Commerce GSTIN · Rate · Taxable Value · Cess Amount |
| 5 B2CL | `b2cl` | **inter-state** invoices to unregistered buyers with invoice value **> ₹1,00,000** (was ₹2.5 lakh before Aug 2024) | Invoice Number · Invoice date · Invoice Value · Place Of Supply · Applicable % of Tax Rate · Rate · Taxable Value · Cess Amount · E-Commerce GSTIN |
| 7 B2CS | `b2cs` | all other B2C, **aggregated by place of supply + rate**, net of B2C credit notes | Type (OE) · Place Of Supply · Rate · Applicable % of Tax Rate · Taxable Value · Cess Amount · E-Commerce GSTIN |
| 9B CDNR | `cdnr` | credit/debit notes to registered buyers | GSTIN/UIN of Recipient · Receiver Name · Note Number · Note Date · Note Type (C/D) · Place Of Supply · Reverse Charge · Note Supply Type · Note Value · Applicable % of Tax Rate · Rate · Taxable Value · Cess Amount |
| 9B CDNUR | `cdnur` | notes to unregistered buyers against B2CL invoices | UR Type (B2CL) · Note Number · Note Date · Note Type · Place Of Supply · Note Value · Applicable % of Tax Rate · Rate · Taxable Value · Cess Amount |
| 8 Nil/exempt/non-GST | `exemp` | totals by inter/intra × registered/unregistered | Description · Nil Rated Supplies · Exempted (other than nil rated/non GST supply) · Non-GST Supplies |
| 12 HSN summary | `hsn(b2b)` / `hsn(b2c)` (split since 2025) | per HSN × rate | HSN · Description · UQC · Total Quantity · Total Value · Rate · Taxable Value · Integrated Tax Amount · Central Tax Amount · State/UT Tax Amount · Cess Amount |
| 13 Documents issued | `docs` | per document series | Nature of Document · Sr. No. From · Sr. No. To · Total Number · Cancelled |

- HSN digits in Table 12: **4 digits** if aggregate turnover in the previous FY ≤ ₹5 crore, **6 digits** above
  (chosen from the portal's HSN list).
- Amounts in rupees with 2 decimals; dates `dd-mmm-yyyy` in the Excel template (`dd-mm-yyyy` in the JSON).
- Return period `MMYYYY`. A filed GSTR-1 cannot be edited — later corrections go in the amendment tables (9A/9C)
  of a later month. So the app must **lock a period once its return is filed** and show anything changed after.

## 7. GSTR-3B (summary + tax payment) — monthly by the 20th (QRMP: 22nd/24th by state)
- **3.1(a)** outward taxable supplies (not zero-rated/nil/exempt): taxable value, IGST, CGST, SGST, cess — net of
  credit notes. **3.1(c)** nil-rated/exempt. **3.1(e)** non-GST outward supplies (pure-agent amounts are not
  supplies at all and are usually left out; agree with the CA).
- **3.2** inter-state supplies to unregistered persons, by place of supply (auto-filled from GSTR-1 and locked
  on the portal from 2025 — so GSTR-1 must be right).
- **4** ITC: 4(A)(5) all other ITC (from GSTR-2B), 4(B) reversals (Rule 42/43, s.17(5) blocked credits),
  4(C) net ITC, 4(D) ineligible. **5** exempt/nil/non-GST inward supplies.
- **6.1** tax payable − ITC utilised (IGST first, then CGST/SGST per s.49A/49B) = cash to pay. Interest 18% p.a. on late cash tax.

## 8. Input tax credit (purchases)
- Conditions (s.16): tax invoice in hand, goods/services received, supplier has filed and the invoice appears in the
  buyer's **GSTR-2B**, tax paid to the supplier within **180 days** of the invoice (else reverse with interest),
  claimed by 30 November of the next FY.
- Blocked (s.17(5)): motor vehicles for own use (a dealer's stock-in-trade is NOT blocked), food, club, personal
  use, works contracts for immovable property, etc. Expense categories should carry an "ITC eligible" flag.
- A purchase register must keep: supplier GSTIN + name + state, bill number, bill date, taxable value, rate,
  IGST/CGST/SGST, eligible vs ineligible, and the period claimed — so it can be matched against GSTR-2B.

## 9. Review checklist (what the CA checks before filing)
1. Every invoice in the period has a GST breakdown; none missing, none duplicated; serials consecutive (gaps
   explained by cancellations).
2. B2B invoices have a valid GSTIN (15 chars, state code + PAN + check digit) and the right place of supply.
3. Rates and HSN per line match the item; scooters 5%; RTO/insurance not taxed when pure agent.
4. Discount reduces taxable value; exchange does not (unless the company's CA decided otherwise).
5. Credit notes in the period are against invoices of this or an earlier period and within the s.34 time limit.
6. GSTR-1 totals = GSTR-3B 3.1(a) totals = books (sales register) — show the reconciliation.
7. ITC claimed ≤ ITC in GSTR-2B; blocked credits excluded.
8. After filing: lock the period; any later change appears as an amendment to report next month.

## 10. Where this lives in the AZAD EV app
- Scooter invoice GST: `api/src/modules/tax/*` (engine, effective-dated `TaxRate`, `TaxClassification` = HSN/SAC,
  `TaxComponentMapping` per price component, immutable `TaxSnapshot`/`TaxSnapshotLine` per `Sale`).
- Other outward documents and inward records: see the GST module's design notes (release/3.7) before adding sources.
- Money is stored in paise (`BigInt`); format with `formatInrExact`; business dates in the company time zone
  (`api/src/common/utils/business-date.ts`).
