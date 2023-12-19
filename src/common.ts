import {ApiPromise, WsProvider} from '@polkadot/api';
import {Option} from '@polkadot/types';
import {HrmpChannel} from '@polkadot/types/interfaces';
import {IKeyringPair} from '@polkadot/types/types';
import {hexToString} from '@polkadot/util';
import {adjustToDecimals, chainNativeCurrencyInfo, expectXcmpQueueSuccess, palletSubAccount, paraChildSovereignAccount, paraSiblingSovereignAccount, sendAndWait, strUtf16, toChainAddressFormat, waitForEvents} from './util';
import {expect} from 'chai';
import {decodeAddress} from '@polkadot/util-crypto';

export const RELAY_URL = process.env.RELAY_URL;
export const RELAY_QUARTZ_URL = process.env.RELAY_QUARTZ_URL;
export const RELAY_KARURA_URL = process.env.RELAY_KARURA_URL;

export const RELAY_QUARTZ_ID = +(process.env.RELAY_QUARTZ_ID || 2095);
export const RELAY_KARURA_ID = +(process.env.RELAY_KARURA_ID || 2000);

export interface IMultilocation {
  parents: number;
  interior: IInterior;
}

export type IFungibility = {
  Fungible: bigint,
} | {
  NonFungible: IAssetInstance,
};

export type IAssetInstance = 'Undefined' | {
  Index: number,
} | {
  Array4: string,
} | {
  Array8: string,
} | {
  Array16: string,
} | {
  Array32: string,
};

export type IAssetId = {
  Concrete: IMultilocation,
} | {
  Abstract: string
};

export interface IMultiAsset {
  id: IAssetId;
  fun: IFungibility;
}

export type IInterior = 'Here' | {
  X1: IJunction
} | {
  X2: IJunction[]
} | {
  X3: IJunction[]
} | {
  X4: IJunction[]
} | {
  X5: IJunction[]
} | {
  X6: IJunction[]
} | {
  X7: IJunction[]
} | {
  X8: IJunction[]
};

export type IJunction =
  IJunctionAccountId32
  | IJunctionParachain
  | IJunctionPalletInstance
  | IJunctionGeneralKey
  | IJunctionGeneralIndex;

export interface IJunctionAccountId32 {
  network: string | null,
  id: Uint8Array,
}

export interface IJunctionParachain {
  Parachain: number;
}

export interface IJunctionPalletInstance {
  PalletInstance: number;
}

export interface IJunctionGeneralIndex {
  GeneralIndex: number;
}

export interface IJunctionGeneralKey {
  GeneralKey: {
    length: number,
    data: string,
  }
}

export interface ICurrency {
  id: IAssetId;
  decimals: number;
  amount: (value: number) => bigint;
  symbol: string;
  asMultiasset: (value: number) => IMultiAsset;
}

export interface IChainLocations {
  self: IMultilocation;
  account: (address: Uint8Array) => IMultilocation;
  paraSovereignAccount: (paraId: number) => string;
}

export interface IChain {
  api: ApiPromise;
  name: string;
  locations: IChainLocations;
  nativeCurrency: ICurrency;
}

export interface IXcmNft<CollectionId, TokenId> {
  collectionAssetId: (collectionId: CollectionId) => IAssetId;
  assetInstance: (tokenId: TokenId) => IAssetInstance;
  checkTokenOwner: (collectionId: CollectionId, tokenId: TokenId, expectedOwner: string) => Promise<boolean>;
}

export interface IParachain<CollectionId, TokenId> extends IChain {
  paraId: number;
  xcmNft: IXcmNft<CollectionId, TokenId>;
}

export class Relay implements IChain {
  api: ApiPromise;
  name: string;
  locations: IChainLocations;
  nativeCurrency: ICurrency;

  private constructor(chain: IChain) {
    this.api = chain.api;
    this.name = chain.name;
    this.locations = chain.locations;
    this.nativeCurrency = chain.nativeCurrency;
  }

  public static async connect() {
    const relayApi = await ApiPromise.create({provider: new WsProvider(RELAY_URL)});
    const decimals = 12;
    const symbol = 'ROC';

    const relayLocation: IMultilocation = {
      parents: 1,
      interior: 'Here',
    };

    const chain: IChain = {
      api: relayApi,
      name: 'Relay',
      locations: {
        self: relayLocation,
        account: (address: Uint8Array) => ({
          parents: 0,
          interior: {
            X1: {
              network: null,
              id: address,
            },
          },
        }),
        paraSovereignAccount: (paraId: number) => paraChildSovereignAccount(relayApi, paraId),
      },
      nativeCurrency: {
        id: {Concrete: relayLocation},
        decimals,
        symbol,
        amount: (value: number) => adjustToDecimals(value, decimals),
        asMultiasset: (value: number) => ({
          id: {Concrete: relayLocation},
          fun: {Fungible: adjustToDecimals(value, decimals)},
        }),
      },
    };

    return new Relay(chain);
  }

