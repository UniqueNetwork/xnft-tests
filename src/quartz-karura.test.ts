import {ApiPromise, Keyring, WsProvider} from '@polkadot/api';
import {describe} from 'mocha';
import {expect} from 'chai';
import {
  RELAY_KARURA_ID,
  RELAY_KARURA_URL,
  RELAY_QUARTZ_ID,
  RELAY_QUARTZ_URL,
  RELAY_URL,
  decimals,
  forceOpenHrmps,
  multilocation,
  registerForeignAssetOnKarura,
  registerForeignAssetOnQuartz,
  strUtf16,
  unit,
  waitForParachainsStart,
} from './common';
import {IKeyringPair} from '@polkadot/types/types';
import {sendAndWait, toChainAddressFormat, palletSubAccount, expectXcmpQueueSuccess} from './util';

describe('cross-transfer NFTs between Quartz and Karura', () => {
  let relayApi: ApiPromise;
  let quartzApi: ApiPromise;
  let karuraApi: ApiPromise;

  let alice: IKeyringPair;
  let bob: IKeyringPair;

  before(async () => {
    relayApi = await ApiPromise.create({provider: new WsProvider(RELAY_URL)});
    quartzApi = await ApiPromise.create({provider: new WsProvider(RELAY_QUARTZ_URL)});
    karuraApi = await ApiPromise.create({provider: new WsProvider(RELAY_KARURA_URL)});

    const keyring = new Keyring({type: 'sr25519'});
    alice = keyring.addFromUri('//Alice');
    bob = keyring.addFromUri('//Bob');

    await waitForParachainsStart(relayApi);
    await forceOpenHrmps(relayApi, alice, RELAY_QUARTZ_ID, RELAY_KARURA_ID);
  });

  it('transfer Quartz NFT to Karura and back', async () => {
    console.log('=== transfer Quartz NFT to Karura and back ===');

    await registerForeignAssetOnKarura(
      karuraApi,
      alice,
      multilocation.quartz.parachain,
      {
        name: 'Quartz',
        symbol: 'QTZ',
        decimals: decimals.quartz,
        minimalBalance: unit.qtz(1),
      },
    );

    const quartzCollectionId = await sendAndWait(alice, quartzApi.tx.unique.createCollectionEx({
      mode: 'NFT',
      tokenPrefix: 'xNFT',
    }))
      .then(result => result.extractEvents.quartz.collectionCreated)
      .then(events => events[0].collectionId);
    console.log(`[XNFT] created NFT collection #${quartzCollectionId} on Quartz`);

    const karuraCollectionId = await sendAndWait(
      alice,
      karuraApi.tx.sudo.sudo(karuraApi.tx.xnft.registerAsset({
        Concrete: multilocation.quartz.nftCollection(quartzCollectionId),
      })),
    )
      .then(result => result.extractEvents.karura.xnftAssetRegistered)
      .then(events => events[0].collectionId);
    console.log(`[XNFT] registered "Karura/Collection(#${karuraCollectionId})" backed by "Quartz/Collection(#${quartzCollectionId})"`);

    const quartzTokenId = await sendAndWait(alice, quartzApi.tx.unique.createItem(
      quartzCollectionId,
      {Substrate: bob.address},
      'NFT',
    ))
      .then(result => result.extractEvents.quartz.itemCreated)
      .then(events => events[0].tokenId);
    console.log(`[XNFT] minted NFT "Quartz/Collection(#${quartzCollectionId})/NFT(#${quartzTokenId})"`);

    let dest: any = {V3: multilocation.karura.account(bob.addressRaw)};
    let assets: any = {
      V3: [
        {
          id: {Concrete: multilocation.quartz.parachain},
          fun: {Fungible: unit.qtz(10)},
        },
        {
          id: {Concrete: multilocation.quartz.nftCollection(quartzCollectionId)},
          fun: {NonFungible: {Index: quartzTokenId}},
        },
      ],
    };
    let feeAssetItem = 0;
    const quartzMessageHash = await sendAndWait(
      bob,
      quartzApi.tx.xTokens.transferMultiassets(
        assets,
        feeAssetItem,
        dest,
        'Unlimited',
      ),
    )
      .then(result => result.extractEvents.general.xcmpQueueMessageSent)
      .then(events => events[0].messageHash);
    console.log(`[XNFT] sent "Quartz/Collection(#${quartzCollectionId})/NFT(#${quartzTokenId})" to Karura`);
    console.log(`\t... message hash: ${quartzMessageHash}`);

    await expectXcmpQueueSuccess(karuraApi, quartzMessageHash);

    const karuraTokenId = await karuraApi.query.xnft.itemsMapping(karuraCollectionId, {Index: quartzTokenId})
      .then(data => data.toJSON() as number);
    console.log(`[XNFT] minted NFT Karura/Collection(#${karuraCollectionId})/NFT(#${karuraTokenId})`);
    console.log(`\t... backed by Quartz/Collection(#${quartzCollectionId})/NFT(#${quartzTokenId})`);

    const derivativeNftData: any = await karuraApi.query.ormlNFT.tokens(karuraCollectionId, karuraTokenId)
      .then(data => data.toJSON());

    expect(derivativeNftData.owner).to.be.equal(await toChainAddressFormat(karuraApi, bob.address));
    console.log('[XNFT] the owner of the derivative NFT is correct');

    assets = {
      V3: [
        {
          id: {Concrete: multilocation.quartz.parachain},
          fun: {Fungible: unit.qtz(1)},
        },
        {
          id: {Concrete: multilocation.quartz.nftCollection(quartzCollectionId)},
          fun: {NonFungible: {Index: quartzTokenId}},
        },
      ],
    };
    feeAssetItem = 0;
    dest = {V3: multilocation.quartz.account(alice.addressRaw)};
    const karuraMessageHash = await sendAndWait(
      bob,
      karuraApi.tx.xTokens.transferMultiassets(
        assets,
        feeAssetItem,
        dest,
        'Unlimited',
      ),
    )
      .then(result => result.extractEvents.general.xcmpQueueMessageSent)
      .then(events => events[0].messageHash);
    console.log(`[XNFT] sent "Quartz/Collection(#${quartzCollectionId})/NFT(#${quartzTokenId})" back to Quartz to Alice`);
    console.log(`\t... message hash: ${karuraMessageHash}`);

    await expectXcmpQueueSuccess(quartzApi, karuraMessageHash);

    await quartzApi.query.nonfungible.owned(
      quartzCollectionId,
      {Substrate: alice.address},
      quartzTokenId,
    ).then(isOwned => expect(isOwned.toJSON()).to.be.true);
    console.log(`[XNFT] Alice owns the returned "Quartz/Collection(#${quartzCollectionId})/NFT(#${quartzTokenId})"`);
  });

  it('transfer Karura NFT to Quartz and back', async () => {
    console.log('=== transfer Karura NFT to Quartz and back ===');

    await registerForeignAssetOnQuartz(
      quartzApi,
      alice,
      {Concrete: multilocation.karura.token.kar},
      {
        name: 'Karura',
        tokenPrefix: 'KAR',
        mode: {Fungible: decimals.karura},
      },
    );

    const enableAllCollectionFeatures = 0xF;
    const emptyAttributes = karuraApi.createType('BTreeMap<Bytes, Bytes>', {});
    const karuraCollectionId = await sendAndWait(alice, karuraApi.tx.nft.createClass(
      'xNFT Collection',
      enableAllCollectionFeatures,
      emptyAttributes,
    ))
      .then(result => result.extractEvents.karura.nftCreatedClass)
      .then(events => events[0].classId);
    const karuraCollectionAccount = await palletSubAccount(karuraApi, 'aca/aNFT', karuraCollectionId);

    console.log(`[XNFT] created NFT collection #${karuraCollectionId} on Karura`);
    console.log(`\t... the collection account: ${karuraCollectionAccount}`);

    await sendAndWait(alice, karuraApi.tx.balances.transfer({Id: karuraCollectionAccount}, unit.kar(10)));
    console.log('\t... sponsored the collection account');

    const quartzCollectionId = await sendAndWait(
      alice,
      quartzApi.tx.sudo.sudo(quartzApi.tx.foreignAssets.forceRegisterForeignAsset(
        {Concrete: multilocation.karura.nftCollection(karuraCollectionId)},
        strUtf16('Karura NFT'),
        'xNFT',
        'NFT',
      )),
    )
      .then(result => result.extractEvents.quartz.collectionCreated)
      .then(events => events[0].collectionId);

    console.log(`[XNFT] registered "Quartz/Collection(#${quartzCollectionId})" backed by "Karura/Collection(#${karuraCollectionId})"`);

    const karuraTokenId = await karuraApi.query.ormlNFT.nextTokenId(karuraCollectionId);
    await sendAndWait(alice, karuraApi.tx.proxy.proxy(
      {Id: karuraCollectionAccount},
      'Any',
      karuraApi.tx.nft.mint(
        {Id: bob.address},
        karuraCollectionId,
        'xNFT',
        emptyAttributes,
        1,
      ),
    ));
    console.log(`[XNFT] minted NFT "Karura/Collection(#${karuraCollectionId})/NFT(#${karuraTokenId})"`);

    let assets: any = {
      V3: [
        {
          id: {Concrete: multilocation.karura.token.kar},
          fun: {Fungible: unit.kar(1)},
        },
        {
          id: {Concrete: multilocation.karura.nftCollection(karuraCollectionId)},
          fun: {NonFungible: {Index: karuraTokenId}},
        },
      ],
    };
    let feeAssetItem = 0;
    let dest: any = {V3: multilocation.quartz.account(bob.addressRaw)};
    const karuraMessageHash = await sendAndWait(bob, karuraApi.tx.xTokens.transferMultiassets(
      assets,
      feeAssetItem,
      dest,
      'Unlimited',
    ))
      .then(result => result.extractEvents.general.xcmpQueueMessageSent)
      .then(events => events[0].messageHash);
    console.log(`[XNFT] sent "Karura/Collection(#${karuraCollectionId})/NFT(#${karuraTokenId})" to Karura`);
    console.log(`\t... message hash: ${karuraMessageHash}`);

    await expectXcmpQueueSuccess(quartzApi, karuraMessageHash);

    const quartzTokenId = await quartzApi.query.foreignAssets.foreignReserveAssetInstanceToTokenId(
      quartzCollectionId,
      {Index: karuraTokenId},
    ).then(data => data.toJSON() as number);
    console.log(`[XNFT] minted NFT "Quartz/Collection(#${quartzCollectionId})/NFT(#${quartzTokenId})"`);
    console.log(`\t... backed by "Karura/Collection(#${karuraCollectionId})/NFT(#${karuraTokenId})"`);

    await quartzApi.query.nonfungible.owned(
      quartzCollectionId,
      {Substrate: bob.address},
      quartzTokenId,
    ).then(isOwned => expect(isOwned.toJSON()).to.be.true);
    console.log('[XNFT] the owner of the derivative NFT is correct');

    assets = {
      V3: [
        {
          id: {Concrete: multilocation.karura.token.kar},
          fun: {Fungible: unit.kar(1)},
        },
        {
          id: {Concrete: multilocation.karura.nftCollection(karuraCollectionId)},
          fun: {NonFungible: {Index: karuraTokenId}},
        },
      ],
    };
    feeAssetItem = 0;
    dest = {V3: multilocation.karura.account(alice.addressRaw)};
    const quartzMessageHash = await sendAndWait(
      bob,
      quartzApi.tx.xTokens.transferMultiassets(
        assets,
        feeAssetItem,
        dest,
        'Unlimited',
      ),
    )
      .then(result => result.extractEvents.general.xcmpQueueMessageSent)
      .then(events => events[0].messageHash);
    console.log(`[XNFT] sent "Karura/Collection(#${karuraCollectionId})/NFT(#${karuraTokenId})" back to Karura to Alice`);
    console.log(`\t... message hash: ${quartzMessageHash}`);

    await expectXcmpQueueSuccess(karuraApi, quartzMessageHash);

    const karuraTokenData: any = await karuraApi.query.ormlNFT.tokens(karuraCollectionId, karuraTokenId)
      .then(data => data.toJSON());

    expect(karuraTokenData.owner).to.be.equal(await toChainAddressFormat(karuraApi, alice.address));
    console.log(`[XNFT] Alice owns the returned "Karura/Collection(#${karuraCollectionId})/NFT(#${karuraTokenId})"`);
  });

  after(async () => {
    await karuraApi.disconnect();
    await quartzApi.disconnect();
    await relayApi.disconnect();
  });
});
