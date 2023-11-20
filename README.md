# xnft-tests

This repository contains the tests related to XCM NFTs for various networks.

It uses Unique Network's `baedeker` tool to set up the test networks.
Also, [direnv](https://direnv.net/) is used to load all the needed environment variables automatically, such as:
* `RELAY_POLKADOT_BRANCH` containing the version of the relaychain runtime used in tests
* `<NETWORK_NAME>_URL` containing the running test network's URL 
* `<NETWORK_NAME>_ID` containing the parachain ID of the test network (if it is not the relay chain)

## How to use it locally

1. Install [direnv](https://direnv.net/).
2. `cd` into the `xnft-tests`.
You'll see the following prompt from `direnv`:
    ```
    direnv: error <PATH TO xnft-tests>/.envrc is blocked. Run `direnv allow` to approve its content
    ```
3. Run `direnv allow`

4. To run the test networks, `baedeker` needs their binaries. There are two ways to provide them:
    * Set the corresponding environment variable in the `.env` file to the path of the binary.

        This option is suitable for testing while developing a new feature of the needed network.

        Example: providing Quartz binary
        ```
        # .env
        QUARTZ_BINARY=/path/to/unique-chain/target/release/unique-collator
        ```

    * Use a docker image: modify the `.baedeker/rewrites.jsonnet` file and provide the docker image instead of a path to a binary.
    By default, the relay chain's binary is provided using this option. See `.baedeker/rewrites.jsonnet` for details.

        **Important**: the `baedeker` won't pull the needed docker image by itself. You need to run `docker pull <IMAGE>` for all your images before running `baedeker`.

        <details>
            <summary>Example of the error message when the relay chain's image is absent</summary>

            ERROR baedeker: runtime error: spec builder: docker finished with non-zero exit code; spec dumped to ""
            Command was: "timeout" "-s" "INT" "25" "docker" "run" "--rm" "-e" "RUST_LOG=debug" "-e" "RUST_BACKTRACE=full" "-e" "COLORBT_SHOW_HIDDEN=1" "--pull" "never" "uniquenetwork/builder-polkadot:release-v1.0.0" "build-spec" "--base-path" "/tmp/node" "--chain" "rococo-local"
                vendor/baedeker-library/inputs/base.libsonnet:14:63-100:     function <builtin_process_spec> call
                <build spec for relay>
                vendor/baedeker-library/inputs/base.libsonnet:14:12-101:     function <builtin_description> call
                vendor/baedeker-library/outputs/compose.libsonnet:99:61-70:  field <specJson> access
                argument <value> evaluation
                vendor/baedeker-library/outputs/compose.libsonnet:99:36-101: function <builtin_manifest_json_ex> call
        </details>


5. `cd` into the `.baedeker` directory
6. If you didn't pull the relay chain's image, you need to run the following
    ```
    docker pull uniquenetwork/builder-polkadot:$RELAY_POLKADOT_BRANCH
    ```

    **Important**: If you're using additional docker images, you need to pull them as well.

7. Run `./up.sh ./testnets.jsonnet`
Wait until the following prompt appears:
    ```
    Baedeker env updated
    Enjoy your baedeker networks at http://<IP ADDRESS>/
    ```

    You can follow the link from the prompt, where you will find links to a polkadotjs/apps UI of each test network.

8. Run `yarn` to install dependencies.

9. Run the needed tests.
Examples: 
    * Run the `quartz-karura` test:
        ```
        yarn quartz-karura
        ```
    * Run all tests related to Quartz:
        ```
        yarn all-quartz
        ```
    * Run all tests related to Karura:
        ```
        yarn all-karura
        ```

10. When you don't need the test networks anymore, you can shut them down by running `./down` in the `.baedeker` directory.

11. If need the test networks again with the same binaries, you can just run then: `./up.sh ./testnets.jsonnet`.

### How to get the logs

By default, all networks' nodes run with the `-lxcm=trace` argument.

When you start the test networks, you will see that each node defined in the `testnets.json` has its own docker container.

By typing `docker ps` you can see them.

The example output:
```
CONTAINER ID   IMAGE                                           COMMAND                  CREATED         STATUS         PORTS     NAMES
5e7fe845589b   nginx:latest                                    "/docker-entrypoint.…"   6 seconds ago   Up 3 seconds   80/tcp    bdk-env-nginx-1
13a00167b251   0lach/empty:latest                              "/home/mrshiposha/de…"   6 seconds ago   Up 4 seconds             bdk-env-relay-karura-node-bob-1
6cb79f49e42c   0lach/empty:latest                              "/home/mrshiposha/de…"   6 seconds ago   Up 4 seconds             bdk-env-relay-quartz-node-alice-1
cc8294383ab0   uniquenetwork/builder-polkadot:release-v1.0.0   "/bin/polkadot --nam…"   6 seconds ago   Up 4 seconds             bdk-env-relay-node-alice-1
4d79b6ba1bc1   0lach/empty:latest                              "/home/mrshiposha/de…"   6 seconds ago   Up 4 seconds             bdk-env-relay-quartz-node-bob-1
a5210fcb9255   uniquenetwork/builder-polkadot:release-v1.0.0   "/bin/polkadot --nam…"   6 seconds ago   Up 5 seconds             bdk-env-relay-node-ferdie-1
d8880f6749d0   uniquenetwork/builder-polkadot:release-v1.0.0   "/bin/polkadot --nam…"   6 seconds ago   Up 5 seconds             bdk-env-relay-node-bob-1
ab4ed157b4a9   jacogr/polkadot-js-apps:latest                  "/docker-entrypoint.…"   6 seconds ago   Up 4 seconds   80/tcp    bdk-env-polkadot-apps-1
3a1b750774ac   0lach/empty:latest                              "/home/mrshiposha/de…"   6 seconds ago   Up 5 seconds             bdk-env-relay-karura-node-alice-1
dd662e356362   uniquenetwork/builder-polkadot:release-v1.0.0   "/bin/polkadot --nam…"   6 seconds ago   Up 5 seconds             bdk-env-relay-node-dave-1
bfece072c400   uniquenetwork/builder-polkadot:release-v1.0.0   "/bin/polkadot --nam…"   6 seconds ago   Up 4 seconds             bdk-env-relay-node-charlie-1
9c7087ac0252   uniquenetwork/builder-polkadot:release-v1.0.0   "/bin/polkadot --nam…"   6 seconds ago   Up 5 seconds             bdk-env-relay-node-eve-1
```

Suppose you're interested in logs of a Quartz node. There are several Quartz nodes in the list above, so you can choose any of them (see the `NAMES` column). For instance, you could pick the `bdk-env-relay-quartz-node-alice-1` by typing the following:
```
docker logs -f bdk-env-relay-quartz-node-alice-1
```

## How to use `baedeker` in CI

To use `baedeker` in CI you need to:
* Install it
    ```yaml
    - name: Install baedeker
        uses: UniqueNetwork/baedeker-action/setup@built
    ```
* Setup it's library
    ```yaml
     - name: Setup baedeker library
        run: mkdir -p .baedeker/vendor/ && git clone https://github.com/UniqueNetwork/baedeker-library .baedeker/vendor/baedeker-library
    ```
* Then, you can run the test networks
    ```yaml
    - name: Start networks
        uses: UniqueNetwork/baedeker-action@built
        id: bdk
        with:
          jpath: |
            .baedeker/vendor

          tla-str: |
            relay_spec=rococo-local

          # snippets in the `inputs` resemble the `.baedeker/rewrites.json` file
          inputs: |
            # NOTE: The path to the testnet.json file might differ depending on how you checkout the `xnft-tests` repo.
            xnft-tests/.baedeker/testnets.jsonnet

            # Usage of a docker image to provide the relay chain binary
            snippet:(import 'baedeker-library/ops/rewrites.libsonnet').rewriteNodePaths({'bin/polkadot':{dockerImage:'uniquenetwork/builder-polkadot:${{ <VERSION VARIABLE> }}'}})

            # You can use `snippet` to provide the rest of the required binaries.
    ```
