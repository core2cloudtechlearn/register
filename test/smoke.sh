#!/usr/bin/env bash
# Usage: test/smoke.sh http://localhost:3100 ADMIN_PASSWORD
# Runs a registration, a duplicate, validation errors, admin login, status update and CSV export.
B=${1:-http://localhost:3100}; PW=${2:-testpass123}; J='-H Content-Type:application/json'; JAR=$(mktemp); fail=0
ok(){ if [ "$2" = "$3" ]; then echo "PASS  $1"; else echo "FAIL  $1 (got $2, want $3)"; fail=1; fi; }
code(){ curl -s -o /dev/null -w '%{http_code}' "$@"; }
S=$RANDOM
R=$(curl -s $J -d "{\"category\":\"college_group\",\"name\":\"Priya K\",\"email\":\"priya$S@college.edu\",\"phone\":\"9812345678\",\"organisation\":\"SRM\",\"group_name\":\"CSE\",\"group_size\":12,\"consent\":true,\"source\":\"ig_bio\"}" $B/api/register)
ok "group of 12 priced 3588"       "$(echo "$R" | python -c 'import sys,json;print(json.load(sys.stdin).get("amount"))')" 3588
ok "duplicate email rejected"      "$(code $J -d "{\"category\":\"student\",\"name\":\"A B\",\"email\":\"PRIYA$S@college.edu\",\"phone\":\"9000000001\",\"organisation\":\"X\",\"consent\":true}" $B/api/register)" 409
ok "bad phone rejected"            "$(code $J -d '{"category":"student","name":"A B","email":"z@z.com","phone":"12","organisation":"X","consent":true}' $B/api/register)" 422
ok "admin blocked without login"   "$(code $B/api/admin/registrations)" 401
ok "wrong password rejected"       "$(code $J -d '{"password":"nope"}' $B/api/admin/login)" 401
ok "admin login"                   "$(code -c $JAR $J -d "{\"password\":\"$PW\"}" $B/api/admin/login)" 200
ROW=$(curl -s -b $JAR $B/api/admin/registrations | python -c "import sys,json;r=[x for x in json.load(sys.stdin)['rows'] if x['email']=='priya$S@college.edu'][0];print(r['id'],r['source'],r['group_size'],r['pay_status'])")
ok "row stored (id source size status)" "${ROW#* }" "ig_bio 12 pending"
ID=${ROW%% *}
ok "status update to contacted"    "$(code -b $JAR -X PATCH $J -d '{"pay_status":"contacted","notes":"called"}' $B/api/admin/registrations/$ID)" 200
ok "status persisted"              "$(curl -s -b $JAR $B/api/admin/registrations | python -c "import sys,json;print([x for x in json.load(sys.stdin)['rows'] if x['id']==$ID][0]['pay_status'])")" contacted
ok "csv export"                    "$(curl -s -b $JAR $B/api/admin/export.csv | grep -c "priya$S@college.edu")" 1
rm -f $JAR; exit $fail
