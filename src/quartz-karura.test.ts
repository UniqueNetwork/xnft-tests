import {Keyring} from '@polkadot/api';
import {describe} from 'mocha';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import {
  AllChains,
  RELAY_KARURA_ID,
  RELAY_QUARTZ_ID,
} from './common';
import {IKeyringPair} from '@polkadot/types/types';

chai.use(chaiAsPromised);
// const expect = chai.expect;

describe('Quartz/Karura XNFT tests', () => {
  let chains: AllChains;

  let alice: IKeyringPair;
  let bob: IKeyringPair;
  let charlie: IKeyringPair;
  let dave: IKeyringPair;

  before(async () => {
    chains = await AllChains.connect();

    const keyring = new Keyring({type: 'sr25519'});
    alice = keyring.addFromUri('//Alice');
    bob = keyring.addFromUri('//Bob');
    charlie = keyring.addFromUri('//Charlie');
    dave = keyring.addFromUri('//Dave');

    await chains.relay.waitForParachainsStart();
    await chains.relay.forceOpenHrmpDuplex(alice, RELAY_QUARTZ_ID, RELAY_KARURA_ID);

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
    console.log('=== transfer Quartz NFT to Karura and back ===');

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

  // it('transfer Karura NFT to Quartz and back', async () => {
  //   console.log('=== transfer Karura NFT to Quartz and back ===');

  //   const karuraCollectionId = await createKaruraCollection(karuraApi, alice);
  //   const quartzCollectionId = await registerKaruraCollectionOnQuartz(quartzApi, alice, karuraCollectionId);

  //   const karuraTokenId = await mintKaruraNft(karuraApi, alice, {
  //     collectionId: karuraCollectionId,
  //     owner: bob.address,
  //   });

  //   const xnft = {
  //     V3: {
  //       id: {Concrete: chain.karura.multilocation.nftCollection(karuraCollectionId)},
  //       fun: {NonFungible: {Index: karuraTokenId}},
  //     },
  //   };

  //   let fee = {
  //     V3: {
  //       id: {Concrete: chain.karura.multilocation.token.kar},
  //       fun: {Fungible: unit.kar(10)},
  //     },
  //   };
  //   let dest = {V3: chain.quartz.multilocation.account(bob.addressRaw)};
  //   const karuraMessageHash = await sendAndWait(
  //     bob,
  //     karuraApi.tx.xTokens.transferMultiassetWithFee(
  //       xnft,
  //       fee,
  //       dest,
  //       'Unlimited',
  //     ),
  //   )
  //     .then(result => result.extractEvents.general.xcmpQueueMessageSent)
  //     .then(events => events[0].messageHash);
  //   console.log(`[XNFT] sent "Karura/Collection(#${karuraCollectionId})/NFT(#${karuraTokenId})" to Karura`);
  //   console.log(`\t... message hash: ${karuraMessageHash}`);

  //   await expectXcmpQueueSuccess(quartzApi, karuraMessageHash);

  //   const quartzTokenId = await quartzApi.query.foreignAssets.foreignReserveAssetInstanceToTokenId(
  //     quartzCollectionId,
  //     {Index: karuraTokenId},
  //   ).then(data => data.toJSON() as number);
  //   console.log(`[XNFT] minted NFT "Quartz/Collection(#${quartzCollectionId})/NFT(#${quartzTokenId})"`);
  //   console.log(`\t... backed by "Karura/Collection(#${karuraCollectionId})/NFT(#${karuraTokenId})"`);

  //   await quartzApi.query.nonfungible.owned(
  //     quartzCollectionId,
  //     {Substrate: bob.address},
  //     quartzTokenId,
  //   ).then(isOwned => expect(isOwned.toJSON()).to.be.true);
  //   console.log('[XNFT] the owner of the derivative NFT is correct');

  //   fee = {
  //     V3: {
  //       id: {Concrete: chain.karura.multilocation.token.kar},
  //       fun: {Fungible: unit.kar(1)},
  //     },
  //   };
  //   dest = {V3: chain.karura.multilocation.account(alice.addressRaw)};
  //   const quartzMessageHash = await sendAndWait(
  //     bob,
  //     quartzApi.tx.xTokens.transferMultiassetWithFee(
  //       xnft,
  //       fee,
  //       dest,
  //       'Unlimited',
  //     ),
  //   )
  //     .then(result => result.extractEvents.general.xcmpQueueMessageSent)
  //     .then(events => events[0].messageHash);
  //   console.log(`[XNFT] sent "Karura/Collection(#${karuraCollectionId})/NFT(#${karuraTokenId})" back to Karura to Alice`);
  //   console.log(`\t... message hash: ${quartzMessageHash}`);

  //   await expectXcmpQueueSuccess(karuraApi, quartzMessageHash);

  //   const karuraTokenData: any = await karuraApi.query.ormlNFT.tokens(karuraCollectionId, karuraTokenId)
  //     .then(data => data.toJSON());

  //   expect(karuraTokenData.owner).to.be.equal(await toChainAddressFormat(karuraApi, alice.address));
  //   console.log(`[XNFT] Alice owns the returned "Karura/Collection(#${karuraCollectionId})/NFT(#${karuraTokenId})"`);
  // });

  // it('transfer derivative of Karura NFT within Quartz using native API', async () => {
  //   console.log('=== transfer derivative of Karura NFT within Quartz using native API ===');

  //   const karuraCollectionId = await createKaruraCollection(karuraApi, alice);
  //   const quartzCollectionId = await registerKaruraCollectionOnQuartz(quartzApi, alice, karuraCollectionId);

  //   const karuraTokenId = await mintKaruraNft(karuraApi, alice, {
  //     collectionId: karuraCollectionId,
  //     owner: bob.address,
  //   });

  //   const xnft = {
  //     V3: {
  //       id: {Concrete: chain.karura.multilocation.nftCollection(karuraCollectionId)},
  //       fun: {NonFungible: {Index: karuraTokenId}},
  //     },
  //   };

  //   const fee = {
  //     V3: {
  //       id: {Concrete: chain.karura.multilocation.token.kar},
  //       fun: {Fungible: unit.kar(10)},
  //     },
  //   };
  //   const dest = {V3: chain.quartz.multilocation.account(bob.addressRaw)};
  //   const karuraMessageHash = await sendAndWait(
  //     bob,
  //     karuraApi.tx.xTokens.transferMultiassetWithFee(
  //       xnft,
  //       fee,
  //       dest,
  //       'Unlimited',
  //     ),
  //   )
  //     .then(result => result.extractEvents.general.xcmpQueueMessageSent)
  //     .then(events => events[0].messageHash);

  //   await expectXcmpQueueSuccess(quartzApi, karuraMessageHash);

  //   const quartzTokenId = await quartzApi.query.foreignAssets.foreignReserveAssetInstanceToTokenId(
  //     quartzCollectionId,
  //     {Index: karuraTokenId},
  //   ).then(data => data.toJSON() as number);

  //   await sendAndWait(
  //     bob,
  //     quartzApi.tx.unique.transfer(
  //       {Substrate: alice.address},
  //       quartzCollectionId,
  //       quartzTokenId,
  //       1,
  //     ),
  //   );
  //   console.log(`[XNFT] Bob sent the derivative NFT ${quartzCollectionId}/#${quartzTokenId} to Alice`);

  //   await quartzApi.query.nonfungible.owned(
  //     quartzCollectionId,
  //     {Substrate: alice.address},
  //     quartzTokenId,
  //   ).then(isOwned => expect(isOwned.toJSON()).to.be.true);
  //   console.log('[XNFT] Alice received the derivative NFT');
  // });

  // it('Quartz cannot act as the reserve for the derivative of Karura NFT', async () => {
  //   console.log('=== Quartz cannot act as the reserve for the derivative of Karura NFT ===');

  //   const karuraCollectionId = await createKaruraCollection(karuraApi, alice);
  //   const quartzCollectionId = await registerKaruraCollectionOnQuartz(quartzApi, alice, karuraCollectionId);

  //   const karuraTokenId = await mintKaruraNft(karuraApi, alice, {
  //     collectionId: karuraCollectionId,
  //     owner: bob.address,
  //   });

  //   let xnft: any = {
  //     V3: {
  //       id: {Concrete: chain.karura.multilocation.nftCollection(karuraCollectionId)},
  //       fun: {NonFungible: {Index: karuraTokenId}},
  //     },
  //   };
  //   let fee: any = {
  //     V3: {
  //       id: {Concrete: chain.karura.multilocation.token.kar},
  //       fun: {Fungible: unit.kar(10)},
  //     },
  //   };
  //   let dest = {V3: chain.quartz.multilocation.account(bob.addressRaw)};
  //   const karuraMessageHash = await sendAndWait(
  //     bob,
  //     karuraApi.tx.xTokens.transferMultiassetWithFee(
  //       xnft,
  //       fee,
  //       dest,
  //       'Unlimited',
  //     ),
  //   )
  //     .then(result => result.extractEvents.general.xcmpQueueMessageSent)
  //     .then(events => events[0].messageHash);

  //   await expectXcmpQueueSuccess(quartzApi, karuraMessageHash);

  //   const quartzTokenId = await quartzApi.query.foreignAssets.foreignReserveAssetInstanceToTokenId(
  //     quartzCollectionId,
  //     {Index: karuraTokenId},
  //   ).then(data => data.toJSON() as number);

  //   dest = {V3: chain.karura.multilocation.account(alice.addressRaw)};
  //   xnft = {
  //     V3: {
  //       id: {Concrete: chain.quartz.multilocation.nftCollection(quartzCollectionId)},
  //       fun: {NonFungible: {Index: quartzTokenId}},
  //     },
  //   };
  //   fee = {
  //     V3: {
  //       id: {Concrete: chain.quartz.multilocation.self},
  //       fun: {Fungible: unit.qtz(10)},
  //     },
  //   };
  //   await expect(sendAndWait(
  //     alice,
  //     quartzApi.tx.xTokens.transferMultiassetWithFee(
  //       xnft,
  //       fee,
  //       dest,
  //       'Unlimited',
  //     ),
  //   )).to.be.rejectedWith('xTokens.XcmExecutionFailed');
  // });

  // it('transfer derivative of Quartz NFT within Karura using native API', async () => {
  //   console.log('=== transfer derivative of Quartz NFT within Karura using native API ===');

  //   const quartzCollectionId = await createQuartzCollection(quartzApi, alice);
  //   const karuraCollectionId = await registerQuartzCollectionOnKarura(karuraApi, alice, quartzCollectionId);

  //   const quartzTokenId = await mintQuartzNft(quartzApi, alice, {
  //     collectionId: quartzCollectionId,
  //     owner: bob.address,
  //   });

  //   const xnft = {
  //     V3: {
  //       id: {Concrete: chain.quartz.multilocation.nftCollection(quartzCollectionId)},
  //       fun: {NonFungible: {Index: quartzTokenId}},
  //     },
  //   };
  //   const fee = {
  //     V3: {
  //       id: {Concrete: chain.quartz.multilocation.self},
  //       fun: {Fungible: unit.qtz(10)},
  //     },
  //   };
  //   const dest = {V3: chain.karura.multilocation.account(bob.addressRaw)};
  //   const quartzMessageHash = await sendAndWait(
  //     bob,
  //     quartzApi.tx.xTokens.transferMultiassetWithFee(
  //       xnft,
  //       fee,
  //       dest,
  //       'Unlimited',
  //     ),
  //   )
  //     .then(result => result.extractEvents.general.xcmpQueueMessageSent)
  //     .then(events => events[0].messageHash);

  //   await expectXcmpQueueSuccess(karuraApi, quartzMessageHash);

  //   const karuraTokenId = await karuraApi.query.xnft.assetInstanceToItem(karuraCollectionId, {Index: quartzTokenId})
  //     .then(data => data.toJSON() as number);

  //   await sendAndWait(
  //     bob,
  //     karuraApi.tx.nft.transfer(
  //       {Id: alice.address},
  //       [karuraCollectionId, karuraTokenId],
  //     ),
  //   );
  //   console.log(`[XNFT] Bob sent the derivative NFT ${karuraCollectionId}/#${karuraTokenId} to Alice`);

  //   const derivativeNftData: any = await karuraApi.query.ormlNFT.tokens(karuraCollectionId, karuraTokenId)
  //     .then(data => data.toJSON());

  //   expect(derivativeNftData.owner).to.be.equal(await toChainAddressFormat(karuraApi, alice.address));
  //   console.log('[XNFT] Alice received the derivative NFT');
  // });

  // it('Karura cannot act as the reserve for the derivative of Quartz NFT', async () => {
  //   console.log('=== Karura cannot act as the reserve for the derivative of Quartz NFT ===');

  //   const quartzCollectionId = await createQuartzCollection(quartzApi, alice);
  //   const karuraCollectionId = await registerQuartzCollectionOnKarura(karuraApi, alice, quartzCollectionId);

  //   const quartzTokenId = await mintQuartzNft(quartzApi, alice, {
  //     collectionId: quartzCollectionId,
  //     owner: bob.address,
  //   });

  //   let xnft: any = {
  //     V3: {
  //       id: {Concrete: chain.quartz.multilocation.nftCollection(quartzCollectionId)},
  //       fun: {NonFungible: {Index: quartzTokenId}},
  //     },
  //   };
  //   let fee: any = {
  //     V3: {
  //       id: {Concrete: chain.quartz.multilocation.self},
  //       fun: {Fungible: unit.qtz(10)},
  //     },
  //   };
  //   let dest = {V3: chain.karura.multilocation.account(bob.addressRaw)};
  //   const quartzMessageHash = await sendAndWait(
  //     bob,
  //     quartzApi.tx.xTokens.transferMultiassetWithFee(
  //       xnft,
  //       fee,
  //       dest,
  //       'Unlimited',
  //     ),
  //   )
  //     .then(result => result.extractEvents.general.xcmpQueueMessageSent)
  //     .then(events => events[0].messageHash);

  //   await expectXcmpQueueSuccess(karuraApi, quartzMessageHash);

  //   const karuraTokenId = await karuraApi.query.xnft.assetInstanceToItem(karuraCollectionId, {Index: quartzTokenId})
  //     .then(data => data.toJSON() as number);
  //   dest = {V3: chain.quartz.multilocation.account(alice.addressRaw)};
  //   xnft = {
  //     V3: {
  //       id: {Concrete: chain.karura.multilocation.nftCollection(karuraCollectionId)},
  //       fun: {NonFungible: {Index: karuraTokenId}},
  //     },
  //   };
  //   fee = {
  //     V3: {
  //       id: {Concrete: chain.karura.multilocation.token.kar},
  //       fun: {Fungible: unit.kar(10)},
  //     },
  //   };
  //   await expect(sendAndWait(
  //     alice,
  //     karuraApi.tx.xTokens.transferMultiassetWithFee(
  //       xnft,
  //       fee,
  //       dest,
  //       'Unlimited',
  //     ),
  //   )).to.be.rejectedWith('xTokens.XcmExecutionFailed');
  // });

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
