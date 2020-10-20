#!/bin/bash

source ./internal-scripts/common.sh

add_dapp_oracle() {
  HOSTPORT="localhost:689$1"

  title "Installing dapp-oracle contract..."

  docker exec chainlink-agoric_ag-solo-node$1_1 /usr/src/dapp-oracle/chainlink-agoric/deploy-dapp.sh $1 ${2-false}

  echo "dapp-oracle has been added to Agoric node"
  title "Done adding dapp-oracle #$1"
}