  async waitForParachainsStart() {
    const sessionId = (await this.api.query.session.currentIndex()).toJSON() as number;

    if(sessionId == 0) {
      console.log(`[XNFT] ${this.name}: parachains will start at the next relaychain session`);
      await waitForEvents(this, {maxBlocksToWait: 12}).general.newSession;
    }
  }

  async forceOpenHrmpDuplex(signer: IKeyringPair, firstParaId: number, secondParaId: number) {
    await this.forceOpenHrmpSimplex(signer, firstParaId, secondParaId);
    await this.forceOpenHrmpSimplex(signer, secondParaId, firstParaId);
  }

  async forceOpenHrmpSimplex(signer: IKeyringPair, firstParaId: number, secondParaId: number) {
    const hrmpChannel = await this.api.query.hrmp.hrmpChannels([firstParaId, secondParaId]) as Option<HrmpChannel>;
    if(hrmpChannel.isSome) {
      console.log(`[XNFT] ${this.name}: HRMP channel ${firstParaId} -> ${secondParaId} is already opened`);
    } else {
      await sendAndWait(signer, this.api.tx.sudo.sudo(this.api.tx.hrmp.forceOpenHrmpChannel(firstParaId, secondParaId, 8, 512)));
      console.log(`[XNFT] ${this.name}: opened HRMP channel ${firstParaId} -> ${secondParaId}`);
    }
  }
}

export class Quartz implements IParachain<number, number> {
  api: ApiPromise;
  paraId: number;
  name: string;
  locations: IChainLocations;
  nativeCurrency: ICurrency;
  xcmNft: IXcmNft<number, number>;
  xtokens: XTokens<number, number>;

  private constructor(chain: IParachain<number, number>) {
    this.api = chain.api;
    this.paraId = chain.paraId;
    this.name = chain.name;
    this.locations = chain.locations;
    this.nativeCurrency = chain.nativeCurrency;
    this.xcmNft = chain.xcmNft;
    this.xtokens = new XTokens(this);
  }

  public static async connect() {
    const quartzApi = await ApiPromise.create({provider: new WsProvider(RELAY_QUARTZ_URL)});
    const nativeCurrencyInfo = await chainNativeCurrencyInfo(quartzApi);
    const quartzLocation = parachainMultilocation(RELAY_QUARTZ_ID);

    const chain: IParachain<number, number> = {
      api: quartzApi,
      paraId: RELAY_QUARTZ_ID,
      name: 'Quartz',
      locations: {
        self: quartzLocation,
        account: parachainAccountMultilocation(RELAY_QUARTZ_ID),
        paraSovereignAccount: (paraId: number) => paraSiblingSovereignAccount(quartzApi, paraId),
      },
      xcmNft: {
        collectionAssetId: (collectionId: number) => ({
          Concrete: {
            parents: 1,
            interior: {
              X2: [
                {
                  Parachain: RELAY_QUARTZ_ID,
                },
                {
                  GeneralIndex: collectionId,
                },
              ],
            },
          },
        }),
        assetInstance: (tokenId: number) => ({
          Index: tokenId,
        }),
        checkTokenOwner: async (collectionId: number, tokenId: number, expectedOwner: string) => await quartzApi.query.nonfungible.owned(
          collectionId,
          {Substrate: expectedOwner},
          tokenId,
        ).then(isOwned => isOwned.toJSON() as boolean),
      },
      nativeCurrency: {
        id: {Concrete: quartzLocation},
        amount: (value: number) => adjustToDecimals(value, nativeCurrencyInfo.decimals),
        asMultiasset: (value: number) => ({
          id: {Concrete: quartzLocation},
          fun: {Fungible: adjustToDecimals(value, nativeCurrencyInfo.decimals)},
        }),
        ...nativeCurrencyInfo,
      },
    };

    return new Quartz(chain);
  }

