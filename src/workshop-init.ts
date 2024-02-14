import {Keyring} from '@polkadot/api';
import {Relay} from './common';
import {Quartz} from './unique-chains/quartz';
import {Karura} from './acala-chains/karura';

async function init() {
  const chains = {
    relay: await Relay.connect(),
    quartz: await Quartz.connect(),
    karura: await Karura.connect(),
  };

  const keyring = new Keyring({type: 'sr25519'});
  const alice = keyring.addFromUri('//Alice');

  await chains.relay.waitForParachainsStart();

  await chains.relay.forceOpenHrmpDuplex(
    alice,
    chains.quartz.paraId,
    chains.karura.paraId,
  );

  await chains.karura.registerFungibleForeignAsset(
    alice,
    chains.quartz.locations.self,
    {
      name: chains.quartz.name,
      symbol: chains.quartz.nativeCurrency.symbol,
      decimals: chains.quartz.nativeCurrency.decimals,
      minimalBalance: chains.quartz.nativeCurrency.amount(1),
    },
  );

  await chains.quartz.registerFungibleForeignAsset(
    alice,
    chains.karura.nativeCurrency.id,
    {
      name: chains.karura.name,
      tokenPrefix: chains.karura.nativeCurrency.symbol,
      decimals: chains.karura.nativeCurrency.decimals,
    },
  );

  await chains.relay.disconnect();
  await chains.quartz.disconnect();
  await chains.karura.disconnect();
}

await init();
