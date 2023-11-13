#!/bin/sh
set -e

[[ -e baedeker ]] || (curl -L https://github.com/UniqueNetwork/baedeker/releases/download/v0.1.0-rc1/baedeker -o baedeker && chmod +x baedeker)
[[ -e vendor/baedeker-library ]] || (mkdir -p vendor && git clone https://github.com/UniqueNetwork/baedeker-library vendor/baedeker-library)

BDK_DIR=$(dirname $(readlink -f "$0"))
RUST_LOG=info baedeker --spec=docker -J$BDK_DIR/vendor/ --generator=docker_compose=$BDK_DIR/.bdk-env --generator=docker_compose_discover=$BDK_DIR/.bdk-env/discover.env --secret=file=$BDK_DIR/.bdk-env/secret  --tla-str=relay_spec=rococo-local --input-modules='lib:baedeker-library/ops/nginx.libsonnet' --input-modules='lib:baedeker-library/ops/devtools.libsonnet' --tla-str=repoDir=$(realpath $BDK_DIR/..) $@ $BDK_DIR/rewrites.jsonnet
cd $BDK_DIR/.bdk-env
docker compose up -d --wait --remove-orphans
