import {ApiPromise} from '@polkadot/api';
import {Vec} from '@polkadot/types';
import {EventRecord, Event, XcmAssetId} from '@polkadot/types/interfaces';
import {IKeyringPair, ISubmittableResult} from '@polkadot/types/types';
import {nToU8a, stringToU8a} from '@polkadot/util';
import {encodeAddress} from '@polkadot/util-crypto';

export class TxResult {
  private result: ISubmittableResult;

  constructor(result: ISubmittableResult) {
    this.result = result;
  }

  public get extractEvent() {
    return new ChainEvent((section: string, method: string) => {
      const expected = this.result.events.find((record) => record.event.section == section && record.event.method == method);

      if(expected != null) {
        return new Promise((resolve) => resolve(expected.event));
      } else {
        throw Error(`the expected event "${section}.${method}" is not found`);
      }
    });
  }
}

class ChainEvent {
  getEvent: (section: string, method: string) => Promise<Event>;

  constructor(getEvent: (section: string, method: string) => Promise<Event>) {
    this.getEvent = getEvent;
  }

  public get general() {
    const getEvent = this.getEvent;

    return new class GeneralEvent {
      public get newSession() {
        return getEvent('session', 'NewSession');
      }

      public get xcmpQueueSuccess() {
        return getEvent('xcmpQueue', 'Success').then(event => ({
          messageHash: event.data[0].toString(),
        }));
      }

      public get xcmpQueueMessageSent() {
        return getEvent('xcmpQueue', 'XcmpMessageSent').then(event => ({
          messageHash: event.data[0].toString(),
        }));
      }
    };
  }

  public get quartz() {
    const getEvent = this.getEvent;

    return new class QuartzEvent {
      public get collectionCreated() {
        return getEvent('common', 'CollectionCreated').then(event => ({
          collectionId: event.data[0].toJSON() as number,
        }));
      }
      public get itemCreated() {
        return getEvent('common', 'ItemCreated').then(event => ({
          collectionId: event.data[0].toJSON() as number,
          tokenId: event.data[1].toJSON() as number,
        }));
      }
    };
  }

  public get karura() {
    const getEvent = this.getEvent;

    return new class KaruraEvent {
      public get xnftAssetRegistered() {
        return getEvent('xnft', 'AssetRegistered').then(event => ({
          assetId: event.data[0] as XcmAssetId,
          collectionId: event.data[1].toJSON() as number,
        }));
      }

      public get nftCreatedClass() {
        return getEvent('nft', 'CreatedClass').then(event => ({
          owner: event.data[0].toString(),
          classId: event.data[1].toJSON() as number,
        }));
      }
    };
  }
}

// eslint-disable-next-line no-async-promise-executor
export const sendAndWait = (signer: IKeyringPair, tx: any): Promise<TxResult> => new Promise(async (resolve) => {
  const unsub = await tx.signAndSend(signer, (result: ISubmittableResult) => {
    if(result.status.isInBlock) {
      unsub();
      resolve(new TxResult(result));
    }
  });
});

// eslint-disable-next-line no-async-promise-executor
export const waitForEvent = (api: ApiPromise, maxBlocksToWait: number = 5) => new ChainEvent((section: string, method: string) => new Promise(async (resolve, reject) => {
  const chain = await api.rpc.system.chain();
  const eventStr = `${section}.${method}`;

  console.log(`[XNFT] ${chain}: waiting for the event "${eventStr}"`);

  let waiting = 1;

  const unsub = await api.rpc.chain.subscribeNewHeads(async header => {
    console.log(`\t... [attempt ${waiting}/${maxBlocksToWait}] waiting on block #${header.number.toNumber()}`);

    const eventRecords = await api.query.system.events() as Vec<EventRecord>;
    const neededEvent = eventRecords.find(eventRecord => eventRecord.event.section == section && eventRecord.event.method == method);

    if(neededEvent != null) {
      console.log(`\t... [OK] "${eventStr}" happened`);
      unsub();
      resolve(neededEvent.event);
    } else if(waiting < maxBlocksToWait) {
      waiting++;
    } else {
      unsub();
      reject(`[ERR] "${eventStr} didn't happen"`);
    }
  });
}));

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
    throw Error('pallet ID length must be 8');
  }
};
