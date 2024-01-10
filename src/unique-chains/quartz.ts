import {ApiPromise, WsProvider} from '@polkadot/api';
import {IAssetId, IParachain, Parachain, Token, XTokens} from '../common';
import {IKeyringPair} from '@polkadot/types/types';
import {palletAccount, sendAndWait, strUtf16} from '../util';

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

  async derivativeTokenOf<CollectionId, TokenId>(token: Token<CollectionId, TokenId>) {
    const derivativeCollectionId = await this.api.query.foreignAssets.foreignAssetToCollection(token.assetId())
      .then(data => data.toJSON() as number | null);

    if(derivativeCollectionId == null) {
      throw Error(`[XNFT] no derivative collection is found for ${token.stringify()} on ${this.name}`);
    }

    const derivativeTokenId = await this.api.query.foreignAssets.foreignReserveAssetInstanceToTokenId(
      derivativeCollectionId,
      token.assetInstance(),
    ).then(data => data.toJSON() as number | null);

    if(derivativeTokenId == null) {
      throw Error(`[XNFT] no derivative token is found for ${token.stringify()} on ${this.name}`);
    }

    return new Token(this, derivativeCollectionId, derivativeTokenId);
  }
}
