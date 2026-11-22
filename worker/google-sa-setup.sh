#!/bin/zsh
# SH | Google servisa konts Worker'im (Sheets API bez Apps Script). Palaist vienreiz. © VAITKEVIX, SIA
# Izveido projektu, ieslēdz Sheets API, servisa kontu + atslēgu, iedala «SH | Dati», ieliek Worker secret GOOGLE_SA. Atslēgas failu izdzēš.
set -e
SS=1mEKmDB9H1R9Vnp6if_CCq0_EtHE9gCuCZATScNd4B8w
G=~/google-cloud-sdk/bin/gcloud
KEY=$(mktemp -t shsa).json
trap 'rm -f "$KEY"' EXIT

if [ ! -x $G ]; then
  echo "→ Uzstādu Google Cloud CLI (~/google-cloud-sdk)…"
  [ "$(uname -m)" = arm64 ] && F=google-cloud-cli-darwin-arm.tar.gz || F=google-cloud-cli-darwin-x86_64.tar.gz
  curl -sSfL https://dl.google.com/dl/cloudsdk/channels/rapid/downloads/$F | tar -xz -C ~
fi

# gcloud vajag Python 3.10+ (macOS ir 3.9) — atsevišķs Python caur uv, sistēmu neaiztiek
if [ -z "$CLOUDSDK_PYTHON" ]; then
  if [ ! -x ~/.local/bin/uv ]; then echo "→ Uzstādu uv (Python pārvaldnieks)…"; curl -LsSf https://astral.sh/uv/install.sh | env UV_NO_MODIFY_PATH=1 sh >/dev/null; fi
  ~/.local/bin/uv python install 3.12 >/dev/null 2>&1 || true
  export CLOUDSDK_PYTHON=$(~/.local/bin/uv python find 3.12)
  echo "→ Python: $CLOUDSDK_PYTHON"
fi

echo "→ Pieslēdzies ar Google kontu, kam pieder «SH | Dati» (atvērsies pārlūks)…"
$G auth login --enable-gdrive-access --quiet

PROJ=sh-sistema-$(date +%y%m%d%H%M)
echo "→ Projekts $PROJ"
$G projects create $PROJ --name="SH sistema" --quiet
$G services enable sheets.googleapis.com drive.googleapis.com --project $PROJ --quiet
$G iam service-accounts create sh-worker --display-name="SH Worker" --project $PROJ --quiet
EMAIL=sh-worker@$PROJ.iam.gserviceaccount.com
sleep 5
$G iam service-accounts keys create "$KEY" --iam-account $EMAIL --project $PROJ --quiet

echo "→ Iedalu «SH | Dati» kontam $EMAIL (Redaktors)…"
TOK=$($G auth print-access-token)
if ! curl -sSf -X POST "https://www.googleapis.com/drive/v3/files/$SS/permissions?sendNotificationEmail=false" \
  -H "Authorization: Bearer $TOK" -H "x-goog-user-project: $PROJ" -H "Content-Type: application/json" \
  -d "{\"role\":\"writer\",\"type\":\"user\",\"emailAddress\":\"$EMAIL\"}" >/dev/null; then
  echo "!! Automātiski neizdevās. Iedali «SH | Dati» ar roku: Share → $EMAIL → Editor."
fi

echo "→ Ielieku atslēgu Worker (GOOGLE_SA)…"
cd ~/Documents/SH-projekts/portals/worker
~/.bun/bin/bunx wrangler secret put GOOGLE_SA < "$KEY"
echo "✓ Gatavs. Servisa konts: $EMAIL"
