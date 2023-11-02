local dotenv = {
    [std.splitLimit(line, "=", 2)[0]]: std.splitLimit(line, "=", 2)[1]
    for line in std.split(importstr "../.env", "\n")
    if line != ""
    if std.member(line, "=")
};

function(prev, repoDir)
(import 'baedeker-library/ops/rewrites.libsonnet').rewriteNodePaths({
	'bin/polkadot':{dockerImage:'uniquenetwork/builder-polkadot:%s' % dotenv.POLKADOT_MAINNET_BRANCH},
	'bin/unique':'%s/target/release/unique-collator' % dotenv.UNIQUE_CHAIN_REPO,
	'bin/acala':'%s/target/release/acala' % dotenv.ACALA_CHAIN_REPO,
})(prev)
