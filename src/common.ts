import {ApiPromise} from '@polkadot/api';
import {Option} from '@polkadot/types';
import {HrmpChannel} from '@polkadot/types/interfaces';
import {IKeyringPair} from '@polkadot/types/types';
import {hexToString} from '@polkadot/util';
import {sendAndWait, waitForEvents} from './util';

export const RELAY_URL = process.env.RELAY_URL;
export const RELAY_QUARTZ_URL = process.env.RELAY_QUARTZ_URL;
export const RELAY_KARURA_URL = process.env.RELAY_KARURA_URL;

export const RELAY_QUARTZ_ID = +(process.env.RELAY_QUARTZ_ID || 2095);
export const RELAY_KARURA_ID = +(process.env.RELAY_KARURA_ID || 2000);

const parachainMultilocation = (paraId: number) => ({
  parents: 1,
  interior: {
    X1: {
      Parachain: paraId,
    },
  },
});

const parachainAccountMultilocation = (paraId: number, address: Uint8Array) => ({
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
});

export const multilocation = {
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

  quartz: {
    parachain: parachainMultilocation(RELAY_QUARTZ_ID),
    account: (address: Uint8Array) => parachainAccountMultilocation(RELAY_QUARTZ_ID, address),
    nftCollection: (collectionId: number) => ({
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
    }),
  },

  karura: {
    parachain: parachainMultilocation(RELAY_KARURA_ID),
    token: {
      kar: {
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
    account: (address: Uint8Array) => parachainAccountMultilocation(RELAY_KARURA_ID, address),
    nftCollection: (collectionId: number) => ({
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
    }),
  },
};

export const decimals = {
  quartz: 18,
  karura: 12,
};

const adjustToDecimals = (n: number, decimals: number) => BigInt(n) * 10n ** BigInt(decimals);

export const unit = {
  qtz: (n: number) => adjustToDecimals(n, decimals.quartz),
  kar: (n: number) => adjustToDecimals(n, decimals.karura),
};

export const waitForParachainsStart = async (api: ApiPromise) => {
  const sessionId = (await api.query.session.currentIndex()).toJSON() as number;

  if(sessionId == 0) {
    console.log('[XNFT] parachains will start at the next relaychain session');
    await waitForEvents(api, {maxBlocksToWait: 12}).general.newSession;
  }
};

export const forceOpenHrmps = async (api: ApiPromise, signer: IKeyringPair, firstParaId: number, secondParaId: number) => {
  await forceOpenHrmp(api, signer, firstParaId, secondParaId);
  await forceOpenHrmp(api, signer, secondParaId, firstParaId);
};

const forceOpenHrmp = async (api: ApiPromise, signer: IKeyringPair, firstParaId: number, secondParaId: number) => {
  const hrmpChannel = await api.query.hrmp.hrmpChannels([firstParaId, secondParaId]) as Option<HrmpChannel>;
  if(hrmpChannel.isSome) {
    console.log(`[XNFT] HRMP channel ${firstParaId} -> ${secondParaId} is already opened`);
  } else {
    await sendAndWait(signer, api.tx.sudo.sudo(api.tx.hrmp.forceOpenHrmpChannel(firstParaId, secondParaId, 8, 512)));
    console.log(`[XNFT] opened HRMP channel ${firstParaId} -> ${secondParaId}`);
  }
};

export const registerForeignAssetOnKarura = async (
  api: ApiPromise,
  signer: IKeyringPair,
  reserveLocation: any,
  metadata: {
    name: string,
    symbol: string,
    decimals: number,
    minimalBalance: bigint,
  },
) => {
  const assets = (await (api.query.assetRegistry.assetMetadatas.entries())).map(([_k, v]: [any, any]) =>
    hexToString(v.toJSON()['symbol'])) as string[];

  if(assets.includes(metadata.symbol)) {
    console.log(`[XNFT] foreign asset "${metadata.symbol}" is already registered on Karura`);
  } else {
    await sendAndWait(signer, api.tx.sudo.sudo(api.tx.assetRegistry.registerForeignAsset(
      {V3: reserveLocation},
      metadata,
    )));
    console.log(`[XNFT] registered the "${metadata.symbol}" foreign asset on Karura`);
  }
};

export const registerForeignAssetOnQuartz = async (
  api: ApiPromise,
  signer: IKeyringPair,
  assetId: any,
  metadata: {
    name: string,
    tokenPrefix: string,
    mode: 'NFT' | { Fungible: number },
  },
) => {
  const collectionId = (await api.query.foreignAssets.foreignAssetToCollection(assetId)).toJSON();

  if(collectionId) {
    console.log(`[XNFT] foreign asset "${metadata.tokenPrefix}" is already registered on Quartz`);
  } else {
    await sendAndWait(signer, api.tx.sudo.sudo(api.tx.foreignAssets.forceRegisterForeignAsset(
      {V3: assetId},
      strUtf16(metadata.name),
      metadata.tokenPrefix,
      metadata.mode,
    )));
    console.log(`[XNFT] registered the "${metadata.tokenPrefix}" foreign asset on Quartz`);
  }
};

export const strUtf16 = (string: string) => Array.from(string).map(x => x.charCodeAt(0));