  async registerForeignAsset(
    signer: IKeyringPair,
    assetId: IAssetId,
    metadata: {
      name: string,
      tokenPrefix: string,
      mode: 'NFT' | { Fungible: number },
    },
  ) {
    const collectionId = (await this.api.query.foreignAssets.foreignAssetToCollection(assetId)).toJSON();

    if(collectionId) {
      console.log(`[XNFT] ${this.name}: the foreign asset "${metadata.tokenPrefix}" is already registered`);
    } else {
      const collectionId = await sendAndWait(signer, this.api.tx.sudo.sudo(this.api.tx.foreignAssets.forceRegisterForeignAsset(
        {V3: assetId},
        strUtf16(metadata.name),
        metadata.tokenPrefix,
        metadata.mode,
      )))
        .then(data => data.extractEvents('common.CollectionCreated'))
        .then(events => events[0].data[0].toJSON() as number);

      const kind = (metadata.mode == 'NFT' ? 'NFT' : 'fungible');
      console.log(`[XNFT] ${this.name}: the ${kind} foreign asset "${metadata.name}" is registered as "${this.name}/Collection(${collectionId})"`);

      return collectionId;
    }
  }

  async createCollection(signer: IKeyringPair) {
    const collectionId = await sendAndWait(signer, this.api.tx.unique.createCollectionEx({
      mode: 'NFT',
      tokenPrefix: 'xNFT',
    }))
      .then(data => data.extractEvents('common.CollectionCreated'))
      .then(events => events[0].data[0].toJSON() as number);
    console.log(`[XNFT] ${this.name}: created "${this.name}/Collection(${collectionId})"`);

    return collectionId;
  }

  async mintToken(signer: IKeyringPair, collectionId: number, owner: string) {
    const tokenId = await sendAndWait(signer, this.api.tx.unique.createItem(
      collectionId,
      {Substrate: owner},
      'NFT',
    ))
      .then(result => result.extractEvents('common.ItemCreated'))
      .then(events => events[0].data[1].toJSON() as number);

    const token = new Token(this, collectionId, tokenId);

    console.log(`[XNFT] ${this.name}: minted ${token.stringify()}`);
    return token;
  }

  async derivativeToken<CollectionId, TokenId>(token: Token<CollectionId, TokenId>) {
    const derivativeCollectionId = await this.api.query.foreignAssets.foreignAssetToCollection(token.collectionAssetId())
      .then(data => data.toJSON() as number | null);

    const derivativeTokenId = await this.api.query.foreignAssets.foreignReserveAssetInstanceToTokenId(
      derivativeCollectionId,
      token.assetInstance(),
    ).then(data => data.toJSON() as number | null);

    if(derivativeCollectionId != null && derivativeTokenId != null) {
      return new Token(this, derivativeCollectionId, derivativeTokenId);
    } else {
      throw Error(`[XNFT] no derivative was found for ${token.stringify()} on ${this.name}`);
    }
  }
}

export class Karura implements IParachain<number, number> {
  api: ApiPromise;
  paraId: number;
  name: string;
  locations: IChainLocations;
  nativeCurrency: ICurrency;
  xcmNft: IXcmNft<number, number>;
  xtokens: XTokens<number, number>;

  private constructor(chain: IParachain<number, number>) {
    this.api = chain.api;
    this.paraId = chain.paraId;
    this.name = chain.name;
    this.locations = chain.locations;
    this.nativeCurrency = chain.nativeCurrency;
    this.xcmNft = chain.xcmNft;
    this.xtokens = new XTokens(this);
  }

