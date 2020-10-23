#!/bin/bash

source ./internal-scripts/common.sh

add_jobspec() {
  title "Adding Jobspec #$1 to Chainlink node..."

  CL_URL="http://localhost:669$1"

  login_cl "$CL_URL"

  ACCOUNT_ID=$2

  payload=$(
    cat <<EOF
{
  "initiators": [
    {
      "type": "external",
      "params": {
        "name": "test-ei",
        "body": {
          "endpoint": "agoric-node"
        }
      }
    }
  ],
  "tasks": [
    {
      "type": "HTTPGet"
    },
    {
      "type": "JSONParse"
    },
    {
      "type": "Multiply"
    },
    {
      "type": "Agoric"
    }
  ]
}
EOF
  )

  echo -n "Posting..."
  while true; do
    JOBID=$(curl -s -b ./tmp/cookiefile -d "$payload" -X POST -H 'Content-Type: application/json' "$CL_URL/v2/specs" | jq -r '.data.id')
    [[ "$JOBID" == null ]] || break
    echo -n .
    sleep 5
  done
  echo " done!"

  echo "$JOBID 669$1" >> jobids.txt

  echo "Jobspec $JOBID has been added to Chainlink node"
  title "Done adding jobspec #$1"
}
