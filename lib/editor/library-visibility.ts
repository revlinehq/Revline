import { isStockAudioKey } from './stock-audio';

type LibraryFields = { kind: string; libraryHidden?: boolean; r2Key?: string; soundRecipe?: string };

/** Audio the editor made by itself (a catalog sound placed on the timeline, an AI-generated sound, audio pulled out
 *  of a video) plays on the timeline but is not listed in the Media tab or the Library unless the user saved it.
 *  `libraryHidden` is set when such audio is created; older rows without it are recognised by their stock key or
 *  sound recipe, or by `linkedToVideo`: a video in the project names it as its extracted audio. */
export function hiddenFromLibrary(asset: LibraryFields, linkedToVideo = false) {
  if (asset.libraryHidden !== undefined) return asset.libraryHidden;
  return asset.kind === 'audio' && (linkedToVideo || isStockAudioKey(asset.r2Key) || asset.soundRecipe !== undefined);
}
