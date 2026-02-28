#!/bin/bash

# =============================================================================
# Update Work Location → Remote for Payment Posting Users
# =============================================================================
# Patches the 5 already-registered payment posting users to set
# workLocation = { isRemote: true, isOnPremise: false } across all 27 clinics.
#
# USAGE:
#   bash scripts/update-payment-posting-worklocation.sh
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

# ─── HELPERS ─────────────────────────────────────────────────────────────────

update_user() {
  local email="$1"
  local given_name="$2"
  local family_name="$3"
  local od_fee="$4"
  local portal_fee="$5"
  local preauth_fee="$6"

  echo ""
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  Updating  : $given_name $family_name ($email)"
  echo "  Setting   : workLocation → Remote (isRemote: true, isOnPremise: false)"
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

  # Build clinics JSON with workLocation added
  clinics_json="["
  first=true
  for clinic_id in "${ALL_CLINIC_IDS[@]}"; do
    if [ "$first" = true ]; then
      first=false
    else
      clinics_json+=","
    fi
    clinics_json+=$(printf \
      '{"clinicId":"%s","role":"Payment Posting","basePay":0,"workLocation":{"isRemote":true,"isOnPremise":false},"perClaimFeeOpenDental":%s,"perClaimFeePortal":%s,"perPreAuthFee":%s,"moduleAccess":[{"module":"HR","permissions":["read","write","put","delete"]},{"module":"Finance","permissions":["read","write","put","delete"]}]}' \
      "$clinic_id" "$od_fee" "$portal_fee" "$preauth_fee")
  done
  clinics_json+="]"

  local body
  body=$(printf '{"givenName":"%s","familyName":"%s","clinics":%s}' \
    "$given_name" "$family_name" "$clinics_json")

  # URL-encode the email for the path param (replace @ with %40)
  local encoded_email="${email/@/%40}"

  echo "  Sending PUT /users/$email ..."
  local response http_code body_response
  response=$(curl -s -w "\n%{http_code}" \
    -X PUT "$BASE_URL/users/$encoded_email" \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer $JWT_TOKEN" \
    -d "$body")

  http_code=$(echo "$response" | tail -n1)
  body_response=$(echo "$response" | sed '$d')

  if [ "$http_code" == "200" ]; then
    echo "  ✅  SUCCESS ($http_code) — workLocation set to Remote"
  else
    echo "  ❌  FAILED ($http_code)"
    echo "$body_response" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print('  error:', d.get('message', 'Unknown error'))
" 2>/dev/null || echo "  $body_response"
  fi
}

# ─── PREFLIGHT CHECK ─────────────────────────────────────────────────────────

if [ "$JWT_TOKEN" == "PASTE_YOUR_JWT_TOKEN_HERE" ]; then
  echo ""
  echo "❌  ERROR: JWT_TOKEN is not set. Paste your token at the top of this script."
  exit 1
fi

# ─── HEADER ──────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   Update Work Location → Remote                              ║"
echo "║   Users: 5  |  Clinics: 27  |  Method: PUT /admin/users     ║"
echo "╚══════════════════════════════════════════════════════════════╝"

# ─── UPDATE USERS ────────────────────────────────────────────────────────────

update_user "miteshrawal1008@gmail.com"   "Mitesh"  "Rawal"    40 60 60
update_user "bhaveshrawal34@gmail.com"    "Bhavesh" "Rawal"    40 60 60
update_user "akilamanickam1993@gmail.com" "Akila"   "Manickam" 40 60 60
update_user "manishshaw7304@gmail.com"    "Manish"  "Shaw"     20 20 40
update_user "priyakamaraj18@gmail.com"    "Priya"   "Kamaraj"  20 25 20

# ─── DONE ────────────────────────────────────────────────────────────────────

echo ""
echo "╔══════════════════════════════════════════════════════════════╗"
echo "║   All users updated with Remote work location.               ║"
echo "╚══════════════════════════════════════════════════════════════╝"
echo ""
