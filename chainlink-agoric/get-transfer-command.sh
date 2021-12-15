#! /bin/bash
set -e

TRANSFER_COINS=100000000urun

case $AG_NETWORK_CONFIG in
"")
  echo 1>&2 "You must set \$AG_NETWORK_CONFIG"
  exit 1
  ;;
/*) ncf=$(cat "$AG_NETWORK_CONFIG") ;;
*) ncf=$(curl -Ss "$AG_NETWORK_CONFIG") ;;
esac

chainName=$(echo "$ncf" | jq -r .chainName)
addr=$(cat chainlink/ag-cosmos-helper-address)

echo ag-cosmos-helper tx bank send provision "$addr" "$TRANSFER_COINS" --yes --chain-id=$chainName
