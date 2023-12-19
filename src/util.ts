import {ApiPromise} from '@polkadot/api';
import {Vec} from '@polkadot/types';
import {EventRecord, Event, DispatchError} from '@polkadot/types/interfaces';
import {IKeyringPair, ISubmittableResult} from '@polkadot/types/types';
import {nToU8a, stringToU8a} from '@polkadot/util';
import {encodeAddress} from '@polkadot/util-crypto';
import {IChain} from './common';

export class TxResult {
  private result: ISubmittableResult;

  constructor(result: ISubmittableResult) {
    this.result = result;
  }

  public extractEvents<S extends string, M extends string, EventId extends `${S}.${M}`>(event: EventId): Event[] {
    const [section, method] = event.split('.');

    const expected = this.result.events.filter((record) => record.event.section == section && record.event.method == method);

    if(expected != null) {
      return expected.map(e => e.event);
    } else {
      throw new Error(`the expected event "${section}.${method}" is not found`);
    }
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

export function waitForEvents<S extends string, M extends string, EventId extends `${S}.${M}`>(
  chain: IChain,
  args: {
    event: EventId,
    maxBlocksToWait?: number
  },
): Promise<Event[]> {
  // eslint-disable-next-line no-async-promise-executor
  return new Promise(async (resolve, reject) => {
    const [section, method] = args.event.split('.');

    const maxBlocksToWait = args.maxBlocksToWait ?? 5;

    console.log(`[XNFT] ${chain.name}: waiting for the event "${args.event}"`);

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
        console.log(`\t... [OK] found ${neededRecords.length} "${args.event}" event(s)`);
        unsub();
        resolve(neededRecords.map(record => record.event));
      } else if(waiting < maxBlocksToWait) {
        waiting++;
      } else {
        unsub();
        reject(new Error(`"${args.event}" didn't happen`));
      }
    });
  });
}

export const searchEvents = <T> (
  chain: IChain,
  options: {
    criteria: string,
    filterMap: (event: Event[]) => T[],
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

    if(eventRecords.length != 0) {
      console.log(`${msgPrefix}: processing ${eventRecords.length} event(s)`);
    }

    const neededRecords = options.filterMap(eventRecords.map(r => r.event));

    if(neededRecords.length != 0) {
      console.log(`\t... [OK] found ${neededRecords.length} suitable event(s)`);
      unsub();
      resolve(neededRecords);
    } else if(waiting < maxBlocksToWait) {
      console.log(`${msgPrefix}: no suitable events found in this block`);
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
  await searchEvents(
    chain,
    {
      criteria: `xcmpQueue.Success with messageHash == ${expectedMessageHash}`,
      filterMap: events => events
        .filter(e =>
          e.section == 'xcmpQueue'
          && e.method == 'Success'
          && e.data[0].toString() == expectedMessageHash),
    },
  );
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
