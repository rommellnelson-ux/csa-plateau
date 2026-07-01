#!/usr/bin/env bash
# ════════════════════════════════════════════════════════
# Runner pgTAP (CI). Pour chaque fichier de test :
#   - substitue REMPLACER_UUID_CHEF par l'UUID du chef seedé ;
#   - l'exécute via psql ;
#   - ÉCHOUE si psql renvoie une erreur OU si une assertion « not ok » apparaît.
# Les fichiers éditeur (UNION ALL) sortent des lignes « ok N - » / « not ok N - » ;
# le fichier e2e (plan/finish) sort le bilan TAP.
# Variables : PSQL (commande psql, défaut « psql »), CHEF_UUID.
# ════════════════════════════════════════════════════════
set -uo pipefail

PSQL="${PSQL:-psql}"
CHEF_UUID="${CHEF_UUID:-00000000-0000-0000-0000-000000000001}"

FILES=(
  supabase/tests/test_validate_event.sql
  supabase/tests/test_commit_group.sql
  supabase/tests/test_commit_group_e2e.sql
)

fail=0
for f in "${FILES[@]}"; do
  echo "──────── ${f} ────────"
  out=$(sed "s/REMPLACER_UUID_CHEF/${CHEF_UUID}/g" "${f}" \
        | ${PSQL} -v ON_ERROR_STOP=1 -X -q -t -A -f - 2>&1)
  rc=$?
  echo "${out}"
  if [ "${rc}" -ne 0 ]; then
    echo "❌ ERREUR psql (${f})"; fail=1; continue
  fi
  if grep -Eq '(^|[^[:alnum:]_])not ok' <<<"${out}"; then
    echo "❌ ÉCHEC pgTAP (${f})"; fail=1
  else
    echo "✅ ${f} — OK"
  fi
done

if [ "${fail}" -ne 0 ]; then echo "== pgTAP : ÉCHEC =="; exit 1; fi
echo "== pgTAP : tous verts =="
