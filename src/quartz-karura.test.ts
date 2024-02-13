import {Keyring} from '@polkadot/api';
import {describe} from 'mocha';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {IKeyringPair} from '@polkadot/types/types';
import {sendAndWait} from './util';
import {Relay} from './common';
import {Quartz} from './unique-chains/quartz';
import {Karura} from './acala-chains/karura';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('Quartz/Karura XNFT tests', () => {
  let chains: {
    relay: Relay,
    quartz: Quartz,
    karura: Karura,
  };

  let alice: IKeyringPair;
  let bob: IKeyringPair;
  let charlie: IKeyringPair;
  let dave: IKeyringPair;

  let sovereignAccount: {
    karura: string;
    quartz: string;
  };

  before(async () => {
    chains = {
      relay: await Relay.connect(),
      quartz: await Quartz.connect(),
      karura: await Karura.connect(),
    };

    const keyring = new Keyring({type: 'sr25519'});
    alice = keyring.addFromUri('//Alice');
    bob = keyring.addFromUri('//Bob');
    charlie = keyring.addFromUri('//Charlie');
    dave = keyring.addFromUri('//Dave');

    await chains.relay.waitForParachainsStart();
    await chains.relay.forceOpenHrmpDuplex(alice, chains.quartz.paraId, chains.karura.paraId);

    sovereignAccount = {
      karura: chains.quartz.locations.paraSovereignAccount(chains.karura.paraId),
      quartz: chains.karura.locations.paraSovereignAccount(chains.quartz.paraId),
    };

    console.log(`[XNFT] Karura sovereign account: ${sovereignAccount.karura}`);
    console.log(`[XNFT] Quartz sovereign account: ${sovereignAccount.quartz}`);

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
  });

  it('transferring Quartz NFT between Quartz and Karura', async () => {
    console.log('=== transferring Quartz NFT between Quartz and Karura ===');

    const quartzCollectionId = await chains.quartz.createCollection(alice);
    await chains.karura.registerNonFungibleForeignAsset(
      alice,
      chains.quartz.xcmNft.assetId(quartzCollectionId),
      `Quartz/Collection(${quartzCollectionId})`,
    );

    const quartzToken = await chains.quartz.mintToken(alice, quartzCollectionId, bob.address);

    console.log('\t>>> TEST: Quartz/Bob -> Karura/Bob <<<');
    {
      await chains.quartz.xtokens.transferXnftWithFee({
        signer: bob,
        token: quartzToken,
        fee: chains.quartz.nativeCurrency.asMultiasset(10),
        destChain: chains.karura,
        beneficiary: bob.address,
      });

      const karuraDerivativeToken = await chains.karura.derivativeTokenOf(quartzToken);
      console.log(`[XNFT] Karura: minted ${karuraDerivativeToken.stringify()} backed by ${quartzToken.stringify()}`);

      await quartzToken.checkOwner(sovereignAccount.karura);
      await karuraDerivativeToken.checkOwner(bob.address);
    }

    console.log('\t>>> TEST: Karura/Bob -> Quartz/Alice <<<');
    {
      await chains.karura.xtokens.transferXnftWithFee({
        signer: bob,
        token: quartzToken,
        fee: chains.quartz.nativeCurrency.asMultiasset(1),
        destChain: chains.quartz,
        beneficiary: alice.address,
      });

      const karuraDerivativeToken = await chains.karura.derivativeTokenOf(quartzToken);

      await karuraDerivativeToken.checkOwner(chains.karura.xnftPalletAccount);
      await quartzToken.checkOwner(alice.address);
    }

    console.log('\t>>> TEST: Quartz/Alice -> Karura/Charlie <<<');
    {
      await chains.quartz.xtokens.transferXnftWithFee({
        signer: alice,
        token: quartzToken,
        fee: chains.quartz.nativeCurrency.asMultiasset(10),
        destChain: chains.karura,
        beneficiary: charlie.address,
      });

      const karuraDerivativeToken = await chains.karura.derivativeTokenOf(quartzToken);
      console.log(`[XNFT] Karura: ${karuraDerivativeToken.stringify()} is backed by ${quartzToken.stringify()}`);

      await quartzToken.checkOwner(sovereignAccount.karura);
      await karuraDerivativeToken.checkOwner(charlie.address);
    }

    console.log('\t>>> TEST: Karura/Charlie -> Quartz/Dave <<<');
    {
      await chains.karura.xtokens.transferXnftWithFee({
        signer: charlie,
        token: quartzToken,
        fee: chains.quartz.nativeCurrency.asMultiasset(1),
        destChain: chains.quartz,
        beneficiary: dave.address,
      });

      const karuraDerivativeToken = await chains.karura.derivativeTokenOf(quartzToken);

      await karuraDerivativeToken.checkOwner(chains.karura.xnftPalletAccount);
      await quartzToken.checkOwner(dave.address);
    }
  });

  it('transferring Karura NFT between Quartz and Karura', async () => {
    console.log('=== transferring Karura NFT between Quartz and Karura ===');

    const karuraCollectionId = await chains.karura.createCollection(alice);
    await chains.quartz.registerNftForeignAsset(
      alice,
      chains.karura.xcmNft.assetId(karuraCollectionId),
      {
        name: `Karura/Collection(${karuraCollectionId})`,
        tokenPrefix: 'KNFT',
      },
    );

    const karuraToken = await chains.karura.mintToken(alice, karuraCollectionId, bob.address);

    console.log('\t>>> TEST: Karura/Bob -> Quartz/Bob <<<');
    {
      await chains.karura.xtokens.transferXnftWithFee({
        signer: bob,
        token: karuraToken,
        fee: chains.karura.nativeCurrency.asMultiasset(10),
        destChain: chains.quartz,
        beneficiary: bob.address,
      });

      const quartzDerivativeToken = await chains.quartz.derivativeTokenOf(karuraToken);
      console.log(`[XNFT] Quartz: minted ${quartzDerivativeToken.stringify()} backed by ${karuraToken.stringify()}`);

      await karuraToken.checkOwner(sovereignAccount.quartz);
      await quartzDerivativeToken.checkOwner(bob.address);
    }

    console.log('\t>>> Test: Quartz/Bob -> Karura/Alice <<<');
    {
      await chains.quartz.xtokens.transferXnftWithFee({
        signer: bob,
        token: karuraToken,
        fee: chains.karura.nativeCurrency.asMultiasset(1),
        destChain: chains.karura,
        beneficiary: alice.address,
      });

      const quartzDerivativeToken = await chains.quartz.derivativeTokenOf(karuraToken);

      await quartzDerivativeToken.checkOwner(chains.quartz.foreignAssetsPalletAccount);
      await karuraToken.checkOwner(alice.address);
    }

    console.log('\t>>> Test: Karura/Alice -> Quartz/Charlie <<<');
    {
      await chains.karura.xtokens.transferXnftWithFee({
        signer: alice,
        token: karuraToken,
        fee: chains.karura.nativeCurrency.asMultiasset(10),
        destChain: chains.quartz,
        beneficiary: charlie.address,
      });

      const quartzDerivativeToken = await chains.quartz.derivativeTokenOf(karuraToken);
      console.log(`[XNFT] Quartz: ${quartzDerivativeToken.stringify()} is backed by ${karuraToken.stringify()}`);

      await karuraToken.checkOwner(sovereignAccount.quartz);
      await quartzDerivativeToken.checkOwner(charlie.address);
    }

    console.log('\t >>> Test: Quartz/Charlie -> Karura/Dave <<<');
    {
      await chains.quartz.xtokens.transferXnftWithFee({
        signer: charlie,
        token: karuraToken,
        fee: chains.karura.nativeCurrency.asMultiasset(1),
        destChain: chains.karura,
        beneficiary: dave.address,
      });

      const quartzDerivativeToken = await chains.quartz.derivativeTokenOf(karuraToken);

      await quartzDerivativeToken.checkOwner(chains.quartz.foreignAssetsPalletAccount);
      await karuraToken.checkOwner(dave.address);
    }
  });

  it('transfer derivative of Karura NFT within Quartz using native API', async () => {
    console.log('=== transfer derivative of Karura NFT within Quartz using native API ===');

    const karuraCollectionId = await chains.karura.createCollection(alice);
    await chains.quartz.registerNftForeignAsset(
      alice,
      chains.karura.xcmNft.assetId(karuraCollectionId),
      {
        name: `Karura/Collection(${karuraCollectionId})`,
        tokenPrefix: 'KNFT',
      },
    );

    const karuraToken = await chains.karura.mintToken(alice, karuraCollectionId, bob.address);

    await chains.karura.xtokens.transferXnftWithFee({
      signer: bob,
      token: karuraToken,
      fee: chains.karura.nativeCurrency.asMultiasset(10),
      destChain: chains.quartz,
      beneficiary: bob.address,
    });

    const quartzDerivativeToken = await chains.quartz.derivativeTokenOf(karuraToken);
    console.log(`[XNFT] Quartz: minted ${quartzDerivativeToken.stringify()} backed by ${karuraToken.stringify()}`);

    await sendAndWait(
      bob,
      chains.quartz.api.tx.unique.transfer(
        {Substrate: alice.address},
        quartzDerivativeToken.collectionId,
        quartzDerivativeToken.tokenId,
        1,
      ),
    );
    console.log(`[XNFT] ${bob.address} sent the ${quartzDerivativeToken.stringify()} to ${alice.address}`);

    await quartzDerivativeToken.checkOwner(alice.address);
  });

  it('Quartz cannot act as the reserve for the derivative of Karura NFT', async () => {
    console.log('=== Quartz cannot act as the reserve for the derivative of Karura NFT ===');

    const karuraCollectionId = await chains.karura.createCollection(alice);
    await chains.quartz.registerNftForeignAsset(
      alice,
      chains.karura.xcmNft.assetId(karuraCollectionId),
      {
        name: `Karura/Collection(${karuraCollectionId})`,
        tokenPrefix: 'KNFT',
      },
    );

    const karuraToken = await chains.karura.mintToken(alice, karuraCollectionId, bob.address);

    await chains.karura.xtokens.transferXnftWithFee({
      signer: bob,
      token: karuraToken,
      fee: chains.karura.nativeCurrency.asMultiasset(10),
      destChain: chains.quartz,
      beneficiary: bob.address,
    });

    const quartzDerivativeToken = await chains.quartz.derivativeTokenOf(karuraToken);
    console.log(`[XNFT] Quartz: minted ${quartzDerivativeToken.stringify()} backed by ${karuraToken.stringify()}`);

    console.log('\t >>> TEST: Quartz attempts to send the derivative as it was the original <<<');
    await expect(chains.quartz.xtokens.transferXnftWithFee({
      signer: bob,
      token: quartzDerivativeToken,
      fee: chains.quartz.nativeCurrency.asMultiasset(10),
      destChain: chains.karura,
      beneficiary: alice.address,
    })).to.be.rejectedWith('xTokens.XcmExecutionFailed');
    console.log('[OK] the attempt is rejected');
  });

  it('transfer derivative of Quartz NFT within Karura using native API', async () => {
    console.log('=== transfer derivative of Quartz NFT within Karura using native API ===');

    const quartzCollectionId = await chains.quartz.createCollection(alice);
    await chains.karura.registerNonFungibleForeignAsset(
      alice,
      chains.quartz.xcmNft.assetId(quartzCollectionId),
      `Quartz/Collection(${quartzCollectionId})`,
    );

    const quartzToken = await chains.quartz.mintToken(alice, quartzCollectionId, bob.address);

    await chains.quartz.xtokens.transferXnftWithFee({
      signer: bob,
      token: quartzToken,
      fee: chains.quartz.nativeCurrency.asMultiasset(10),
      destChain: chains.karura,
      beneficiary: bob.address,
    });

    const karuraDerivativeToken = await chains.karura.derivativeTokenOf(quartzToken);
    console.log(`[XNFT] Karura: minted ${karuraDerivativeToken.stringify()} backed by ${quartzToken.stringify()}`);

    await sendAndWait(
      bob,
      chains.karura.api.tx.nft.transfer(
        {Id: alice.address},
        [
          karuraDerivativeToken.collectionId,
          karuraDerivativeToken.tokenId,
        ],
      ),
    );
    console.log(`[XNFT] ${bob.address} sent the ${karuraDerivativeToken.stringify()} to ${alice.address}`);

    await karuraDerivativeToken.checkOwner(alice.address);
  });

  it('Karura cannot act as the reserve for the derivative of Quartz NFT', async () => {
    console.log('=== Karura cannot act as the reserve for the derivative of Quartz NFT ===');

    const quartzCollectionId = await chains.quartz.createCollection(alice);
    await chains.karura.registerNonFungibleForeignAsset(
      alice,
      chains.quartz.xcmNft.assetId(quartzCollectionId),
      `Quartz/Collection(${quartzCollectionId})`,
    );

    const quartzToken = await chains.quartz.mintToken(alice, quartzCollectionId, bob.address);

    await chains.quartz.xtokens.transferXnftWithFee({
      signer: bob,
      token: quartzToken,
      fee: chains.quartz.nativeCurrency.asMultiasset(10),
      destChain: chains.karura,
      beneficiary: bob.address,
    });

    const karuraDerivativeToken = await chains.karura.derivativeTokenOf(quartzToken);
    console.log(`[XNFT] Karura: minted ${karuraDerivativeToken.stringify()} backed by ${quartzToken.stringify()}`);

    console.log('\t >>> TEST: Karura attempts to send the derivative as it was the original <<<');
    await expect(chains.karura.xtokens.transferXnftWithFee({
      signer: bob,
      token: karuraDerivativeToken,
      fee: chains.karura.nativeCurrency.asMultiasset(10),
      destChain: chains.quartz,
      beneficiary: alice.address,
    })).to.be.rejectedWith('xTokens.XcmExecutionFailed');
    console.log('[OK] the attempt is rejected');
  });

  after(async () => {
    await chains.relay.disconnect();
    await chains.quartz.disconnect();
    await chains.karura.disconnect();
  });
});
