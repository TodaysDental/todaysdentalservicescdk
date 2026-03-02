#!/bin/bash

# =============================================================================
# Register Claims Users — All 27 Clinics
# =============================================================================
# Registers 7 staff members with the "Claims" role.
# Base pay is $0. Fee rates from salary spreadsheet (all same):
#   perClaimsPostedAmount: $20 | perEobsAttachedAmount: $10 | statusDeniedAmount: $10
#
# SMART LOGIC:
#   - If user does NOT exist → POST /register  (Claims role, all 27 clinics)
#   - If user ALREADY exists → GET existing roles + PUT merged roles
#       (preserves any existing Payment Posting entries and ADDS Claims entries)
#
# USAGE:
#   bash scripts/register-claims-users.sh
# =============================================================================

# ─── CONFIGURATION ───────────────────────────────────────────────────────────

JWT_TOKEN="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzd2FyYWpwYXJhbWF0YUBnbWFpbC5jb20iLCJlbWFpbCI6InN3YXJhanBhcmFtYXRhQGdtYWlsLmNvbSIsImdpdmVuTmFtZSI6InN3YXJhaiIsImZhbWlseU5hbWUiOiJwYXJhbWF0YSIsImlzU3VwZXJBZG1pbiI6dHJ1ZSwiaXNHbG9iYWxTdXBlckFkbWluIjp0cnVlLCJ0eXBlIjoiYWNjZXNzIiwiaWF0IjoxNzcyMjM5NjU2LCJpc3MiOiJUb2RheXNEZW50YWxJbnNpZ2h0cyIsImF1ZCI6ImFwaS50b2RheXNkZW50YWxpbnNpZ2h0cy5jb20iLCJleHAiOjE3NzIyNDMyNTZ9.CxouSS5g-N1hZkl5-0qxWIf6LlhN3yBjzU1tps6p5ok"

BASE_URL="https://apig.todaysdentalinsights.com/admin"

ALL_CLINIC_IDS=(
  "dentistinnewbritain"
  "dentistingreenville"
  "todaysdentalcayce"
  "creekcrossingdentalcare"
  "dentistinwinston-salem"
  "dentistincentennial"
  "renodentalcareandorthodontics"
  "todaysdentalalexandria"
  "todaysdentalgreenville"
  "todaysdentalwestcolumbia"
  "dentistinconcord"
  "dentistinedgewater"
  "lawrencevilledentistry"
  "dentistinlouisville"
  "dentistatsaludapointe"
  "dentistinoregonoh"
  "todaysdentallexington"
  "dentistinbowie"
  "dentistinpowellohio"
  "dentistinperrysburg"
  "dentistinaustin"
  "therimdentalcare"
  "dentistinbloomingdale"
  "dentistinvernonhills"
  "meadowsdentalcare"
  "dentistinstillwater"
  "pearlanddentalcare"
)

# Claims fee rates (same for all 7 users, from spreadsheet)
CLAIMS_PER_POSTED=20
CLAIMS_PER_EOB=10
CLAIMS_STATUS_DENIED=10

# ─── BUILD HELPERS ────────────────────────────────────────────────────────────

# Build a single Claims clinic JSON object for a given clinicId
claims_clinic_entry() {
  local clinic_id="$1"
  printf '{"clinicId":"%s","role":"Claims","basePay":0,"workLocation":{"isRemote":true,"isOnPremise":false},"perClaimsPostedAmount":%s,"perEobsAttachedAmount":%s,"statusDeniedAmount":%s,"moduleAccess":[{"module":"HR","permissions":["read","write","put","delete"]},{"module":"Finance","permissions":["read","write","put","delete"]}]}' \
    "$clinic_id" "$CLAIMS_PER_POSTED" "$CLAIMS_PER_EOB" "$CLAIMS_STATUS_DENIED"
}

# Build full Claims clinics JSON array (all 27)
build_claims_clinics_json() {
  local json="["
  local first=true
  for clinic_id in "${ALL_CLINIC_IDS[@]}"; do
    [ "$first" = true ] && first=false || json+=","
    json+=$(claims_clinic_entry "$clinic_id")
  done
  json+="]"
  echo "$json"
}

# ─── REGISTER (POST) ────────────────────────────────────────────────────────

