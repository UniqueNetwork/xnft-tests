import {ApiPromise, WsProvider} from '@polkadot/api';
import {Option} from '@polkadot/types';
import {HrmpChannel} from '@polkadot/types/interfaces';
import {IKeyringPair} from '@polkadot/types/types';
import {
  adjustToDecimals,
  chainNativeCurrencyInfo,
  expectXcmpQueueSuccess,
  paraChildSovereignAccount,
  paraSiblingSovereignAccount,
  sendAndWait,
  waitForEvents,
} from './util';
import {expect} from 'chai';
import {decodeAddress} from '@polkadot/util-crypto';

export const RELAY_URL = process.env.RELAY_URL!;

export interface IMultilocation {
  parents: number;
  interior: IInterior;
}

export type IAssetId = {
  Concrete: IMultilocation,
} | {
  Abstract: string
};

export interface IMultiAsset {
  id: IAssetId;
  fun: IFungibility;
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

export type IInterior = 'Here' | {
  X1: IJunction
} | {
  X2: [IJunction, IJunction]
} | {
  X3: [IJunction, IJunction, IJunction]
} | {
  X4: [IJunction, IJunction, IJunction, IJunction]
} | {
  X5: [IJunction, IJunction, IJunction, IJunction, IJunction]
} | {
  X6: [IJunction, IJunction, IJunction, IJunction, IJunction, IJunction]
} | {
  X7: [IJunction, IJunction, IJunction, IJunction, IJunction, IJunction, IJunction]
} | {
  X8: [IJunction, IJunction, IJunction, IJunction, IJunction, IJunction, IJunction, IJunction]
};

export type IJunction =
  IJunctionAccountId32
  | IJunctionParachain
  | IJunctionPalletInstance
  | IJunctionGeneralKey
  | IJunctionGeneralIndex;

export interface IJunctionAccountId32 {
  AccountId32: {
    network: string | null,
    id: Uint8Array,
  }
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
  assetId: (collectionId: CollectionId) => IAssetId;
  assetInstance: (tokenId: TokenId) => IAssetInstance;
  checkTokenOwner: (collectionId: CollectionId, tokenId: TokenId, expectedOwner: string) => Promise<boolean>;
}

export interface IParachain<CollectionId, TokenId> extends IChain {
  paraId: number;
  xcmNft: IXcmNft<CollectionId, TokenId>;
}

export class Parachain<CollectionId, TokenId> implements IParachain<CollectionId, TokenId> {
  api: ApiPromise;
  paraId: number;
  name: string;
  locations: IChainLocations;
  nativeCurrency: ICurrency;
  xcmNft: IXcmNft<CollectionId, TokenId>;

  protected constructor(chain: IParachain<CollectionId, TokenId>) {
    this.api = chain.api;
    this.paraId = chain.paraId;
    this.name = chain.name;
    this.locations = chain.locations;
    this.nativeCurrency = chain.nativeCurrency;
    this.xcmNft = chain.xcmNft;
  }

  protected static async connectParachain<CollectionId, TokenId>(ctx: {
    api: ApiPromise,
    paraId: number,
    name: string,
    nativeCurrencyId: IAssetId | 'SelfLocation',
    xcmNft: IXcmNft<CollectionId, TokenId>,
  }) {
    const api = ctx.api;
    const nativeCurrencyInfo = await chainNativeCurrencyInfo(api);
    const nativeCurrencyAmount = (value: number) => adjustToDecimals(value, nativeCurrencyInfo.decimals);
    const parachainLocation = parachainMultilocation(ctx.paraId);

    const nativeCurrencyId = ctx.nativeCurrencyId == 'SelfLocation'
      ? {Concrete: parachainLocation}
      : ctx.nativeCurrencyId;

    const chain: IParachain<CollectionId, TokenId> = {
      api,
      paraId: ctx.paraId,
      name: ctx.name,
      locations: {
        self: parachainLocation,
        account: parachainAccountMultilocation(ctx.paraId),
        paraSovereignAccount: (paraId: number) => paraSiblingSovereignAccount(api, paraId),
      },
      nativeCurrency: {
        id: nativeCurrencyId,
        amount: nativeCurrencyAmount,
        asMultiasset: (value: number) => ({
          id: nativeCurrencyId,
          fun: {Fungible: nativeCurrencyAmount(value)},
        }),
        ...nativeCurrencyInfo,
      },
      xcmNft: ctx.xcmNft,
    };

    return chain;
  }
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

  static async connect() {
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
              AccountId32: {
                network: null,
                id: address,
              },
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

  async disconnect() {
    await this.api.disconnect();
  }

  async waitForParachainsStart() {
    const sessionId = (await this.api.query.session.currentIndex()).toJSON() as number;

    if(sessionId == 0) {
      console.log(`[XNFT] ${this.name}: parachains will start at the next relaychain session`);
      await waitForEvents(this, {event: 'session.NewSession', maxBlocksToWait: 12});
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

  assetId() {
    return this.chain.xcmNft.assetId(this.collectionId);
  }

  assetInstance() {
    return this.chain.xcmNft.assetInstance(this.tokenId);
  }

  asMultiasset(): IMultiAsset {
    return {
      id: this.assetId(),
      fun: {NonFungible: this.assetInstance()},
    };
  }

  async checkOwner(expectedOwner: string) {
    const isCorrectOwner = await this.chain.xcmNft.checkTokenOwner(
      this.collectionId,
      this.tokenId,
      expectedOwner,
    );
    expect(isCorrectOwner, `${this.stringify()} should be owned by ${expectedOwner}`).to.be.true;

    console.log(`[XNFT] ${this.chain.name}: the owner of ${this.stringify()} is correct (${expectedOwner})`);
  }
}

export class XTokens<CollectionId, TokenId> {
  chain: IChain;

  constructor(chain: IChain) {
    this.chain = chain;
  }

  async transferXnftWithFee(ctx: {
    signer: IKeyringPair,
    token: Token<CollectionId, TokenId>,
    fee: IMultiAsset,
    destChain: IChain,
    beneficiary: string,
  }) {
    const xnft = {
      V3: ctx.token.asMultiasset(),
    };
    const fee = {
      V3: ctx.fee,
    };

    const beneficiaryRaw = decodeAddress(ctx.beneficiary);
    const dest = {V3: ctx.destChain.locations.account(beneficiaryRaw)};
    const messageHash = await sendAndWait(
      ctx.signer,
      this.chain.api.tx.xTokens.transferMultiassetWithFee(
        xnft,
        fee,
        dest,
        'Unlimited',
      ),
    )
      .then(result => result.extractEvents('xcmpQueue.XcmpMessageSent'))
      .then(events => events[0].data[0].toString());

    console.log(`[XNFT] ${ctx.token.stringify()} is sent: ${this.chain.name} -> ${ctx.destChain.name}/Account(${ctx.beneficiary})`);
    console.log(`\t... message hash: ${messageHash}`);

    await expectXcmpQueueSuccess(ctx.destChain, messageHash);
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
