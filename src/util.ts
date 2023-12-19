import {ApiPromise} from '@polkadot/api';
import {Vec} from '@polkadot/types';
import {EventRecord, Event, XcmAssetId, DispatchError} from '@polkadot/types/interfaces';
import {IKeyringPair, ISubmittableResult} from '@polkadot/types/types';
import {nToU8a, stringToU8a} from '@polkadot/util';
import {encodeAddress} from '@polkadot/util-crypto';
import {IChain} from './common';

export class TxResult {
  private result: ISubmittableResult;

  constructor(result: ISubmittableResult) {
    this.result = result;
  }

  public extractEvents<S extends string, M extends string, EventId extends `${S}.${M}`>(eventId: EventId): Promise<Event[]> {
    const [section, method] = eventId.split('.');

    const expected = this.result.events.filter((record) => record.event.section == section && record.event.method == method);

    if(expected != null) {
      return new Promise((resolve) => resolve(expected.map(e => e.event)));
    } else {
      throw new Error(`the expected event "${section}.${method}" is not found`);
    }
  }
}

class Events {
  getEvents: (section: string, method: string) => Promise<Event[]>;

  constructor(getEvents: (section: string, method: string) => Promise<Event[]>) {
    this.getEvents = getEvents;
  }

  public get general() {
    const getEvents = this.getEvents;

    return new class GeneralEvent {
      public get newSession() {
        return getEvents('session', 'NewSession');
      }

      public get xcmpQueueSuccess() {
        return getEvents('xcmpQueue', 'Success')
          .then(events =>
            events.map(event => ({
              messageHash: event.data[0].toString(),
            })));
      }

      public get xcmpQueueMessageSent() {
        return getEvents('xcmpQueue', 'XcmpMessageSent')
          .then(events =>
            events.map(event => ({
              messageHash: event.data[0].toString(),
            })));
      }
    };
  }

  public get quartz() {
    const getEvents = this.getEvents;

    return new class QuartzEvent {
      public get collectionCreated() {
        return getEvents('common', 'CollectionCreated')
          .then(events =>
            events.map(event => ({
              collectionId: event.data[0].toJSON() as number,
            })));
      }
      public get itemCreated() {
        return getEvents('common', 'ItemCreated')
          .then(events =>
            events.map(event => ({
              collectionId: event.data[0].toJSON() as number,
              tokenId: event.data[1].toJSON() as number,
            })));
      }
    };
  }

  public get karura() {
    const getEvents = this.getEvents;

    return new class KaruraEvent {
      public get xnftAssetRegistered() {
        return getEvents('xnft', 'AssetRegistered')
          .then(events =>
            events.map(event => ({
              assetId: event.data[0] as XcmAssetId,
              collectionId: event.data[1].toJSON() as number,
            })));
      }

      public get nftCreatedClass() {
        return getEvents('nft', 'CreatedClass')
          .then(events =>
            events.map(event => ({
              owner: event.data[0].toString(),
              classId: event.data[1].toJSON() as number,
            })));
      }
    };
  }
}

export const chainNativeCurrencyInfo = async (api: ApiPromise) => {
  const properties = await api.rpc.system.properties();
  const symbol = properties.tokenSymbol.unwrap()[0].toString();
  const decimals = properties.tokenDecimals.unwrap()[0].toNumber();

  return {
    symbol,
    decimals,
  };
};

export const adjustToDecimals = (n: number, decimals: number) => BigInt(n) * 10n ** BigInt(decimals);

// eslint-disable-next-line no-async-promise-executor
export const sendAndWait = (signer: IKeyringPair, tx: any): Promise<TxResult> => new Promise(async (resolve, reject) => {
  const unsub = await tx.signAndSend(signer, (result: ISubmittableResult) => {
    if(result.status.isInBlock) {
      unsub();

      const errors = result.events
        .filter(e => e.event.section == 'system' && e.event.method === 'ExtrinsicFailed')
        .map(e => {
          const error = e.event.data[0] as DispatchError;
          if(error.isModule) {
            const moduleError = error.asModule;
            const metaError = error.registry.findMetaError(moduleError);
            return `${metaError.section}.${metaError.method}`;
          } else {
            return error.toHuman();
          }
        });

      if(errors.length == 0) {
        resolve(new TxResult(result));
      } else {
        const strErrors = errors.join('; ');
        reject(new Error(strErrors));
      }
    }
  });
});

