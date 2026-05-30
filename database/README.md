# Database Setup

## Supabase (Primary)

**Project URL:** https://supabase.com/dashboard/project/nraxsxvjjffgrmfukjqf

### Setup Instructions

1. Go to Supabase Dashboard → SQL Editor
2. Copy and paste the contents of `schema.sql`
3. Run the SQL to create tables

### Tables

| Table | Purpose |
|-------|---------|
| `calls` | All call records from Bland.ai |
| `leads` | Qualified leads extracted from calls |
| `sms_messages` | SMS conversation history |
| `stats` | Aggregated daily statistics |

### Auto-Stats

A trigger automatically updates the `stats` table whenever a new call is inserted.

## Google Sheets (Backup)

**Sheet ID:** `1vLZhu75iyDFFVjQsUNHpiwDzIraEiXO5nVhdxPOUMfI`

Tabs:
- `All Calls` - Every call
- `Prospects` - New leads
- `Customers` - Existing clients
- `SSV`, `O1dMatch`, `IGTA`, `Aventus`, `DC Federal` - Brand-specific

## Airtable (CRM)

**Base ID:** `appszSjjktezttn6F`
**Table:** `Leads`

Used for CRM-style lead management with status tracking.
