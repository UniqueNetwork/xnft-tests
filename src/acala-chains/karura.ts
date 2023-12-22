import {ApiPromise, WsProvider} from '@polkadot/api';
import {IAssetId, IMultilocation, IParachain, Parachain, Token, XTokens} from '../common';
import {palletAccount, sendAndWait, toChainAddressFormat} from '../util';
import {IKeyringPair} from '@polkadot/types/types';
import {hexToString} from '@polkadot/util';

const RELAY_KARURA_URL = process.env.RELAY_KARURA_URL!;
const RELAY_KARURA_ID = +process.env.RELAY_KARURA_ID!;

export class Karura extends Parachain<number, number> {
  xtokens: XTokens<number, number>;
  xnftPalletAccount: string;

  private constructor(chain: IParachain<number, number>, xnftPalletAccount: string) {
    super(chain);
    this.xtokens = new XTokens(this);
    this.xnftPalletAccount = xnftPalletAccount;
  }

  static async connect() {
    const api = await ApiPromise.create({provider: new WsProvider(RELAY_KARURA_URL)});
    const chain = await super.connectParachain({
      api,
      paraId: RELAY_KARURA_ID,
      name: 'Karura',
      nativeCurrencyId: {
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
      },
      xcmNft: {
        assetId: (collectionId: number) => ({
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
        checkTokenOwner: async (
          collectionId: number,
          tokenId: number,
          expectedOwner: string,
        ) => {
          const derivativeNftData: any = await api.query.ormlNFT.tokens(collectionId, tokenId)
            .then(data => data.toJSON());

          return derivativeNftData.owner == await toChainAddressFormat(api, expectedOwner);
        },
      },
    });

    const xnftPalletAccount = await palletAccount(api, 'aca/xNFT');

    return new Karura(chain, xnftPalletAccount);
  }

  async disconnect() {
    await this.api.disconnect();
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
    const collectionId = await sendAndWait(signer, this.api.tx.nft.createClass(
      'xNFT Collection',
      enableAllCollectionFeatures,
      emptyAttributes,
    ))
      .then(result => result.extractEvents('nft.CreatedClass'))
      .then(events => events[0].data[1].toJSON() as number);

    const collectionAccount = await palletAccount(this.api, 'aca/aNFT', collectionId);

    console.log(`[XNFT] ${this.name}: created "${this.name}/Collection(${collectionId})"`);
    console.log(`\t... the collection account: ${collectionAccount}`);

    await sendAndWait(signer, this.api.tx.balances.transferKeepAlive({Id: collectionAccount}, this.nativeCurrency.amount(10)));
    console.log('\t... sponsored the collection account');

    return collectionId;
  }

  async mintToken(signer: IKeyringPair, collectionId: number, owner: string) {
    const tokenId = (await this.api.query.ormlNFT.nextTokenId(collectionId)).toJSON() as number;
    const collectionAccount = await palletAccount(this.api, 'aca/aNFT', collectionId);
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

  async derivativeTokenOf<CollectionId, TokenId>(token: Token<CollectionId, TokenId>) {
    const derivativeCollectionId = await this.api.query.xnft.foreignAssetToClass(token.assetId())
      .then(data => data.toJSON() as number | null);

    if(derivativeCollectionId == null) {
      throw Error(`[XNFT] no derivative collection is found for ${token.stringify()} on ${this.name}`);
    }

    const derivativeTokenId = await this.api.query.xnft.assetInstanceToItem(
      derivativeCollectionId,
      token.assetInstance(),
    )
      .then(data => data.toJSON() as number | null);

    if(derivativeTokenId == null) {
      throw Error(`[XNFT] no derivative token is found for ${token.stringify()} on ${this.name}`);
    }

    return new Token(this, derivativeCollectionId, derivativeTokenId);
  }
}
