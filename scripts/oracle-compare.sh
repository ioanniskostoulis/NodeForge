#!/bin/sh
# Compare every circuit in a list against its official CircuitJS recording (see scripts/oracle.mjs).
#   sh scripts/oracle-compare.sh tests/oracle/oracle-all.txt
# Prints one line per circuit: name, MATCH/DIFFER, worst absolute error.
status=0
while IFS= read -r f || [ -n "$f" ]; do
  [ -n "$f" ] || continue
  n=$(basename "$f" .txt)
  if [ ! -f "tests/oracle/recordings/$n.json" ]; then echo "$n NO-RECORDING"; status=1; continue; fi
  r=$(node build/nfsim.cjs compare "$f" "tests/oracle/recordings/$n.json" 2>&1)
  code=$?
  st=$(echo "$r" | grep -o "^MATCH\|^DIFFER\|^stopped\|element count differs" | head -1)
  mx=$(echo "$r" | grep -o "max |err| over all posts: [0-9.e+-]*" | awk '{print $NF}')
  if [ "$code" -gt 1 ] || [ -z "$st" ]; then status=1; fi
  echo "$n ${st:-ERROR} $mx"
done < "$1"
exit "$status"
