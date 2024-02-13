import type { Enum, Struct, u32 } from '@polkadot/types-codec';

/** @name PalletXnftClassInstance */
export interface PalletXnftClassInstance extends Struct {
    readonly classId: u32;
    readonly instanceId: u32;
}

/** @name PalletXnftDerivativeStatus */
export interface PalletXnftDerivativeStatus extends Enum {
    readonly isActive: boolean;
    readonly asActive: u32;
    readonly isStashed: boolean;
    readonly asStashed: u32;
    readonly isNotExists: boolean;
    readonly type: 'Active' | 'Stashed' | 'NotExists';
}

/** @name PalletXnftError */
export interface PalletXnftError extends Enum {
    readonly isAssetAlreadyRegistered: boolean;
    readonly isAttemptToRegisterLocalAsset: boolean;
    readonly isBadAssetId: boolean;
    readonly type: 'AssetAlreadyRegistered' | 'AttemptToRegisterLocalAsset' | 'BadAssetId';
}
