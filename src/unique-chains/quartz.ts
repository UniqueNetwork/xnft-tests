import {ApiPromise, WsProvider} from '@polkadot/api';
import {IAssetId, IParachain, Parachain, Token, XTokens} from '../common';
import {IKeyringPair} from '@polkadot/types/types';
import {palletAccount, sendAndWait, strUtf16} from '../util';
import '../generated/types';
import { PalletXnftDerivativeStatus } from '../generated/types';

const RELAY_QUARTZ_URL = process.env.RELAY_QUARTZ_URL!;
const RELAY_QUARTZ_ID = +process.env.RELAY_QUARTZ_ID!;

export class Quartz extends Parachain<number, number> {
  xtokens: XTokens<number, number>;
  foreignAssetsPalletAccount: string;

  private constructor(
    chain: IParachain<number, number>,
    foreignAssetsPalletAccount: string,
  ) {
    super(chain);
    this.xtokens = new XTokens(this);
    this.foreignAssetsPalletAccount = foreignAssetsPalletAccount;
  }

  static async connect() {
    const api = await ApiPromise.create({provider: new WsProvider(RELAY_QUARTZ_URL)});

    const chain = await super.connectParachain({
      api,
      paraId: RELAY_QUARTZ_ID,
      name: 'Quartz',
      nativeCurrencyId: 'SelfLocation',
      xcmNft: {
        assetId: (collectionId: number) => ({
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
        checkTokenOwner: async (
          collectionId: number,
          tokenId: number,
          expectedOwner: string,
        ) => await api.query.nonfungible.owned(
          collectionId,
          {Substrate: expectedOwner},
          tokenId,
        ).then(isOwned => isOwned.toJSON() as boolean),
      },
    });

    const foreignAssetsPalletAccount = await palletAccount(api, 'frgnasts');

    return new Quartz(chain, foreignAssetsPalletAccount);
  }

  async disconnect() {
    await this.api.disconnect();
  }

  async registerNftForeignAsset(
    signer: IKeyringPair,
    assetId: IAssetId,
    metadata: {
      name: string,
      tokenPrefix: string,
    },
  ) {
    const collectionId = (await this.api.query.xNft.foreignAssetToLocalClass(assetId)).toJSON();

    if(collectionId) {
      console.log(`[XNFT] ${this.name}: the NFT foreign asset "${metadata.tokenPrefix}" is already registered`);
    } else {
      const collectionId = await sendAndWait(signer, this.api.tx.sudo.sudo(this.api.tx.xNft.registerForeignAsset(
        {V3: assetId},
        {
          name: strUtf16(metadata.name),
          tokenPrefix: metadata.tokenPrefix,
        },
      )))
        .then(data => data.extractEvents('common.CollectionCreated'))
        .then(events => events[0].data[0].toJSON() as number);

      console.log(`[XNFT] ${this.name}: the NFT foreign asset "${metadata.name}" is registered as "${this.name}/Collection(${collectionId})"`);

      return collectionId;
    }
  }

  async registerFungibleForeignAsset(
    signer: IKeyringPair,
    assetId: IAssetId,
    metadata: {
      name: string,
      tokenPrefix: string,
      decimals: number,
    },
  ) {
    const collectionId = (await this.api.query.xFun.foreignAssetToCollection(assetId)).toJSON();

    if(collectionId) {
      console.log(`[XNFT] ${this.name}: the fungible foreign asset "${metadata.tokenPrefix}" is already registered`);
    } else {
      const collectionId = await sendAndWait(signer, this.api.tx.sudo.sudo(this.api.tx.xFun.registerForeignAsset(
        {V3: assetId},
        strUtf16(metadata.name),
        metadata.tokenPrefix,
        metadata.decimals,
      )))
        .then(data => data.extractEvents('common.CollectionCreated'))
        .then(events => events[0].data[0].toJSON() as number);

      console.log(`[XNFT] ${this.name}: the fungible foreign asset "${metadata.name}" is registered as "${this.name}/Collection(${collectionId})"`);

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

  async derivativeTokenOf<CollectionId, TokenId>(token: Token<CollectionId, TokenId>) {
    const derivativeCollectionId = await this.api.query.xNft.foreignAssetToLocalClass(token.assetId())
      .then(data => data.toJSON() as number | null);

    if(derivativeCollectionId == null) {
      throw Error(`[XNFT] no derivative collection is found for ${token.stringify()} on ${this.name}`);
    }

    const derivativeStatus = await this.api.query.xNft.foreignInstanceToDerivativeStatus(
      derivativeCollectionId,
      token.assetInstance(),
    ).then(data => data as PalletXnftDerivativeStatus);

    let derivativeId: number;
    if(derivativeStatus.isNotExists) {
      throw Error(`[XNFT] no derivative token is found for ${token.stringify()} on ${this.name}`);
    } else if(derivativeStatus.isStashed) {
      derivativeId = derivativeStatus.asStashed.toNumber();
    } else {
      derivativeId = derivativeStatus.asActive.toNumber();
    }

    return new Token(this, derivativeCollectionId, derivativeId);
  }
}
