#! /bin/bash
set -e

# Create the Agoric CLI in $HOME/bin/agoric.
export PATH=$HOME/bin:$PATH
test -f $HOME/bin/agoric || (cd /usr/src/agoric-sdk && yarn create-agoric-cli $HOME/bin/agoric)

case $AG_NETWORK_CONFIG in
/*) ncf=$(cat "$AG_NETWORK_CONFIG") ;;
*) ncf=$(curl -Ss "$AG_NETWORK_CONFIG") ;;
esac

origRpcAddrs=( $(echo "$ncf" | jq -r '.rpcAddrs | join (" ")' ) )

rpcAddrs=(${origRpcAddrs[@]})
rp=
while [[ ${#rpcAddrs[@]} -gt 0 ]]; do
  r=$(( $RANDOM % ${#rpcAddrs[@]} ))
  selected=${rpcAddrs[$r]}
  rpcAddrs=( ${rpcAddrs[@]/$selected} )

  if curl -s http://$selected/status > /dev/null; then
    # Found an active node.
    rp=$selected
    break
  fi
done

if test -z "$rp"; then
  echo "Cannot find an active node; last tried $selected"
  exit 1
fi

chainName=$(echo "$ncf" | jq -r .chainName)
addr=$(cat chainlink/ag-cosmos-helper-address)

erun() {
  echo ${1+"$@"}
  out=$("$@" 2>&1)
  status=$?
  echo "$out" | head -1
  return $status
}

while ! ag-cosmos-helper query swingset egress "$addr" --node=tcp://$rp; do
  echo "Try: ag-cosmos-helper tx swingset provision-one ag-solo$1 $addr --yes --chain-id=$chainName"
  sleep 5
done

HOSTPORT="localhost:689$1"
if ${2-false}; then
  agoric deploy --hostport="$HOSTPORT" /usr/src/dapp-oracle/contract/deploy.js

  echo "dapp-oracle contract has been installed"
fi

INSTALL_ORACLE="Chainlink #$1" agoric deploy --hostport="$HOSTPORT" \
  /usr/src/dapp-oracle/api/deploy.js
echo "dapp-oracle API for Chainlink #$1 has been installed"
