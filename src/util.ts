import {ApiPromise} from '@polkadot/api';
import {Vec} from '@polkadot/types';
import {EventRecord, Event, XcmAssetId, DispatchError} from '@polkadot/types/interfaces';
import {IKeyringPair, ISubmittableResult} from '@polkadot/types/types';
import {nToU8a, stringToU8a} from '@polkadot/util';
import {encodeAddress} from '@polkadot/util-crypto';

export class TxResult {
  private result: ISubmittableResult;

  constructor(result: ISubmittableResult) {
    this.result = result;
  }

  public get extractEvents() {
    return new Events((section: string, method: string) => {
      const expected = this.result.events.filter((record) => record.event.section == section && record.event.method == method);

      if(expected != null) {
        return new Promise((resolve) => resolve(expected.map(e => e.event)));
      } else {
        throw new Error(`the expected event "${section}.${method}" is not found`);
      }
    });
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
        return getEvents('xnft', 'ForeignAssetRegistered')
          .then(events =>
            events.map(event => ({
              foreignAssetId: event.data[0] as XcmAssetId,
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
  api: ApiPromise,
  options: {maxBlocksToWait: number} = {maxBlocksToWait: 5},

  // eslint-disable-next-line no-async-promise-executor
) => new Events((section: string, method: string) => new Promise(async (resolve, reject) => {
  const chain = await api.rpc.system.chain();
  const eventStr = `${section}.${method}`;

  const maxBlocksToWait = options.maxBlocksToWait;

  console.log(`[XNFT] ${chain}: waiting for the event "${eventStr}"`);

  let waiting = 1;
  let lastBlockNumber = 0;

  const unsub = await api.rpc.chain.subscribeNewHeads(async header => {
    const blockNumber = header.number.toNumber();
    if(blockNumber > lastBlockNumber) {
      lastBlockNumber = blockNumber;
    } else {
      return;
    }

    console.log(`\t... [attempt ${waiting}/${maxBlocksToWait}] block #${blockNumber}`);

    const eventRecords = await api.query.system.events() as Vec<EventRecord>;
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
  api: ApiPromise,
  options: {
    criteria: string,
    filterMap: (event: Events) => Promise<T[]>,
    maxBlocksToWait?: number,
  },
  // eslint-disable-next-line no-async-promise-executor
) => new Promise<T[]>(async (resolve, reject) => {
  const chain = await api.rpc.system.chain();
  console.log(`[XNFT] ${chain}: searching an event meeting the following criteria:`);
  console.log(`\t- ${options.criteria}`);

  const maxBlocksToWait = options.maxBlocksToWait ?? 5;

  let waiting = 1;
  let lastBlockNumber = 0;

  const unsub = await api.rpc.chain.subscribeNewHeads(async header => {
    const blockNumber = header.number.toNumber();
    if(blockNumber > lastBlockNumber) {
      lastBlockNumber = blockNumber;
    } else {
      return;
    }

    const msgPrefix = `\t... [attempt ${waiting}/${maxBlocksToWait}] block #${blockNumber}`;

    const eventRecords = await api.query.system.events() as Vec<EventRecord>;

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

export const expectXcmpQueueSuccess = async (api: ApiPromise, expectedMessageHash: string) => {
  const events = await searchEvents(
    api,
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