  public static async connect() {
    const karuraApi = await ApiPromise.create({provider: new WsProvider(RELAY_KARURA_URL)});
    const nativeCurrencyInfo = await chainNativeCurrencyInfo(karuraApi);
    const karuraLocation = parachainMultilocation(RELAY_KARURA_ID);

    const nativeCurrencyId = {
      Concrete: {
        parents: 1,
        interior: {
          X2: [
            {
              Parachain: RELAY_KARURA_ID,
            },
            {
              GeneralKey: {
                length: 2,
                data: '0x0080000000000000000000000000000000000000000000000000000000000000',
              },
            },
          ],
        },
      },
    };

    const chain: IParachain<number, number> = {
      api: karuraApi,
      paraId: RELAY_KARURA_ID,
      name: 'Karura',
      locations: {
        self: karuraLocation,
        account: parachainAccountMultilocation(RELAY_KARURA_ID),
        paraSovereignAccount: (paraId: number) => paraSiblingSovereignAccount(karuraApi, paraId),
      },
      xcmNft: {
        collectionAssetId: (collectionId: number) => ({
          Concrete: {
            parents: 1,
            interior: {
              X3: [
                {
                  Parachain: RELAY_KARURA_ID,
                },
                {
                  PalletInstance: 121,
                },
                {
                  GeneralIndex: collectionId,
                },
              ],
            },
          },
        }),
        assetInstance: (tokenId: number) => ({
          Index: tokenId,
        }),
        checkTokenOwner: async (collectionId: number, tokenId: number, expectedOwner: string) => {
          const derivativeNftData: any = await karuraApi.query.ormlNFT.tokens(collectionId, tokenId)
            .then(data => data.toJSON());

          return derivativeNftData.owner == await toChainAddressFormat(karuraApi, expectedOwner);
        },
      },
      nativeCurrency: {
        id: nativeCurrencyId,
        amount: (value: number) => adjustToDecimals(value, nativeCurrencyInfo.decimals),
        asMultiasset: (value: number) => ({
          id: nativeCurrencyId,
          fun: {Fungible: adjustToDecimals(value, nativeCurrencyInfo.decimals)},
        }),
        ...nativeCurrencyInfo,
      },
    };

    return new Karura(chain);
  }

  async registerFungibleForeignAsset(
    signer: IKeyringPair,
    reserveLocation: IMultilocation,
    metadata: {
      name: string,
      symbol: string,
      decimals: number,
      minimalBalance: bigint,
    },
  ) {
    const assets = (await (this.api.query.assetRegistry.assetMetadatas.entries())).map(([_k, v]: [any, any]) =>
      hexToString(v.toJSON()['symbol'])) as string[];

    if(assets.includes(metadata.symbol)) {
      console.log(`[XNFT] ${this.name}: the foreign asset "${metadata.symbol}" is already registered`);
    } else {
      await sendAndWait(signer, this.api.tx.sudo.sudo(this.api.tx.assetRegistry.registerForeignAsset(
        {V3: reserveLocation},
        metadata,
      )));
      console.log(`[XNFT] ${this.name}: registered the foreign currency "${metadata.symbol}"`);
    }
  }

  async registerNonFungibleForeignAsset(
    signer: IKeyringPair,
    assetId: IAssetId,
    description: string,
  ) {
    const collectionId = await sendAndWait(
      signer,
      this.api.tx.sudo.sudo(this.api.tx.xnft.registerAsset({
        V3: assetId,
      })),
    )
      .then(result => result.extractEvents('xnft.AssetRegistered'))
      .then(events => events[0].data[1].toJSON() as number);

    console.log(`[XNFT] ${this.name}: the NFT foreign asset "${description}" is registered as "${this.name}/Collection(${collectionId})"`);
    return collectionId;
  }

  async createCollection(signer: IKeyringPair) {
    const enableAllCollectionFeatures = 0xF;
    const emptyAttributes = this.api.createType('BTreeMap<Bytes, Bytes>', {});
    const karuraCollectionId = await sendAndWait(signer, this.api.tx.nft.createClass(
      'xNFT Collection',
      enableAllCollectionFeatures,
      emptyAttributes,
    ))
      .then(result => result.extractEvents('nft.CreatedClass'))
      .then(events => events[0].data[1].toJSON() as number);

    const karuraCollectionAccount = await palletSubAccount(this.api, 'aca/aNFT', karuraCollectionId);

    console.log(`[XNFT] ${this.name}: created "${this.name}/Collection(${karuraCollectionId})"`);
    console.log(`\t... the collection account: ${karuraCollectionAccount}`);

    await sendAndWait(signer, this.api.tx.balances.transferKeepAlive({Id: karuraCollectionAccount}, this.nativeCurrency.amount(10)));
    console.log('\t... sponsored the collection account');

    return karuraCollectionId;
  }

  async mintToken(signer: IKeyringPair, collectionId: number, owner: string) {
    const tokenId = (await this.api.query.ormlNFT.nextTokenId(collectionId)).toJSON() as number;
    const collectionAccount = await palletSubAccount(this.api, 'aca/aNFT', collectionId);
    const emptyAttributes = this.api.createType('BTreeMap<Bytes, Bytes>', {});

    await sendAndWait(signer, this.api.tx.proxy.proxy(
      {Id: collectionAccount},
      'Any',
      this.api.tx.nft.mint(
        {Id: owner},
        collectionId,
        'xNFT',
        emptyAttributes,
        1,
      ),
    ));

    const token = new Token(this, collectionId, tokenId);

    console.log(`[XNFT] ${this.name}: minted ${token.stringify()}`);
    return token;
  }

