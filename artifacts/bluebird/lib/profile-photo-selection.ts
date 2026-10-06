import type * as ImagePicker from 'expo-image-picker';

type Permission = Pick<ImagePicker.PermissionResponse, 'granted' | 'status' | 'canAskAgain'>;
type PickResult = Pick<ImagePicker.ImagePickerResult, 'canceled' | 'assets'>;

export type PhotoSource = 'camera' | 'library';

export async function selectProfilePhoto(
  source: PhotoSource,
  dependencies: {
    platform: string;
    permission: Permission | null;
    requestPermission: () => Promise<Permission>;
    launch: () => Promise<PickResult>;
  },
): Promise<
  | { kind: 'selected'; asset: ImagePicker.ImagePickerAsset }
  | { kind: 'denied'; permission: Permission }
  | { kind: 'cancelled' }
> {
  if (source === 'camera' && dependencies.platform === 'web') {
    throw new Error('Taking a photo is only available in the mobile app. Choose from your library instead.');
  }
  if (dependencies.platform !== 'web') {
    const permission = dependencies.permission?.granted
      ? dependencies.permission
      : await dependencies.requestPermission();
    if (!permission.granted) return { kind: 'denied', permission };
  }
  const result = await dependencies.launch();
  if (result.canceled || !result.assets?.[0]) return { kind: 'cancelled' };
  return { kind: 'selected', asset: result.assets[0] };
}