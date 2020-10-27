#!/bin/bash
set -e
source ./internal-scripts/common.sh

add_dapp_oracle() {
  HOSTPORT="localhost:689$1"
  AG_COSMOS_HELPER_OPTS=${AG_COSMOS_HELPER_OPTS-"--from=provision --keyring-dir=$PWD/../_agstate/keys --keyring-backend=test"}

  title "Provisioning ag-solo$1..."
  cmd=$(docker exec chainlink-agoric_ag-solo-node$1_1 /usr/src/dapp-oracle/chainlink-agoric/get-provision-command.sh $1)
  $cmd $AG_COSMOS_HELPER_OPTS

  title "Installing dapp-oracle contract..."

  docker exec chainlink-agoric_ag-solo-node$1_1 /usr/src/dapp-oracle/chainlink-agoric/deploy-dapp.sh $1 ${2-false}

  echo "dapp-oracle has been added to Agoric node"
  title "Done adding dapp-oracle #$1"
}
