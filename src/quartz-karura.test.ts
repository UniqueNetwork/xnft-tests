import {Keyring} from '@polkadot/api';
import {describe} from 'mocha';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {AllChains} from './common';
import {IKeyringPair} from '@polkadot/types/types';
import {sendAndWait} from './util';

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('Quartz/Karura XNFT tests', () => {
  let chains: AllChains;

  let alice: IKeyringPair;
  let bob: IKeyringPair;
  let charlie: IKeyringPair;
  let dave: IKeyringPair;

  let sovereignAccount: {
    karura: string;
    quartz: string;
  };

  before(async () => {
    chains = await AllChains.connect();

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

    await chains.quartz.registerForeignAsset(
      alice,
      chains.karura.nativeCurrency.id,
      {
        name: chains.karura.name,
        tokenPrefix: chains.karura.nativeCurrency.symbol,
        mode: {Fungible: chains.karura.nativeCurrency.decimals},
      },
    );
  });

  it('transferring Quartz NFT between Quartz and Karura', async () => {
    console.log('=== transferring Quartz NFT between Quartz and Karura ===');

    const quartzCollectionId = await chains.quartz.createCollection(alice);
    await chains.karura.registerNonFungibleForeignAsset(
      alice,
      chains.quartz.xcmNft.collectionAssetId(quartzCollectionId),
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

      const karuraDerivativeToken = await chains.karura.derivativeToken(quartzToken);
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

      const karuraDerivativeToken = await chains.karura.derivativeToken(quartzToken);
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

      await quartzToken.checkOwner(dave.address);
    }
  });

  it('transferring Karura NFT between Quartz and Karura', async () => {
    console.log('=== transferring Karura NFT between Quartz and Karura ===');

    const karuraCollectionId = await chains.karura.createCollection(alice);
    await chains.quartz.registerForeignAsset(
      alice,
      chains.karura.xcmNft.collectionAssetId(karuraCollectionId),
      {
        name: `Karura/Collection(${karuraCollectionId})`,
        tokenPrefix: 'KNFT',
        mode: 'NFT',
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

      const quartzDerivativeToken = await chains.quartz.derivativeToken(karuraToken);
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

      const quartzDerivativeToken = await chains.quartz.derivativeToken(karuraToken);
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

      await karuraToken.checkOwner(dave.address);
    }
  });

  it('transfer derivative of Karura NFT within Quartz using native API', async () => {
    console.log('=== transfer derivative of Karura NFT within Quartz using native API ===');

    const karuraCollectionId = await chains.karura.createCollection(alice);
    await chains.quartz.registerForeignAsset(
      alice,
      chains.karura.xcmNft.collectionAssetId(karuraCollectionId),
      {
        name: `Karura/Collection(${karuraCollectionId})`,
        tokenPrefix: 'KNFT',
        mode: 'NFT',
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

    const quartzDerivativeToken = await chains.quartz.derivativeToken(karuraToken);
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
    await chains.quartz.registerForeignAsset(
      alice,
      chains.karura.xcmNft.collectionAssetId(karuraCollectionId),
      {
        name: `Karura/Collection(${karuraCollectionId})`,
        tokenPrefix: 'KNFT',
        mode: 'NFT',
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

    const quartzDerivativeToken = await chains.quartz.derivativeToken(karuraToken);
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
      chains.quartz.xcmNft.collectionAssetId(quartzCollectionId),
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

    const karuraDerivativeToken = await chains.karura.derivativeToken(quartzToken);
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
      chains.quartz.xcmNft.collectionAssetId(quartzCollectionId),
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

    const karuraDerivativeToken = await chains.karura.derivativeToken(quartzToken);
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
    await chains.disconnect();
  });
});

// const createQuartzCollection = async (api: ApiPromise, signer: IKeyringPair) => {
//   const quartzCollectionId = await sendAndWait(signer, api.tx.unique.createCollectionEx({
//     mode: 'NFT',
//     tokenPrefix: 'xNFT',
//   }))
//     .then(result => result.extractEvents.quartz.collectionCreated)
//     .then(events => events[0].collectionId);
//   console.log(`[XNFT] created NFT collection #${quartzCollectionId} on Quartz`);

//   return quartzCollectionId;
// };

// const mintQuartzNft = async (api: ApiPromise, signer: IKeyringPair, options: {
//   collectionId: number,
//   owner: string,
// }) => {
//   const quartzTokenId = await sendAndWait(signer, api.tx.unique.createItem(
//     options.collectionId,
//     {Substrate: options.owner},
//     'NFT',
//   ))
//     .then(result => result.extractEvents.quartz.itemCreated)
//     .then(events => events[0].tokenId);

//   console.log(`[XNFT] minted NFT "Quartz/Collection(#${options.collectionId})/NFT(#${quartzTokenId})"`);
//   return quartzTokenId;
// };

// const createKaruraCollection = async (api: ApiPromise, signer: IKeyringPair) => {
//   const enableAllCollectionFeatures = 0xF;
//   const emptyAttributes = api.createType('BTreeMap<Bytes, Bytes>', {});
//   const karuraCollectionId = await sendAndWait(signer, api.tx.nft.createClass(
//     'xNFT Collection',
//     enableAllCollectionFeatures,
//     emptyAttributes,
//   ))
//     .then(result => result.extractEvents.karura.nftCreatedClass)
//     .then(events => events[0].classId);
//   const karuraCollectionAccount = await palletSubAccount(api, 'aca/aNFT', karuraCollectionId);

//   console.log(`[XNFT] created NFT collection #${karuraCollectionId} on Karura`);
//   console.log(`\t... the collection account: ${karuraCollectionAccount}`);

//   await sendAndWait(signer, api.tx.balances.transferKeepAlive({Id: karuraCollectionAccount}, unit.kar(10)));
//   console.log('\t... sponsored the collection account');

//   return karuraCollectionId;
// };

// const mintKaruraNft = async (api: ApiPromise, signer: IKeyringPair, options: {
//   collectionId: number,
//   owner: string,
// }) => {
//   const karuraTokenId = await api.query.ormlNFT.nextTokenId(options.collectionId);
//   const collectionAccount = await palletSubAccount(api, 'aca/aNFT', options.collectionId);
//   const emptyAttributes = api.createType('BTreeMap<Bytes, Bytes>', {});

//   await sendAndWait(signer, api.tx.proxy.proxy(
//     {Id: collectionAccount},
//     'Any',
//     api.tx.nft.mint(
//       {Id: options.owner},
//       options.collectionId,
//       'xNFT',
//       emptyAttributes,
//       1,
//     ),
//   ));

//   console.log(`[XNFT] minted NFT "Karura/Collection(#${options.collectionId})/NFT(#${karuraTokenId})"`);
//   return karuraTokenId;
// };

// const registerKaruraCollectionOnQuartz = async (
//   api: ApiPromise,
//   signer: IKeyringPair,
//   karuraCollectionId: number,
// ) => {
//   const quartzCollectionId = await sendAndWait(
//     signer,
//     api.tx.sudo.sudo(api.tx.foreignAssets.forceRegisterForeignAsset(
//       {
//         V3: {
//           Concrete: chain.karura.multilocation.nftCollection(karuraCollectionId),
//         },
//       },
//       strUtf16('Karura NFT'),
//       'xNFT',
//       'NFT',
//     )),
//   )
//     .then(result => result.extractEvents.quartz.collectionCreated)
//     .then(events => events[0].collectionId);

//   console.log(`[XNFT] registered "Quartz/Collection(#${quartzCollectionId})" backed by "Karura/Collection(#${karuraCollectionId})"`);
//   return quartzCollectionId;
// };
