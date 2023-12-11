import {ApiPromise, Keyring, WsProvider} from '@polkadot/api';
import {describe} from 'mocha';
import chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
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

chai.use(chaiAsPromised);
const expect = chai.expect;

describe('Quartz/Karura XNFT tests', () => {
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
  });

  it('transfer Quartz NFT to Karura and back', async () => {
    console.log('=== transfer Quartz NFT to Karura and back ===');

    const quartzCollectionId = await createQuartzCollection(quartzApi, alice);
    const karuraCollectionId = await registerQuartzCollectionOnKarura(karuraApi, alice, quartzCollectionId);

    const quartzTokenId = await mintQuartzNft(quartzApi, alice, {
      collectionId: quartzCollectionId,
      owner: bob.address,
    });

    const xnft = {
      V3: {
        id: {Concrete: multilocation.quartz.nftCollection(quartzCollectionId)},
        fun: {NonFungible: {Index: quartzTokenId}},
      },
    };

    let fee = {
      V3: {
        id: {Concrete: multilocation.quartz.parachain},
        fun: {Fungible: unit.qtz(10)},
      },
    };
    let dest = {V3: multilocation.karura.account(bob.addressRaw)};
    const quartzMessageHash = await sendAndWait(
      bob,
      quartzApi.tx.xTokens.transferMultiassetWithFee(
        xnft,
        fee,
        dest,
        'Unlimited',
      ),
    )
      .then(result => result.extractEvents.general.xcmpQueueMessageSent)
      .then(events => events[0].messageHash);
    console.log(`[XNFT] sent "Quartz/Collection(#${quartzCollectionId})/NFT(#${quartzTokenId})" to Karura`);
    console.log(`\t... message hash: ${quartzMessageHash}`);

    await expectXcmpQueueSuccess(karuraApi, quartzMessageHash);

    const karuraTokenId = await karuraApi.query.xnft.foreignInstanceToDerivativeStatus(karuraCollectionId, {Index: quartzTokenId})
      .then(data => data.toJSON() as any)
      .then(data => data.active);

    console.log(`[XNFT] minted NFT Karura/Collection(#${karuraCollectionId})/NFT(#${karuraTokenId})`);
    console.log(`\t... backed by Quartz/Collection(#${quartzCollectionId})/NFT(#${quartzTokenId})`);

    const derivativeNftData: any = await karuraApi.query.ormlNFT.tokens(karuraCollectionId, karuraTokenId)
      .then(data => data.toJSON());

    expect(derivativeNftData.owner).to.be.equal(await toChainAddressFormat(karuraApi, bob.address));
    console.log('[XNFT] the owner of the derivative NFT is correct');

    fee = {
      V3: {
        id: {Concrete: multilocation.quartz.parachain},
        fun: {Fungible: unit.qtz(1)},
      },
    };
    dest = {V3: multilocation.quartz.account(alice.addressRaw)};
    const karuraMessageHash = await sendAndWait(
      bob,
      karuraApi.tx.xTokens.transferMultiassetWithFee(
        xnft,
        fee,
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

    const karuraCollectionId = await createKaruraCollection(karuraApi, alice);
    const quartzCollectionId = await registerKaruraCollectionOnQuartz(quartzApi, alice, karuraCollectionId);

    const karuraTokenId = await mintKaruraNft(karuraApi, alice, {
      collectionId: karuraCollectionId,
      owner: bob.address,
    });

    const xnft = {
      V3: {
        id: {Concrete: multilocation.karura.nftCollection(karuraCollectionId)},
        fun: {NonFungible: {Index: karuraTokenId}},
      },
    };

    let fee = {
      V3: {
        id: {Concrete: multilocation.karura.token.kar},
        fun: {Fungible: unit.kar(10)},
      },
    };
    let dest = {V3: multilocation.quartz.account(bob.addressRaw)};
    const karuraMessageHash = await sendAndWait(
      bob,
      karuraApi.tx.xTokens.transferMultiassetWithFee(
        xnft,
        fee,
        dest,
        'Unlimited',
      ),
    )
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

    fee = {
      V3: {
        id: {Concrete: multilocation.karura.token.kar},
        fun: {Fungible: unit.kar(1)},
      },
    };
    dest = {V3: multilocation.karura.account(alice.addressRaw)};
    const quartzMessageHash = await sendAndWait(
      bob,
      quartzApi.tx.xTokens.transferMultiassetWithFee(
        xnft,
        fee,
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

  it('transfer derivative of Karura NFT within Quartz using native API', async () => {
    console.log('=== transfer derivative of Karura NFT within Quartz using native API ===');

    const karuraCollectionId = await createKaruraCollection(karuraApi, alice);
    const quartzCollectionId = await registerKaruraCollectionOnQuartz(quartzApi, alice, karuraCollectionId);

    const karuraTokenId = await mintKaruraNft(karuraApi, alice, {
      collectionId: karuraCollectionId,
      owner: bob.address,
    });

    const xnft = {
      V3: {
        id: {Concrete: multilocation.karura.nftCollection(karuraCollectionId)},
        fun: {NonFungible: {Index: karuraTokenId}},
      },
    };

    const fee = {
      V3: {
        id: {Concrete: multilocation.karura.token.kar},
        fun: {Fungible: unit.kar(10)},
      },
    };
    const dest = {V3: multilocation.quartz.account(bob.addressRaw)};
    const karuraMessageHash = await sendAndWait(
      bob,
      karuraApi.tx.xTokens.transferMultiassetWithFee(
        xnft,
        fee,
        dest,
        'Unlimited',
      ),
    )
      .then(result => result.extractEvents.general.xcmpQueueMessageSent)
      .then(events => events[0].messageHash);

    await expectXcmpQueueSuccess(quartzApi, karuraMessageHash);

    const quartzTokenId = await quartzApi.query.foreignAssets.foreignReserveAssetInstanceToTokenId(
      quartzCollectionId,
      {Index: karuraTokenId},
    ).then(data => data.toJSON() as number);

    await sendAndWait(
      bob,
      quartzApi.tx.unique.transfer(
        {Substrate: alice.address},
        quartzCollectionId,
        quartzTokenId,
        1,
      ),
    );
    console.log(`[XNFT] Bob sent the derivative NFT ${quartzCollectionId}/#${quartzTokenId} to Alice`);

    await quartzApi.query.nonfungible.owned(
      quartzCollectionId,
      {Substrate: alice.address},
      quartzTokenId,
    ).then(isOwned => expect(isOwned.toJSON()).to.be.true);
    console.log('[XNFT] Alice received the derivative NFT');
  });

  it('Quartz cannot act as the reserve for the derivative of Karura NFT', async () => {
    console.log('=== Quartz cannot act as the reserve for the derivative of Karura NFT ===');

    const karuraCollectionId = await createKaruraCollection(karuraApi, alice);
    const quartzCollectionId = await registerKaruraCollectionOnQuartz(quartzApi, alice, karuraCollectionId);

    const karuraTokenId = await mintKaruraNft(karuraApi, alice, {
      collectionId: karuraCollectionId,
      owner: bob.address,
    });

    let xnft: any = {
      V3: {
        id: {Concrete: multilocation.karura.nftCollection(karuraCollectionId)},
        fun: {NonFungible: {Index: karuraTokenId}},
      },
    };
    let fee: any = {
      V3: {
        id: {Concrete: multilocation.karura.token.kar},
        fun: {Fungible: unit.kar(10)},
      },
    };
    let dest = {V3: multilocation.quartz.account(bob.addressRaw)};
    const karuraMessageHash = await sendAndWait(
      bob,
      karuraApi.tx.xTokens.transferMultiassetWithFee(
        xnft,
        fee,
        dest,
        'Unlimited',
      ),
    )
      .then(result => result.extractEvents.general.xcmpQueueMessageSent)
      .then(events => events[0].messageHash);

    await expectXcmpQueueSuccess(quartzApi, karuraMessageHash);

    const quartzTokenId = await quartzApi.query.foreignAssets.foreignReserveAssetInstanceToTokenId(
      quartzCollectionId,
      {Index: karuraTokenId},
    ).then(data => data.toJSON() as number);

    dest = {V3: multilocation.karura.account(alice.addressRaw)};
    xnft = {
      V3: {
        id: {Concrete: multilocation.quartz.nftCollection(quartzCollectionId)},
        fun: {NonFungible: {Index: quartzTokenId}},
      },
    };
    fee = {
      V3: {
        id: {Concrete: multilocation.quartz.parachain},
        fun: {Fungible: unit.qtz(10)},
      },
    };
    await expect(sendAndWait(
      alice,
      quartzApi.tx.xTokens.transferMultiassetWithFee(
        xnft,
        fee,
        dest,
        'Unlimited',
      ),
    )).to.be.rejectedWith('xTokens.XcmExecutionFailed');
  });

  it('transfer derivative of Quartz NFT within Karura using native API', async () => {
    console.log('=== transfer derivative of Quartz NFT within Karura using native API ===');

    const quartzCollectionId = await createQuartzCollection(quartzApi, alice);
    const karuraCollectionId = await registerQuartzCollectionOnKarura(karuraApi, alice, quartzCollectionId);

    const quartzTokenId = await mintQuartzNft(quartzApi, alice, {
      collectionId: quartzCollectionId,
      owner: bob.address,
    });

    const xnft = {
      V3: {
        id: {Concrete: multilocation.quartz.nftCollection(quartzCollectionId)},
        fun: {NonFungible: {Index: quartzTokenId}},
      },
    };
    const fee = {
      V3: {
        id: {Concrete: multilocation.quartz.parachain},
        fun: {Fungible: unit.qtz(10)},
      },
    };
    const dest = {V3: multilocation.karura.account(bob.addressRaw)};
    const quartzMessageHash = await sendAndWait(
      bob,
      quartzApi.tx.xTokens.transferMultiassetWithFee(
        xnft,
        fee,
        dest,
        'Unlimited',
      ),
    )
      .then(result => result.extractEvents.general.xcmpQueueMessageSent)
      .then(events => events[0].messageHash);

    await expectXcmpQueueSuccess(karuraApi, quartzMessageHash);

    const karuraTokenId = await karuraApi.query.xnft.foreignInstanceToDerivativeStatus(karuraCollectionId, {Index: quartzTokenId})
      .then(data => data.toJSON() as any)
      .then(data => data.active);

    await sendAndWait(
      bob,
      karuraApi.tx.nft.transfer(
        {Id: alice.address},
        [karuraCollectionId, karuraTokenId],
      ),
    );
    console.log(`[XNFT] Bob sent the derivative NFT ${karuraCollectionId}/#${karuraTokenId} to Alice`);

    const derivativeNftData: any = await karuraApi.query.ormlNFT.tokens(karuraCollectionId, karuraTokenId)
      .then(data => data.toJSON());

    expect(derivativeNftData.owner).to.be.equal(await toChainAddressFormat(karuraApi, alice.address));
    console.log('[XNFT] Alice received the derivative NFT');
  });

  it('Karura cannot act as the reserve for the derivative of Quartz NFT', async () => {
    console.log('=== Karura cannot act as the reserve for the derivative of Quartz NFT ===');

    const quartzCollectionId = await createQuartzCollection(quartzApi, alice);
    const karuraCollectionId = await registerQuartzCollectionOnKarura(karuraApi, alice, quartzCollectionId);

    const quartzTokenId = await mintQuartzNft(quartzApi, alice, {
      collectionId: quartzCollectionId,
      owner: bob.address,
    });

    let xnft: any = {
      V3: {
        id: {Concrete: multilocation.quartz.nftCollection(quartzCollectionId)},
        fun: {NonFungible: {Index: quartzTokenId}},
      },
    };
    let fee: any = {
      V3: {
        id: {Concrete: multilocation.quartz.parachain},
        fun: {Fungible: unit.qtz(10)},
      },
    };
    let dest = {V3: multilocation.karura.account(bob.addressRaw)};
    const quartzMessageHash = await sendAndWait(
      bob,
      quartzApi.tx.xTokens.transferMultiassetWithFee(
        xnft,
        fee,
        dest,
        'Unlimited',
      ),
    )
      .then(result => result.extractEvents.general.xcmpQueueMessageSent)
      .then(events => events[0].messageHash);

    await expectXcmpQueueSuccess(karuraApi, quartzMessageHash);

    const karuraTokenId = await karuraApi.query.xnft.foreignInstanceToDerivativeStatus(karuraCollectionId, {Index: quartzTokenId})
      .then(data => data.toJSON() as any)
      .then(data => data.active);

    dest = {V3: multilocation.quartz.account(alice.addressRaw)};
    xnft = {
      V3: {
        id: {Concrete: multilocation.karura.nftCollection(karuraCollectionId)},
        fun: {NonFungible: {Index: karuraTokenId}},
      },
    };
    fee = {
      V3: {
        id: {Concrete: multilocation.karura.token.kar},
        fun: {Fungible: unit.kar(10)},
      },
    };
    await expect(sendAndWait(
      alice,
      karuraApi.tx.xTokens.transferMultiassetWithFee(
        xnft,
        fee,
        dest,
        'Unlimited',
      ),
    )).to.be.rejectedWith('xTokens.XcmExecutionFailed');
  });

  after(async () => {
    await karuraApi.disconnect();
    await quartzApi.disconnect();
    await relayApi.disconnect();
  });
});

const createQuartzCollection = async (api: ApiPromise, signer: IKeyringPair) => {
  const quartzCollectionId = await sendAndWait(signer, api.tx.unique.createCollectionEx({
    mode: 'NFT',
    tokenPrefix: 'xNFT',
  }))
    .then(result => result.extractEvents.quartz.collectionCreated)
    .then(events => events[0].collectionId);
  console.log(`[XNFT] created NFT collection #${quartzCollectionId} on Quartz`);

  return quartzCollectionId;
};

const mintQuartzNft = async (api: ApiPromise, signer: IKeyringPair, options: {
  collectionId: number,
  owner: string,
}) => {
  const quartzTokenId = await sendAndWait(signer, api.tx.unique.createItem(
    options.collectionId,
    {Substrate: options.owner},
    'NFT',
  ))
    .then(result => result.extractEvents.quartz.itemCreated)
    .then(events => events[0].tokenId);

  console.log(`[XNFT] minted NFT "Quartz/Collection(#${options.collectionId})/NFT(#${quartzTokenId})"`);
  return quartzTokenId;
};

const registerQuartzCollectionOnKarura = async (
  api: ApiPromise,
  signer: IKeyringPair,
  quartzCollectionId: number,
) => {
  const karuraCollectionId = await sendAndWait(
    signer,
    api.tx.sudo.sudo(api.tx.xnft.registerAsset({
      V3: {
        Concrete: multilocation.quartz.nftCollection(quartzCollectionId),
      },
    })),
  )
    .then(result => result.extractEvents.karura.xnftAssetRegistered)
    .then(events => events[0].collectionId);

  console.log(`[XNFT] registered "Karura/Collection(#${karuraCollectionId})" backed by "Quartz/Collection(#${quartzCollectionId})"`);
  return karuraCollectionId;
};

const createKaruraCollection = async (api: ApiPromise, signer: IKeyringPair) => {
  const enableAllCollectionFeatures = 0xF;
  const emptyAttributes = api.createType('BTreeMap<Bytes, Bytes>', {});
  const karuraCollectionId = await sendAndWait(signer, api.tx.nft.createClass(
    'xNFT Collection',
    enableAllCollectionFeatures,
    emptyAttributes,
  ))
    .then(result => result.extractEvents.karura.nftCreatedClass)
    .then(events => events[0].classId);
  const karuraCollectionAccount = await palletSubAccount(api, 'aca/aNFT', karuraCollectionId);

  console.log(`[XNFT] created NFT collection #${karuraCollectionId} on Karura`);
  console.log(`\t... the collection account: ${karuraCollectionAccount}`);

  await sendAndWait(signer, api.tx.balances.transferKeepAlive({Id: karuraCollectionAccount}, unit.kar(10)));
  console.log('\t... sponsored the collection account');

  return karuraCollectionId;
};

const mintKaruraNft = async (api: ApiPromise, signer: IKeyringPair, options: {
  collectionId: number,
  owner: string,
}) => {
  const karuraTokenId = await api.query.ormlNFT.nextTokenId(options.collectionId);
  const collectionAccount = await palletSubAccount(api, 'aca/aNFT', options.collectionId);
  const emptyAttributes = api.createType('BTreeMap<Bytes, Bytes>', {});

  await sendAndWait(signer, api.tx.proxy.proxy(
    {Id: collectionAccount},
    'Any',
    api.tx.nft.mint(
      {Id: options.owner},
      options.collectionId,
      'xNFT',
      emptyAttributes,
      1,
    ),
  ));

  console.log(`[XNFT] minted NFT "Karura/Collection(#${options.collectionId})/NFT(#${karuraTokenId})"`);
  return karuraTokenId;
};

const registerKaruraCollectionOnQuartz = async (
  api: ApiPromise,
  signer: IKeyringPair,
  karuraCollectionId: number,
) => {
  const quartzCollectionId = await sendAndWait(
    signer,
    api.tx.sudo.sudo(api.tx.foreignAssets.forceRegisterForeignAsset(
      {
        V3: {
          Concrete: multilocation.karura.nftCollection(karuraCollectionId),
        },
      },
      strUtf16('Karura NFT'),
      'xNFT',
      'NFT',
    )),
  )
    .then(result => result.extractEvents.quartz.collectionCreated)
    .then(events => events[0].collectionId);

  console.log(`[XNFT] registered "Quartz/Collection(#${quartzCollectionId})" backed by "Karura/Collection(#${karuraCollectionId})"`);
  return quartzCollectionId;
};
