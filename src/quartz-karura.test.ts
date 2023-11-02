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
  toChainAddressFormat,
  unit,
  waitForParachainsStart,
} from './common';
import {IKeyringPair} from '@polkadot/types/types';
import {sendAndWait, waitForEvent} from './util';

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

  it('Transfer Quartz NFT to Karura and back', async () => {
    await registerForeignAssetOnKarura(karuraApi, alice, {
      name: 'Quartz',
      symbol: 'QTZ',
      decimals: decimals.quartz,
      minimalBalance: unit.qtz(1),
    });

    const quartzCollectionId = await sendAndWait(alice, quartzApi.tx.unique.createCollectionEx({
      mode: 'NFT',
      tokenPrefix: 'xNFT',
    }))
      .then(result => result.extractEvent.quartz.collectionCreated)
      .then(data => data.collectionId);
    console.log(`[XNFT] created NFT collection #${quartzCollectionId} on Quartz`);

    const karuraCollectionId = await sendAndWait(alice, karuraApi.tx.xnft.registerAsset({
      Concrete: multilocation.quartz.nftCollection(quartzCollectionId),
    }))
      .then(result => result.extractEvent.karura.xnftAssetRegistered)
      .then(data => data.collectionId);
    console.log(`[XNFT] registered Karura/Collection(#${karuraCollectionId}) backed by Quartz/Collection(#${quartzCollectionId})`);

    const quartzTokenId = await sendAndWait(alice, quartzApi.tx.unique.createItem(
      quartzCollectionId,
      {Substrate: bob.address},
      'NFT',
    ))
      .then(result => result.extractEvent.quartz.itemCreated)
      .then(data => data.tokenId);
    console.log(`[XNFT] minted NFT "Quartz/Collection(#${quartzCollectionId})/NFT(#${quartzTokenId})"`);

    let dest: any = {V3: multilocation.karura.parachain};
    const beneficiary = {V3: multilocation.account(bob.addressRaw)};
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
    let quartzMessageHash = await sendAndWait(bob, quartzApi.tx.polkadotXcm.limitedReserveTransferAssets(
      dest,
      beneficiary,
      assets,
      feeAssetItem,
      'Unlimited',
    ))
      .then(result => result.extractEvent.general.xcmpQueueMessageSent)
      .then(data => data.messageHash);
    console.log(`[XNFT] sent "Quartz/Collection(#${quartzCollectionId})/NFT(#${quartzTokenId})" to Karura`);
    console.log(`\t... message hash: ${quartzMessageHash}`);

    let karuraMessageHash = await waitForEvent(karuraApi).general.xcmpQueueSuccess.then(data => data.messageHash);
    expect(karuraMessageHash).to.be.equal(quartzMessageHash);
    console.log(`[XNFT] Karura received the correct message from Quartz: ${karuraMessageHash}`);

    const karuraTokenId = (await karuraApi.query.xnft.itemsMapping(karuraCollectionId, {Index: quartzTokenId})).toJSON() as number;
    console.log(`[XNFT] minted NFT Karura/Collection(#${karuraCollectionId})/NFT(#${karuraTokenId})`);
    console.log(`\t... backed by Quartz/Collection(#${quartzCollectionId})/NFT(#${quartzTokenId})`);

    const derivativeNftData: any = (await karuraApi.query.ormlNFT.tokens(karuraCollectionId, karuraTokenId)).toJSON()!;

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
    dest = {V3: multilocation.quartz.account(bob.addressRaw)};
    karuraMessageHash = await sendAndWait(
      bob,
      karuraApi.tx.xTokens.transferMultiassets(
        assets,
        feeAssetItem,
        dest,
        'Unlimited',
      ),
    )
      .then(result => result.extractEvent.general.xcmpQueueMessageSent)
      .then(data => data.messageHash);
    console.log(`[XNFT] sent "Quartz/Collection(#${quartzCollectionId})/NFT(#${quartzTokenId})" back to Quartz`);
    console.log(`\t... message hash: ${karuraMessageHash}`);

    quartzMessageHash = await waitForEvent(karuraApi).general.xcmpQueueSuccess.then(data => data.messageHash);
    expect(karuraMessageHash).to.be.equal(quartzMessageHash);
    console.log(`[XNFT] Quartz received the correct message from Quartz: ${quartzMessageHash}`);
  });

  after(async () => {
    await karuraApi.disconnect();
    await quartzApi.disconnect();
    await relayApi.disconnect();
  });
});
