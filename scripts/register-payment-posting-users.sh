#!/bin/bash

# =============================================================================
# Register Payment Posting Users — All 27 Clinics
# =============================================================================
# Registers 5 staff members with "Payment Posting" role across every clinic
# defined in src/infrastructure/configs/clinic-config.json.
# Base pay is $0 (salary is purely fee-based, per the spreadsheet).
#
# USAGE:
#   1. Set JWT_TOKEN below (grab from browser DevTools → any API request
#      → Authorization header, strip the "Bearer " prefix)
#   2. Run: bash scripts/register-payment-posting-users.sh
# =============================================================================

# ─── CONFIGURATION ───────────────────────────────────────────────────────────

JWT_TOKEN="eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJzd2FyYWpwYXJhbWF0YUBnbWFpbC5jb20iLCJlbWFpbCI6InN3YXJhanBhcmFtYXRhQGdtYWlsLmNvbSIsImdpdmVuTmFtZSI6InN3YXJhaiIsImZhbWlseU5hbWUiOiJwYXJhbWF0YSIsImlzU3VwZXJBZG1pbiI6dHJ1ZSwiaXNHbG9iYWxTdXBlckFkbWluIjp0cnVlLCJ0eXBlIjoiYWNjZXNzIiwiaWF0IjoxNzcyMjM5NjU2LCJpc3MiOiJUb2RheXNEZW50YWxJbnNpZ2h0cyIsImF1ZCI6ImFwaS50b2RheXNkZW50YWxpbnNpZ2h0cy5jb20iLCJleHAiOjE3NzIyNDMyNTZ9.CxouSS5g-N1hZkl5-0qxWIf6LlhN3yBjzU1tps6p5ok"

API_URL="https://apig.todaysdentalinsights.com/admin/register"

# All 27 clinic IDs from clinic-config.json
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

# ─── HELPERS ─────────────────────────────────────────────────────────────────

register_user() {
  local email="$1"
  local given_name="$2"
  local family_name="$3"
  local od_fee="$4"       # perClaimFeeOpenDental
  local portal_fee="$5"   # perClaimFeePortal
  local preauth_fee="$6"  # perPreAuthFee

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Registering : $given_name $family_name"
  echo "  Email       : $email"
  echo "  Fees        → OD: \$$od_fee | Portal: \$$portal_fee | PreAuth: \$$preauth_fee"
  echo "  Clinics     : ${#ALL_CLINIC_IDS[@]} clinics"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Build clinics JSON array from ALL_CLINIC_IDS
  clinics_json="["
  first=true
  for clinic_id in "${ALL_CLINIC_IDS[@]}"; do
    if [ "$first" = true ]; then
      first=false
    else
      clinics_json+=","
    fi
    clinics_json+=$(printf '{"clinicId":"%s","role":"Payment Posting","basePay":0,"workLocation":{"isRemote":true,"isOnPremise":false},"perClaimFeeOpenDental":%s,"perClaimFeePortal":%s,"perPreAuthFee":%s,"moduleAccess":[{"module":"HR","permissions":["read","write","put","delete"]},{"module":"Finance","permissions":["read","write","put","delete"]}]}' \
      "$clinic_id" "$od_fee" "$portal_fee" "$preauth_fee")
  done
  clinics_json+="]"

  local body
  body=$(printf '{"email":"%s","givenName":"%s","familyName":"%s","clinics":%s}' \
    "$email" "$given_name" "$family_name" "$clinics_json")

  echo "  Sending request..."
  local response http_code body_response
  response=$(curl -s -w "\n%{http_code}" \
    -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -d "$body")

  http_code=$(echo "$response" | tail -n1)
  body_response=$(echo "$response" | sed '$d')

  if [ "$http_code" == "200" ]; then
    echo "  ✅  SUCCESS ($http_code)"
    echo "$body_response" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('  userEmail :', d.get('userEmail', 'N/A'))
print('  message   :', d.get('message', ''))
" 2>/dev/null || echo "  $body_response"
  else
    echo "  ❌  FAILED ($http_code)"
    echo "$body_response" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('  error     :', d.get('message', 'Unknown error'))
" 2>/dev/null || echo "  $body_response"
  fi
}

# ─── PREFLIGHT CHECK ─────────────────────────────────────────────────────────

if [ "$JWT_TOKEN" == "PASTE_YOUR_JWT_TOKEN_HERE" ]; then
  echo ""
  echo "❌  ERROR: JWT_TOKEN is not set."
  echo "    Open this script and paste your token on the JWT_TOKEN line."
  exit 1
fi

# ─── HEADER ──────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   Payment Posting User Registration                          ║"
echo "║   Role: Payment Posting  |  Base Pay: \$0  |  All Clinics    ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
echo "  Clinic count : ${#ALL_CLINIC_IDS[@]}"
echo "  Users        : 5"
echo ""

# ─── REGISTER USERS ──────────────────────────────────────────────────────────
#
#  Rate table (from salary spreadsheet):
#  ┌──────────┬────────────────────────────────┬──────┬────────┬─────────┐
#  │ Name     │ Email                          │  OD  │ Portal │ PreAuth │
#  ├──────────┼────────────────────────────────┼──────┼────────┼─────────┤
#  │ Mitesh   │ miteshrawal1008@gmail.com      │  $40 │   $60  │    $60  │
#  │ Bhavesh  │ bhaveshrawal34@gmail.com       │  $40 │   $60  │    $60  │
#  │ Akila    │ akilamanickam1993@gmail.com    │  $40 │   $60  │    $60  │
#  │ Manish   │ manishshaw7304@gmail.com       │  $20 │   $20  │    $40  │
#  │ Priya    │ priyakamaraj18@gmail.com       │  $20 │   $25  │    $20  │
#  └──────────┴────────────────────────────────┴──────┴────────┴─────────┘

register_user "miteshrawal1008@gmail.com"   "Mitesh"  "Rawal"    40 60 60
register_user "bhaveshrawal34@gmail.com"    "Bhavesh" "Rawal"    40 60 60
register_user "akilamanickam1993@gmail.com" "Akila"   "Manickam" 40 60 60
register_user "manishshaw7304@gmail.com"    "Manish"  "Shaw"     20 20 40
register_user "priyakamaraj18@gmail.com"    "Priya"   "Kamaraj"  20 25 20

# ─── DONE ────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   All registrations complete.                                 ║"
echo "║   Users log in via OTP sent to their listed email address.   ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