try_register() {
  local email="$1" given="$2" family="$3"
  local clinics_json
  clinics_json=$(build_claims_clinics_json)

  local body
  body=$(printf '{"email":"%s","givenName":"%s","familyName":"%s","clinics":%s}' \
    "$email" "$given" "$family" "$clinics_json")

  curl -s -w "\n%{http_code}" \
    -X POST "$BASE_URL/register" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -d "$body"
}

# ─── GET EXISTING USER ───────────────────────────────────────────────────────

get_existing_user() {
  local encoded_email="${1/@/%40}"
  curl -s -w "\n%{http_code}" \
    -X GET "$BASE_URL/users/$encoded_email" \
    -H "Authorization: Bearer $JWT_TOKEN"
}

# ─── UPDATE (PUT) — MERGE EXISTING + NEW CLAIMS ─────────────────────────────

try_update_with_merge() {
  local email="$1" given="$2" family="$3"
  local encoded_email="${email/@/%40}"

  echo "  ℹ️  User already exists — fetching existing roles to merge..."

  # GET existing user
  local get_response get_code get_body
  get_response=$(get_existing_user "$email")
  get_code=$(echo "$get_response" | tail -n1)
  get_body=$(echo "$get_response" | sed '$d')

  if [ "$get_code" != "200" ]; then
    echo "  ❌  Could not fetch existing user ($get_code) — skipping merge, aborting."
    return
  fi

  # Extract existing clinicRoles JSON array using python3
  local existing_roles
  existing_roles=$(echo "$get_body" | python3 -c "
import sys, json
data = json.load(sys.stdin)
roles = data.get('clinicRoles', [])
print(json.dumps(roles))
" 2>/dev/null)

  if [ -z "$existing_roles" ]; then
    echo "  ⚠️  Could not parse existing roles — will PUT Claims-only."
    existing_roles="[]"
  fi

  # Merge: keep existing roles (e.g. Payment Posting) and append new Claims entries.
  # New Claims entries are added for clinics that don't yet have a Claims entry.
  # Uses python3 to do the merge cleanly.
  local merged_roles
  merged_roles=$(python3 -c "
import json, sys

existing = json.loads('''$existing_roles''')
clinic_ids = $(printf '"%s",' "${ALL_CLINIC_IDS[@]}" | sed 's/,$//; s/^/[/; s/$$/]/')
claims_fee_posted = $CLAIMS_PER_POSTED
claims_fee_eob    = $CLAIMS_PER_EOB
claims_fee_denied = $CLAIMS_STATUS_DENIED

# Build set of clinics that already have a Claims entry
existing_claims_clinics = {r['clinicId'] for r in existing if r.get('role') == 'Claims'}

# New Claims entries for clinics not already covered
new_claims = []
for cid in clinic_ids:
    if cid not in existing_claims_clinics:
        new_claims.append({
            'clinicId': cid,
            'role': 'Claims',
            'basePay': 0,
            'workLocation': {'isRemote': True, 'isOnPremise': False},
            'perClaimsPostedAmount': claims_fee_posted,
            'perEobsAttachedAmount': claims_fee_eob,
            'statusDeniedAmount': claims_fee_denied,
            'moduleAccess': [
                {'module': 'HR',      'permissions': ['read','write','put','delete']},
                {'module': 'Finance', 'permissions': ['read','write','put','delete']}
            ]
        })

merged = existing + new_claims
print(json.dumps(merged))
" 2>/dev/null)

  if [ -z "$merged_roles" ]; then
    echo "  ❌  Merge failed — skipping user."
    return
  fi

  local count
  count=$(echo "$merged_roles" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null)
  echo "  ℹ️  Merged role count: $count entries (existing + new Claims)"

  local put_body
  put_body=$(printf '{"givenName":"%s","familyName":"%s","clinicRoles":%s}' \
    "$given" "$family" "$merged_roles")

  local put_response put_code put_body_resp
  put_response=$(curl -s -w "\n%{http_code}" \
    -X PUT "$BASE_URL/users/$encoded_email" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -d "$put_body")

  put_code=$(echo "$put_response" | tail -n1)
  put_body_resp=$(echo "$put_response" | sed '$d')

  if [ "$put_code" == "200" ]; then
    echo "  ✅  SUCCESS ($put_code) — Claims role merged into existing profile"
  else
    echo "  ❌  PUT FAILED ($put_code)"
    echo "$put_body_resp" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('  error:', d.get('message','Unknown'))
" 2>/dev/null || echo "  $put_body_resp"
  fi
}

# ─── MAIN REGISTER FUNCTION ──────────────────────────────────────────────────

register_claims_user() {
  local email="$1" given="$2" family="$3"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  User    : $given $family ($email)"
  echo "  Fees    → Posted: \$$CLAIMS_PER_POSTED | EOB: \$$CLAIMS_PER_EOB | Status Denied: \$$CLAIMS_STATUS_DENIED"
  echo "  Clinics : ${#ALL_CLINIC_IDS[@]}  |  WorkLocation: Remote"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  echo "  Attempting POST /register..."
  local response http_code body_response
  response=$(try_register "$email" "$given" "$family")
  http_code=$(echo "$response" | tail -n1)
  body_response=$(echo "$response" | sed '$d')

  if [ "$http_code" == "200" ]; then
    echo "  ✅  REGISTERED ($http_code)"
    echo "$body_response" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('  userEmail:', d.get('userEmail', 'N/A'))
print('  message  :', d.get('message', ''))
" 2>/dev/null || echo "  $body_response"

  elif [ "$http_code" == "409" ]; then
    echo "  ⚠️  Already exists (409) — switching to merge+update flow..."
    try_update_with_merge "$email" "$given" "$family"

  else
    echo "  ❌  FAILED ($http_code)"
    echo "$body_response" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('  error:', d.get('message','Unknown'))
" 2>/dev/null || echo "  $body_response"
  fi
}

# ─── PREFLIGHT CHECK ─────────────────────────────────────────────────────────

if [ "$JWT_TOKEN" == "PASTE_YOUR_JWT_TOKEN_HERE" ]; then
  echo ""
  echo "❌  ERROR: JWT_TOKEN is not set. Open this script and paste your token."
  exit 1
fi

# ─── HEADER ──────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║   Claims User Registration — All 27 Clinics                      ║"
echo "║   Role: Claims  |  Base: \$0  |  Smart: register OR merge+update  ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
echo "  Clinics : ${#ALL_CLINIC_IDS[@]}"
echo "  Users   : 7"
echo ""
echo "  Rate table (from salary spreadsheet):"
echo "  ┌──────────────┬────────────────────────────────┬─────────┬──────┬────────┐"
echo "  │ Name         │ Email                          │ Posted  │ EOB  │ Denied │"
echo "  ├──────────────┼────────────────────────────────┼─────────┼──────┼────────┤"
echo "  │ Yukta        │ yuktasharma775@gmail.com       │   \$20   │ \$10  │  \$10   │"
echo "  │ Vaishnavi    │ mohanvaishu05@gmail.com        │   \$20   │ \$10  │  \$10   │"
echo "  │ Shiva        │ shivarana1849@gmail.com        │   \$20   │ \$10  │  \$10   │"
echo "  │ Logesh       │ logeshlogesh8374@gmail.com     │   \$20   │ \$10  │  \$10   │"
echo "  │ Muthu        │ muthuponraj2000@gmail.com      │   \$20   │ \$10  │  \$10   │"
echo "  │ Sai Krish    │ krishsaisam@gmail.com          │   \$20   │ \$10  │  \$10   │"
echo "  │ Suvetha      │ suvetha2351998@gmail.com       │   \$20   │ \$10  │  \$10   │"
echo "  └──────────────┴────────────────────────────────┴─────────┴──────┴────────┘"
echo ""

# ─── REGISTER ALL 7 USERS ────────────────────────────────────────────────────

register_claims_user "yuktasharma775@gmail.com"    "Yukta"     "Sharma"
register_claims_user "mohanvaishu05@gmail.com"     "Vaishnavi" "Mohan"
register_claims_user "shivarana1849@gmail.com"     "Shiva"     "Rana"
register_claims_user "logeshlogesh8374@gmail.com"  "Logesh"    "Logesh"
register_claims_user "muthuponraj2000@gmail.com"   "Muthu"     "Ponraj"
register_claims_user "krishsaisam@gmail.com"       "Sai"       "Krish"
register_claims_user "suvetha2351998@gmail.com"    "Suvetha"   "S"

# ─── DONE ────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════════╗"
echo "║   All done. Users log in via OTP sent to their email address.    ║"
echo "╚══════════════════════════════════════════════════════════════════╝"
echo ""