export const waitForEvents = (
  chain: IChain,
  options: {maxBlocksToWait: number} = {maxBlocksToWait: 5},

  // eslint-disable-next-line no-async-promise-executor
) => new Events((section: string, method: string) => new Promise(async (resolve, reject) => {
  const eventStr = `${section}.${method}`;

  const maxBlocksToWait = options.maxBlocksToWait;

  console.log(`[XNFT] ${chain.name}: waiting for the event "${eventStr}"`);

  let waiting = 1;
  let lastBlockNumber = 0;

  const unsub = await chain.api.rpc.chain.subscribeNewHeads(async header => {
    const blockNumber = header.number.toNumber();
    if(blockNumber > lastBlockNumber) {
      lastBlockNumber = blockNumber;
    } else {
      return;
    }

    console.log(`\t... [attempt ${waiting}/${maxBlocksToWait}] block #${blockNumber}`);

    const eventRecords = await chain.api.query.system.events() as Vec<EventRecord>;
    const neededRecords = eventRecords.filter(eventRecord => eventRecord.event.section == section && eventRecord.event.method == method);

    if(neededRecords.length != 0) {
      console.log(`\t... [OK] found ${neededRecords.length} "${eventStr}" event(s)`);
      unsub();
      resolve(neededRecords.map(record => record.event));
    } else if(waiting < maxBlocksToWait) {
      waiting++;
    } else {
      unsub();
      reject(new Error(`"${eventStr}" didn't happen`));
    }
  });
}));

export const searchEvents = <T> (
  chain: IChain,
  options: {
    criteria: string,
    filterMap: (event: Events) => Promise<T[]>,
    maxBlocksToWait?: number,
  },
  // eslint-disable-next-line no-async-promise-executor
) => new Promise<T[]>(async (resolve, reject) => {
  console.log(`[XNFT] ${chain.name}: searching an event meeting the following criteria:`);
  console.log(`\t- ${options.criteria}`);

  const maxBlocksToWait = options.maxBlocksToWait ?? 5;

  let waiting = 1;
  let lastBlockNumber = 0;

  const unsub = await chain.api.rpc.chain.subscribeNewHeads(async header => {
    const blockNumber = header.number.toNumber();
    if(blockNumber > lastBlockNumber) {
      lastBlockNumber = blockNumber;
    } else {
      return;
    }

    const msgPrefix = `\t... [attempt ${waiting}/${maxBlocksToWait}] block #${blockNumber}`;

    const eventRecords = await chain.api.query.system.events() as Vec<EventRecord>;

    const goodEvents = await options.filterMap(new Events((section: string, method: string) => new Promise(resolve => {
      const neededRecords = eventRecords.filter(eventRecord => eventRecord.event.section == section && eventRecord.event.method == method);
      const eventStr = `${section}.${method}`;

      if(neededRecords.length != 0) {
        console.log(`${msgPrefix}: processing ${neededRecords.length} "${eventStr}" event(s)`);
      } else {
        console.log(`${msgPrefix}: no suitable events found in this block`);
      }

      resolve(neededRecords.map(record => record.event));
    })));

    if(goodEvents.length != 0) {
      console.log(`\t... [OK] found ${goodEvents.length} suitable event(s)`);
      unsub();
      resolve(goodEvents);
    } else if(waiting < maxBlocksToWait) {
      waiting++;
    } else {
      unsub();
      reject(new Error(`no events matching the criteria: "${options.criteria}"`));
    }
  });
});

export const paraSiblingSovereignAccount = (api: ApiPromise, paraid: number) => {
  // We are getting a *sibling* parachain sovereign account,
  // so we need a sibling prefix: encoded(b"sibl") == 0x7369626c
  const siblingPrefix = '0x7369626c';

  const encodedParaId = api.createType('u32', paraid).toHex(true).substring(2);
  const suffix = '000000000000000000000000000000000000000000000000';

  return siblingPrefix + encodedParaId + suffix;
};

export const paraChildSovereignAccount = (api: ApiPromise, paraid: number) => {
  // We are getting a *child* parachain sovereign account,
  // so we need a child prefix: encoded(b"para") == 0x70617261
  const childPrefix = '0x70617261';

  const encodedParaId = api.createType('u32', paraid).toHex(true).substring(2);
  const suffix = '000000000000000000000000000000000000000000000000';

  return childPrefix + encodedParaId + suffix;
};

export const expectXcmpQueueSuccess = async (chain: IChain, expectedMessageHash: string) => {
  const events = await searchEvents(
    chain,
    {
      criteria: `xcmpQueue.Success with messageHash == ${expectedMessageHash}`,
      filterMap: async events => {
        const messages = await events.general.xcmpQueueSuccess
          .then(events =>
            events.map(event =>
              event.messageHash));

        return messages.filter(hash => hash == expectedMessageHash);
      },
    },
  );

  return events[0];
};

export const toChainAddressFormat = async (api: ApiPromise, address: string | Uint8Array) => {
  const ss58Format = (await api.rpc.system.properties()).ss58Format.unwrap().toNumber();
  return encodeAddress(address, ss58Format);
};

export const palletSubAccount = async (api: ApiPromise, palletId: string, sub: number) => {
  if(palletId.length == 8) {
    const palletIdEncoded = stringToU8a(('modl' + palletId));
    const subEncoded = nToU8a(sub);
    const zeroPadding = new Uint8Array(32 - palletIdEncoded.length - subEncoded.length).fill(0);
    return await toChainAddressFormat(api, new Uint8Array([...palletIdEncoded, ...subEncoded, ...zeroPadding]));
  } else {
    throw new Error('pallet ID length must be 8');
  }
};

export const strUtf16 = (string: string) => Array.from(string).map(x => x.charCodeAt(0));