  async derivativeToken<CollectionId, TokenId>(token: Token<CollectionId, TokenId>) {
    const derivativeCollectionId = await this.api.query.xnft.foreignAssetToClass(token.collectionAssetId())
      .then(data => data.toJSON() as number | null);

    const derivativeTokenId = await this.api.query.xnft.assetInstanceToItem(
      derivativeCollectionId,
      token.assetInstance(),
    )
      .then(data => data.toJSON() as number | null);

    if(derivativeCollectionId != null && derivativeTokenId != null) {
      return new Token(this, derivativeCollectionId, derivativeTokenId);
    } else {
      throw Error(`[XNFT] no derivative was found for ${token.stringify()} on ${this.name}`);
    }
  }
}

export class Token<CollectionId, TokenId> {
  chain: IParachain<CollectionId, TokenId>;
  collectionId: CollectionId;
  tokenId: TokenId;

  constructor(chain: IParachain<CollectionId, TokenId>, collectionId: CollectionId, tokenId: TokenId) {
    this.chain = chain;
    this.collectionId = collectionId;
    this.tokenId = tokenId;
  }

  stringify() {
    return `"${this.chain.name}/Collection(${this.collectionId})/Token(${this.tokenId})"`;
  }

  collectionAssetId() {
    return this.chain.xcmNft.collectionAssetId(this.collectionId);
  }

  assetInstance() {
    return this.chain.xcmNft.assetInstance(this.tokenId);
  }

  asMultiasset(): IMultiAsset {
    return {
      id: this.collectionAssetId(),
      fun: {NonFungible: this.assetInstance()},
    };
  }

  async checkOwner(expectedOwner: string) {
    const isCorrectOwner = await this.chain.xcmNft.checkTokenOwner(this.collectionId, this.tokenId, expectedOwner);
    expect(isCorrectOwner, `${this.stringify()} should be owned by ${expectedOwner}`).to.be.true;

    console.log(`[XNFT] ${this.chain.name}: the owner of ${this.stringify()} is correct (${expectedOwner})`);
  }
}

export class XTokens<CollectionId, TokenId> {
  chain: IChain;

  constructor(chain: IChain) {
    this.chain = chain;
  }

  async transferXnftWithFee(args: {
    signer: IKeyringPair,
    token: Token<CollectionId, TokenId>,
    fee: IMultiAsset,
    destChain: IChain,
    beneficiary: string,
  }) {
    const xnft = {
      V3: args.token.asMultiasset(),
    };
    const fee = {
      V3: args.fee,
    };

    const beneficiaryRaw = decodeAddress(args.beneficiary);
    const dest = {V3: args.destChain.locations.account(beneficiaryRaw)};
    const messageHash = await sendAndWait(
      args.signer,
      this.chain.api.tx.xTokens.transferMultiassetWithFee(
        xnft,
        fee,
        dest,
        'Unlimited',
      ),
    )
      .then(result => result.extractEvents('xcmpQueue.XcmpMessageSent'))
      .then(events => events[0].data[0].toString());

    console.log(`[XNFT] ${args.token.stringify()} is sent: ${this.chain.name} -> ${args.destChain.name}/Account(${args.beneficiary})`);
    console.log(`\t... message hash: ${messageHash}`);

    await expectXcmpQueueSuccess(args.destChain, messageHash);
  }
}

const parachainMultilocation = (paraId: number) => ({
  parents: 1,
  interior: {
    X1: {
      Parachain: paraId,
    },
  },
} as IMultilocation);

const parachainAccountMultilocation = (paraId: number) => (address: Uint8Array) => ({
  parents: 1,
  interior: {
    X2: [
      {
        Parachain: paraId,
      },
      {
        AccountId32: {
          network: null,
          id: address,
        },
      },
    ],
  },
} as IMultilocation);

export class AllChains {
  relay: Relay;
  quartz: Quartz;
  karura: Karura;

  private constructor(
    relay: Relay,
    quartz: Quartz,
    karura: Karura,
  ) {
    this.relay = relay;
    this.quartz = quartz;
    this.karura = karura;
  }

  static async connect() {
    return new AllChains(
      await Relay.connect(),
      await Quartz.connect(),
      await Karura.connect(),
    );
  }

  async disconnect() {
    await this.relay.api.disconnect();
    await this.quartz.api.disconnect();
    await this.karura.api.disconnect();
  }
}
